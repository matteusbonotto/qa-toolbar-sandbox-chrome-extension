import Stripe from "npm:stripe@22.3.1";
import { adminClient } from "../_shared/auth.ts";
import { serverConfig } from "../_shared/config.ts";
import { jsonResponse } from "../_shared/http.ts";
import { stripeClient } from "../_shared/stripe.ts";

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

async function synchronizeSubscription(subscription: Stripe.Subscription, eventCreated: number): Promise<void> {
  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  const userId = await resolveUserId(customerId, subscription.metadata.supabase_user_id);
  if (!userId) throw new Error("Subscription does not map to a user");
  const priceId = subscription.items.data[0]?.price.id;
  if (!priceId) throw new Error("Subscription has no price");

  const admin = adminClient();
  const config = serverConfig();
  let planKey: "pro" | "scale";
  if ([config.scaleMonthlyPriceId, config.scaleYearlyPriceId].includes(priceId)) planKey = "scale";
  else if ([config.proMonthlyPriceId, config.proYearlyPriceId].includes(priceId)) planKey = "pro";
  else throw new Error("Subscription uses an unauthorized price");
  const { data: plan } = await admin.from("plans").select("id").eq("key", planKey).single();
  if (!plan) throw new Error("Subscription plan is not configured");
  const periodStart = subscription.items.data[0]?.current_period_start;
  const periodEnd = subscription.items.data[0]?.current_period_end;
  const { error } = await admin.rpc("upsert_stripe_subscription", {
    target_user_id: userId,
    target_plan_id: plan.id,
    stripe_subscription_id: subscription.id,
    stripe_price_id: priceId,
    subscription_status: subscription.status,
    period_start: timestamp(periodStart),
    period_end: timestamp(periodEnd),
    will_cancel: subscription.cancel_at_period_end,
    canceled_timestamp: timestamp(subscription.canceled_at),
    provider_event_created: eventCreated,
  });
  if (error) throw new Error("Could not synchronize subscription");
}

async function rewardReferral(referredUserId: string): Promise<void> {
  const admin = adminClient();
  const { data: referral } = await admin.from("referrals").update({ status: "qualified", qualified_at: new Date().toISOString() })
    .eq("referred_user_id", referredUserId).eq("status", "pending")
    .select("id,referrer_user_id").maybeSingle();
  if (!referral) return;
  try {
    const { data: customer } = await admin.from("payment_customers").select("provider_customer_id")
      .eq("user_id", referral.referrer_user_id).maybeSingle();
    let rewardType = "pro_access";
    let rewardReference: string | null = null;
    if (customer) {
      const credit = await stripeClient().customers.createBalanceTransaction(customer.provider_customer_id, {
        amount: -2990,
        currency: "brl",
        description: "Credito por indicacao QA Toolbar",
        metadata: { referral_id: referral.id },
      }, { idempotencyKey: `referral-credit:${referral.id}` });
      rewardType = "stripe_credit";
      rewardReference = credit.id;
    } else {
      const { data: pro } = await admin.from("plans").select("id").eq("key", "pro").single();
      if (!pro) throw new Error("Pro plan not configured for referral reward");
      const { data: grant } = await admin.from("entitlement_grants").insert({
        user_id: referral.referrer_user_id, plan_id: pro.id, source: "manual",
        starts_at: new Date().toISOString(), expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      }).select("id").single();
      rewardReference = grant?.id ?? null;
    }
    await admin.from("referrals").update({ status: "rewarded", reward_type: rewardType, reward_reference: rewardReference, rewarded_at: new Date().toISOString() }).eq("id", referral.id);
    const { data: profile } = await admin.from("referral_profiles").select("qualified_referrals").eq("user_id", referral.referrer_user_id).single();
    await admin.from("referral_profiles").update({ qualified_referrals: (profile?.qualified_referrals ?? 0) + 1 }).eq("user_id", referral.referrer_user_id);
  } catch (error) {
    await admin.from("referrals").update({ status: "pending", qualified_at: null }).eq("id", referral.id);
    throw error;
  }
}

Deno.serve(async (request) => {
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
      serverConfig().stripeWebhookSecret,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch {
    return jsonResponse(request, { error: "invalid_signature" }, 400);
  }

  const admin = adminClient();
  const { data: existing } = await admin.from("webhook_events").select("id,status,attempts")
    .eq("provider_event_id", event.id).maybeSingle();
  if (existing?.status === "processed" || existing?.status === "processing") {
    return jsonResponse(request, { received: true, duplicate: true });
  }

  let webhookId = existing?.id as string | undefined;
  if (existing) {
    await admin.from("webhook_events").update({ status: "processing", attempts: existing.attempts + 1, last_error: null })
      .eq("id", existing.id);
  } else {
    const { data: inserted, error } = await admin.from("webhook_events").insert({
      provider: "stripe",
      provider_event_id: event.id,
      event_type: event.type,
    }).select("id").single();
    if (error || !inserted) {
      const { data: raced } = await admin.from("webhook_events").select("id")
        .eq("provider_event_id", event.id).maybeSingle();
      if (raced) return jsonResponse(request, { received: true, duplicate: true });
      return jsonResponse(request, { error: "event_persistence_failed" }, 500);
    }
    webhookId = inserted.id;
  }

  try {
    let subscription: Stripe.Subscription | null = null;
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
      if (subscriptionId) subscription = await stripe.subscriptions.retrieve(subscriptionId);
    } else if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      subscription = event.data.object as Stripe.Subscription;
    }

    if (subscription) await synchronizeSubscription(subscription, event.created);

    const eventObject = event.data.object as unknown as Record<string, unknown>;
    const customerId = typeof eventObject.customer === "string" ? eventObject.customer : null;
    const userId = await resolveUserId(customerId);
    if (event.type === "invoice.paid" && userId && typeof eventObject.amount_paid === "number" && eventObject.amount_paid > 0) {
      await rewardReferral(userId);
    }
    await admin.from("payment_events").insert({
      webhook_event_id: webhookId,
      user_id: userId,
      provider_customer_id: customerId,
      provider_subscription_id: subscription?.id ?? null,
      event_type: event.type,
      amount_minor: typeof eventObject.amount_paid === "number" ? eventObject.amount_paid : null,
      currency: typeof eventObject.currency === "string" ? eventObject.currency : null,
    });
    await admin.from("webhook_events").update({ status: subscription || event.type.startsWith("invoice.") ? "processed" : "ignored", processed_at: new Date().toISOString() })
      .eq("id", webhookId);
    return jsonResponse(request, { received: true });
  } catch (error) {
    await admin.from("webhook_events").update({
      status: "failed",
      last_error: error instanceof Error ? error.message.slice(0, 500) : "Unknown processing error",
    }).eq("id", webhookId);
    return jsonResponse(request, { error: "processing_failed" }, 500);
  }
});
