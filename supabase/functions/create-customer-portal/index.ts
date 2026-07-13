import { z } from "npm:zod@4.4.3";
import { authenticatedUser, adminClient, enforceRateLimit } from "../_shared/auth.ts";
import { serverConfig } from "../_shared/config.ts";
import { serve } from "../_shared/handler.ts";
import { ApiError, jsonResponse, readJson, requirePost } from "../_shared/http.ts";
import { stripeClient } from "../_shared/stripe.ts";

const requestSchema = z.object({ requestId: z.string().uuid() }).strict();

serve(async (request) => {
  requirePost(request);
  const user = await authenticatedUser(request);
  await enforceRateLimit(user.id, "customer-portal", 8, 3600);
  const parsed = requestSchema.safeParse(await readJson(request));
  if (!parsed.success) throw new ApiError(400, "invalid_request");

  const { data: customer } = await adminClient().from("payment_customers")
    .select("provider_customer_id").eq("user_id", user.id).maybeSingle();
  if (!customer) throw new ApiError(404, "billing_customer_not_found");

  const portal = await stripeClient().billingPortal.sessions.create({
    customer: customer.provider_customer_id,
    return_url: serverConfig().checkoutSuccessUrl,
  }, { idempotencyKey: `portal:${user.id}:${parsed.data.requestId}` });

  if (!portal.url.startsWith("https://billing.stripe.com/")) throw new Error("Stripe returned an invalid portal URL");
  return jsonResponse(request, { portalUrl: portal.url });
});
