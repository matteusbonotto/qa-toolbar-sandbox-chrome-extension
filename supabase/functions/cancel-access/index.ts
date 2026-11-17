import { adminClient, authenticatedUser, enforceRateLimit } from "../_shared/auth.ts";
import { selectBestEntitlement, type EntitlementCandidate } from "../_shared/entitlements.ts";
import { serve } from "../_shared/handler.ts";
import { ApiError, jsonResponse, requirePost } from "../_shared/http.ts";
import { stripeClient, type Stripe } from "../_shared/stripe.ts";
import { refundVerdict } from "../_shared/auto_refund_rules.ts";

interface PlanRelation { id: string; key: string; name: string; }
interface RevocableCandidate extends EntitlementCandidate { grantId: string; }

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type Admin = ReturnType<typeof adminClient>;
type RefundOutcome = { refunded: true; amount: number; currency: string } | { refunded: false; reason: string };

// Arrependimento automático: reembolsa a última fatura paga se estiver no prazo (7 dias, 14 na UE)
// e se esta conta, este e-mail e este cartão nunca tiveram reembolso automático. Contestação aberta,
// reembolso parcial anterior ou qualquer dúvida = não reembolsa aqui (vai para o suporte).
async function tryAutoRefund(admin: Admin, userId: string, email: string, subscriptionId: string): Promise<RefundOutcome> {
  const stripe = stripeClient();
  const invoice = (await stripe.invoices.list({ subscription: subscriptionId, status: "paid", limit: 1 })).data[0];
  if (!invoice || !invoice.amount_paid) return { refunded: false, reason: "no_payment" };
  const payment = (await stripe.invoicePayments.list({ invoice: invoice.id, limit: 5 })).data
    .find((p) => p.status === "paid" && p.payment.type === "payment_intent");
  const pi = payment?.payment.payment_intent;
  const paymentIntentId = typeof pi === "string" ? pi : pi?.id;
  if (!paymentIntentId) return { refunded: false, reason: "no_payment" };

  const intent = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge"] });
  const charge = typeof intent.latest_charge === "object" ? intent.latest_charge as Stripe.Charge : null;
  if (!charge || charge.amount_refunded > 0) return { refunded: false, reason: "already_refunded" };
  const rawFingerprint = charge.payment_method_details?.card?.fingerprint ?? null;
  const fingerprint = rawFingerprint && /^[A-Za-z0-9]+$/.test(rawFingerprint) ? rawFingerprint : null;
  const emailHash = await sha256(`qts-refund:${email.trim().toLowerCase()}`);

  const filters = [`user_id.eq.${userId}`, `email_hash.eq.${emailHash}`];
  if (fingerprint) filters.push(`card_fingerprint.eq.${fingerprint}`);
  const { data: prior, error: priorError } = await admin.from("auto_refunds").select("id").or(filters.join(",")).limit(1);
  if (priorError) throw new Error("Could not check refund history");

  const verdict = refundVerdict({
    paidAt: invoice.status_transitions?.paid_at ?? null,
    nowMs: Date.now(),
    country: charge.billing_details?.address?.country ?? invoice.customer_address?.country,
    amount: charge.amount_captured,
    alreadyRefundedBefore: Boolean(prior?.length),
    disputed: charge.disputed,
  });
  if (!verdict.ok) return { refunded: false, reason: verdict.reason };

  // Reserva antes de chamar a Stripe: a chave única impede dois reembolsos em pedidos simultâneos.
  const reserved = await admin.from("auto_refunds").insert({
    user_id: userId, email_hash: emailHash, card_fingerprint: fingerprint,
    stripe_payment: paymentIntentId, amount: charge.amount_captured, currency: charge.currency,
  }).select("id").single();
  if (reserved.error?.code === "23505") return { refunded: false, reason: "already_refunded" };
  if (reserved.error || !reserved.data) throw new Error("Could not reserve refund");

  try {
    const refund = await stripe.refunds.create(
      { payment_intent: paymentIntentId, reason: "requested_by_customer", metadata: { source: "auto_withdrawal", supabase_user_id: userId } },
      { idempotencyKey: `qts-auto-refund-${paymentIntentId}` },
    );
    await admin.from("auto_refunds").update({ stripe_refund: refund.id }).eq("id", reserved.data.id);
  } catch (error) {
    await admin.from("auto_refunds").delete().eq("id", reserved.data.id);
    console.error("cancel-access: refund failed", { message: error instanceof Error ? error.message : String(error) });
    return { refunded: false, reason: "refund_failed" };
  }
  // Com o dinheiro devolvido, o acesso acaba agora; o webhook customer.subscription.deleted
  // sincroniza o plano.
  await stripe.subscriptions.cancel(subscriptionId);
  return { refunded: true, amount: charge.amount_captured, currency: charge.currency };
}

function relation<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

serve(async (request) => {
  requirePost(request);
  const user = await authenticatedUser(request);
  await enforceRateLimit(user.id, "cancel-access", 5, 3_600);
  const admin = adminClient();
  const now = new Date().toISOString();

  // A real, Stripe-backed subscription takes priority: cancel it there (source of truth for
  // billing), never by touching entitlement_grants directly - the existing webhook already syncs
  // entitlement_grants once Stripe confirms the change, so this function doesn't duplicate that.
  const { data: subscription, error: subscriptionError } = await admin.from("subscriptions")
    .select("id,provider_subscription_id,current_period_end,cancel_at_period_end")
    .eq("user_id", user.id).in("status", ["active", "trialing", "past_due"])
    .order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (subscriptionError) throw new Error("Could not load subscription");

  if (subscription) {
    if (user.email) {
      const outcome = await tryAutoRefund(admin, user.id, user.email, subscription.provider_subscription_id);
      if (outcome.refunded) {
        await admin.from("subscriptions").update({ status: "canceled", cancel_at_period_end: true }).eq("id", subscription.id);
        return jsonResponse(request, { canceled: true, mode: "refunded", amount: outcome.amount, currency: outcome.currency });
      }
    }
    if (!subscription.cancel_at_period_end) {
      try {
        await stripeClient().subscriptions.update(subscription.provider_subscription_id, { cancel_at_period_end: true });
      } catch (error) {
        console.error("cancel-access: stripe subscription update failed", { message: error instanceof Error ? error.message : String(error) });
        throw new ApiError(409, "stripe_subscription_unavailable");
      }
      // Optimistic local update so the next access-status/pricing refresh reflects it immediately
      // instead of waiting on the async customer.subscription.updated webhook round trip; the
      // webhook still runs and simply confirms the same state (idempotent, no conflict).
      const { error: updateError } = await admin.from("subscriptions")
        .update({ cancel_at_period_end: true }).eq("id", subscription.id);
      if (updateError) throw new Error("Could not persist cancellation state");
    }
    return jsonResponse(request, { canceled: true, mode: "at_period_end", accessUntil: subscription.current_period_end });
  }

  // No billing-backed subscription: fall back to revoking whichever non-billing grant (trial,
  // voucher, manual or founder courtesy) is currently the visitor's active plan, using the exact
  // same selection rule access-status uses so this revokes the one thing they actually see as
  // "their plan" - never a weaker grant sitting underneath it.
  const { data: grants, error: grantsError } = await admin.from("entitlement_grants")
    .select("id,source,expires_at,created_at,plans(id,key,name)")
    .eq("user_id", user.id).is("revoked_at", null).lte("starts_at", now)
    .or(`expires_at.is.null,expires_at.gt.${now}`).order("created_at", { ascending: false });
  if (grantsError) throw new Error("Could not load entitlement grants");
  if (!grants?.length) throw new ApiError(409, "nothing_to_cancel");

  const candidates: RevocableCandidate[] = grants.map((grant) => {
    const plan = relation<PlanRelation>(grant.plans as PlanRelation | PlanRelation[] | null);
    return {
      grantId: grant.id as string,
      source: grant.source as string,
      expiresAt: grant.expires_at as string | null,
      createdAt: grant.created_at as string,
      plan,
      features: {},
      unrestricted: !plan,
    };
  });
  const best = selectBestEntitlement(candidates) as RevocableCandidate | null;
  if (!best) throw new ApiError(409, "nothing_to_cancel");

  const { error: revokeError, count } = await admin.from("entitlement_grants")
    .update({ revoked_at: now }, { count: "exact" })
    .eq("id", best.grantId).eq("user_id", user.id).is("revoked_at", null);
  if (revokeError) throw new Error("Could not revoke access grant");
  if (!count) throw new ApiError(409, "nothing_to_cancel");

  return jsonResponse(request, { canceled: true, mode: "immediate" });
});
