import { adminClient } from "../_shared/auth.ts";
import { billingConfig } from "../_shared/config.ts";
import { sendPaymentFailedEmail } from "../_shared/email.ts";
import { jsonResponse, preflight } from "../_shared/http.ts";
import { Stripe, stripeClient } from "../_shared/stripe.ts";

function timestamp(value: number | null | undefined): string | null {
  return value ? new Date(value * 1000).toISOString() : null;
}

async function resolveUserId(customerId: string | null, metadataUserId?: string): Promise<string | null> {
  if (metadataUserId) return metadataUserId;
  if (!customerId) return null;
  const { data } = await adminClient().from("payment_customers").select("user_id")
    .eq("provider_customer_id", customerId).maybeSingle();
  return data?.user_id ?? null;
}

async function synchronizeSubscription(subscription: Stripe.Subscription, eventCreated: number): Promise<string> {
  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  const userId = await resolveUserId(customerId, subscription.metadata.supabase_user_id);
  if (!userId) throw new Error("Subscription does not map to a user");
  const item = subscription.items.data[0];
  const priceId = item?.price.id;
  if (!priceId) throw new Error("Subscription has no price");
  const admin = adminClient();
  const { data: price } = await admin.from("stripe_prices").select("plan_id,billing_cycle")
    .eq("provider_price_id", priceId).eq("is_active", true).maybeSingle();
  if (!price) throw new Error("Subscription uses an unauthorized price");
  const { error } = await admin.rpc("sync_stripe_subscription", {
    target_user_id: userId,
    target_plan_id: price.plan_id,
    stripe_subscription_id: subscription.id,
    stripe_price_id: priceId,
    subscription_status: subscription.status,
    billing_interval: price.billing_cycle,
    period_start: timestamp(item.current_period_start),
    period_end: timestamp(item.current_period_end),
    will_cancel: subscription.cancel_at_period_end,
    canceled_timestamp: timestamp(subscription.canceled_at),
    provider_event_created: eventCreated,
  });
  if (error) throw new Error("Could not synchronize subscription");
  return userId;
}

Deno.serve(async (request) => {
  const optionsResponse = preflight(request);
  if (optionsResponse) return optionsResponse;
  if (request.method !== "POST") return jsonResponse(request, { error: "method_not_allowed" }, 405);
  const signature = request.headers.get("stripe-signature");
  if (!signature) return jsonResponse(request, { error: "signature_required" }, 400);
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > 1_048_576) {
    return jsonResponse(request, { error: "payload_too_large" }, 413);
  }

  const stripe = stripeClient();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      billingConfig().stripeWebhookSecret,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch {
    return jsonResponse(request, { error: "invalid_signature" }, 400);
  }

  const admin = adminClient();
  const { data: existing } = await admin.from("webhook_events").select("id,status,attempts,received_at")
    .eq("provider_event_id", event.id).maybeSingle();
  const recentlyProcessing = existing?.status === "processing"
    && Date.now() - new Date(existing.received_at).getTime() < 5 * 60_000;
  if (existing?.status === "processed" || existing?.status === "ignored" || recentlyProcessing) {
    return jsonResponse(request, { received: true, duplicate: true });
  }

  let webhookId = existing?.id as string | undefined;
  if (existing) {
    const updated = await admin.from("webhook_events").update({
      status: "processing", attempts: existing.attempts + 1, last_error: null,
    }).eq("id", existing.id);
    if (updated.error) return jsonResponse(request, { error: "event_persistence_failed" }, 500);
  } else {
    const inserted = await admin.from("webhook_events").insert({
      provider: "stripe", provider_event_id: event.id, event_type: event.type,
    }).select("id").single();
    if (inserted.error || !inserted.data) {
      return jsonResponse(request, { received: true, duplicate: true });
    }
    webhookId = inserted.data.id;
  }

  try {
    const object = event.data.object as unknown as Record<string, unknown>;
    const customerId = typeof object.customer === "string" ? object.customer : null;
    let userId = await resolveUserId(customerId);
    let subscription: Stripe.Subscription | null = null;

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      userId = await resolveUserId(
        typeof session.customer === "string" ? session.customer : session.customer?.id ?? null,
        session.metadata?.supabase_user_id,
      );
      await admin.from("checkout_sessions").update({ status: "complete" })
        .eq("provider_session_id", session.id);
      const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
      if (subscriptionId) subscription = await stripe.subscriptions.retrieve(subscriptionId);
      if (session.metadata?.voucher_request_id) {
        await admin.rpc("finalize_voucher_reservation", { request_id_input: session.metadata.voucher_request_id });
      }
    } else if (event.type === "checkout.session.expired") {
      const session = event.data.object as Stripe.Checkout.Session;
      await admin.from("checkout_sessions").update({ status: "expired" })
        .eq("provider_session_id", session.id);
      if (session.metadata?.voucher_request_id) {
        await admin.rpc("release_voucher_reservation", { request_id_input: session.metadata.voucher_request_id });
      }
    } else if ([
      "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted",
    ].includes(event.type)) {
      subscription = event.data.object as Stripe.Subscription;
    } else if (["invoice.paid", "invoice.payment_failed"].includes(event.type)) {
      const invoice = event.data.object as Stripe.Invoice;
      const parent = invoice.parent?.subscription_details?.subscription;
      const subscriptionId = typeof parent === "string" ? parent : parent?.id;
      if (subscriptionId) subscription = await stripe.subscriptions.retrieve(subscriptionId);
    }

    if (subscription) userId = await synchronizeSubscription(subscription, event.created);
    if (event.type === "invoice.paid" && userId && Number(object.amount_paid ?? 0) > 0) {
      await admin.rpc("reward_referral", { referred_user_id_input: userId });
    }
    if (event.type === "invoice.payment_failed" && userId) {
      // Best-effort — a Resend outage or a missing/misconfigured secret must never fail the whole
      // webhook: Stripe retries a non-2xx response indefinitely, which would re-run subscription
      // sync repeatedly for what's really just a notification problem.
      try {
        const { data: userRecord } = await admin.auth.admin.getUserById(userId);
        const email = userRecord?.user?.email;
        if (email) await sendPaymentFailedEmail(email);
      } catch (error) {
        console.error("payment-failed email not sent:", error instanceof Error ? error.message : error);
      }
    }
    if (event.type === "charge.dispute.created" && userId) {
      await admin.from("entitlement_grants").update({ revoked_at: new Date().toISOString() })
        .eq("user_id", userId).eq("source", "subscription").is("revoked_at", null);
    }

    const amount = typeof object.amount_paid === "number" ? object.amount_paid
      : typeof object.amount_refunded === "number" ? object.amount_refunded
      : typeof object.amount === "number" ? object.amount
      : typeof object.amount_total === "number" ? object.amount_total : null;
    await admin.from("payment_events").insert({
      webhook_event_id: webhookId,
      user_id: userId,
      provider_customer_id: customerId,
      provider_subscription_id: subscription?.id ?? null,
      event_type: event.type,
      amount_minor: amount,
      currency: typeof object.currency === "string" ? object.currency.toLowerCase() : null,
    });
    const handled = Boolean(subscription) || [
      "checkout.session.completed", "checkout.session.expired", "invoice.paid", "invoice.payment_failed",
      "charge.refunded", "charge.dispute.created", "charge.dispute.closed",
    ].includes(event.type);
    await admin.from("webhook_events").update({
      status: handled ? "processed" : "ignored", processed_at: new Date().toISOString(),
    }).eq("id", webhookId);
    return jsonResponse(request, { received: true });
  } catch (error) {
    await admin.from("webhook_events").update({
      status: "failed",
      last_error: error instanceof Error ? error.message.slice(0, 500) : "Unknown processing error",
    }).eq("id", webhookId);
    return jsonResponse(request, { error: "processing_failed" }, 500);
  }
});
