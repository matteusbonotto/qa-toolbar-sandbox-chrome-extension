import { z } from "zod";

const urlResponseSchema = z.object({
  checkoutUrl: z.string().url().optional(),
  portalUrl: z.string().url().optional(),
}).strict();

const statusSchema = z.object({
  plan: z.object({ key: z.string(), name: z.string() }),
  subscription: z.object({
    status: z.string(),
    currentPeriodEnd: z.string().nullable(),
    cancelAtPeriodEnd: z.boolean(),
  }).nullable(),
  overrides: z.array(z.unknown()),
  features: z.record(z.string(), z.unknown()),
  trial: z.object({ active: z.boolean(), endsAt: z.string().nullable(), daysRemaining: z.number().int().nonnegative() }),
  referral: z.object({ code: z.string().nullable(), qualified: z.number().int().nonnegative() }),
  checkedAt: z.string(),
});

export interface BillingConfiguration {
  supabaseUrl: string;
  supabasePublicKey: string;
}

export class BillingApi {
  constructor(private readonly configuration: BillingConfiguration) {
    const url = new URL(configuration.supabaseUrl);
    if (url.protocol !== "https:" || !url.hostname.endsWith(".supabase.co")) {
      throw new Error("A secure Supabase project URL is required");
    }
  }

  async createCheckout(accessToken: string, priceKey: "pro_monthly" | "pro_yearly" | "scale_monthly" | "scale_yearly", referralCode?: string): Promise<string> {
    const data = urlResponseSchema.parse(await this.post("create-checkout", accessToken, {
      priceKey,
      requestId: crypto.randomUUID(),
      ...(referralCode ? { referralCode } : {}),
    }));
    return validateExternalUrl(data.checkoutUrl, "checkout.stripe.com");
  }

  async createCustomerPortal(accessToken: string): Promise<string> {
    const data = urlResponseSchema.parse(await this.post("create-customer-portal", accessToken, {
      requestId: crypto.randomUUID(),
    }));
    return validateExternalUrl(data.portalUrl, "billing.stripe.com");
  }

  async registerInstallation(accessToken: string, installationId: string, label: string): Promise<void> {
    await this.post("register-installation", accessToken, { installationId, label });
  }

  async status(accessToken: string, installationId: string) {
    return statusSchema.parse(await this.post("billing-status", accessToken, { installationId }));
  }

  private async post(functionName: string, accessToken: string, body: Record<string, unknown>): Promise<unknown> {
    if (!accessToken || accessToken.length > 8192) throw new Error("A valid session is required");
    const response = await fetch(`${this.configuration.supabaseUrl}/functions/v1/${functionName}`, {
      method: "POST",
      headers: {
        apikey: this.configuration.supabasePublicKey,
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      redirect: "error",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    const data: unknown = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Billing API request failed (${response.status})`);
    return data;
  }
}

function validateExternalUrl(value: string | undefined, expectedHostname: string): string {
  if (!value) throw new Error("Billing URL is missing");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== expectedHostname || url.username || url.password) {
    throw new Error("Billing URL was rejected");
  }
  return url.href;
}
