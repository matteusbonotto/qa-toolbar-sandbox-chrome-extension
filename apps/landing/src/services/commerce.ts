import { z } from "zod";
import type { MonthlyPriceKey } from "@qts/domain";

const sessionSchema = z.object({
  accessToken: z.string().min(20).max(8192),
  refreshToken: z.string().min(1).max(4096),
  expiresAt: z.number().int().positive(),
  user: z.object({ id: z.string().uuid(), email: z.string().email().optional() }),
}).strict();

const confirmationSchema = z.object({
  confirmationRequired: z.literal(true),
  email: z.string().email(),
}).strict();

const billingStatusSchema = z.object({
  plan: z.object({ key: z.string(), name: z.string() }),
  paymentConfirmed: z.boolean(),
  subscription: z.object({
    status: z.string(),
    currentPeriodEnd: z.string().nullable(),
    cancelAtPeriodEnd: z.boolean(),
  }).nullable(),
  trial: z.object({
    active: z.boolean(),
    endsAt: z.string().nullable(),
    daysRemaining: z.number().int().nonnegative(),
  }),
  access: z.object({
    active: z.boolean(), source: z.string().nullable(), expiresAt: z.string().nullable(),
    daysRemaining: z.number().int().nonnegative().nullable(), expiryWarning: z.boolean(), installUrl: z.string().url(),
  }).optional(),
}).passthrough();

const checkoutSchema = z.object({ checkoutUrl: z.string().url() }).strict();
const voucherSchema = z.object({ redeemed: z.literal(true), label: z.string(), expiresAt: z.string().nullable() }).strict();

export type LandingSession = z.infer<typeof sessionSchema>;
export type BillingStatus = z.infer<typeof billingStatusSchema>;
export type PriceKey = MonthlyPriceKey;

const sessionKey = "qtsLandingAuthSession";
const installationKey = "qtsLandingInstallationId";

export class LandingCommerce {
  constructor(
    private readonly supabaseUrl: string,
    private readonly supabasePublicKey: string,
  ) {
    const url = new URL(supabaseUrl);
    if (url.protocol !== "https:" || !url.hostname.endsWith(".supabase.co")) {
      throw new Error("Configuração segura de cobrança indisponível.");
    }
  }

  async signIn(email: string, password: string): Promise<LandingSession> {
    const session = sessionSchema.parse(await this.publicPost("auth-sign-in", { email, password }));
    this.storeSession(session);
    return session;
  }

  async signUp(email: string, password: string, acceptedTerms: true) {
    const payload = await this.publicPost("auth-sign-up", { email, password, acceptedTerms });
    const confirmation = confirmationSchema.safeParse(payload);
    if (confirmation.success) return confirmation.data;
    const session = sessionSchema.parse(payload);
    this.storeSession(session);
    return session;
  }

  async accessToken(): Promise<string | null> {
    const stored = window.sessionStorage.getItem(sessionKey);
    if (!stored) return null;
    const parsed = sessionSchema.safeParse(JSON.parse(stored));
    if (!parsed.success) {
      window.sessionStorage.removeItem(sessionKey);
      return null;
    }
    if (parsed.data.expiresAt > Math.floor(Date.now() / 1000) + 60) return parsed.data.accessToken;
    const refreshed = sessionSchema.parse(await this.publicPost("auth-refresh", { refreshToken: parsed.data.refreshToken }));
    this.storeSession(refreshed);
    return refreshed.accessToken;
  }

  async createCheckout(accessToken: string, priceKey: PriceKey): Promise<string> {
    const data = checkoutSchema.parse(await this.authenticatedPost("create-checkout", accessToken, {
      priceKey,
      requestId: crypto.randomUUID(),
    }));
    const url = new URL(data.checkoutUrl);
    if (url.protocol !== "https:" || url.hostname !== "checkout.stripe.com" || url.username || url.password) {
      throw new Error("O endereço do checkout foi rejeitado.");
    }
    return url.href;
  }

  async billingStatus(accessToken: string): Promise<BillingStatus> {
    const installationId = this.installationId();
    await this.authenticatedPost("register-installation", accessToken, {
      installationId,
      label: "Landing Page",
    });
    return billingStatusSchema.parse(await this.authenticatedPost("billing-status", accessToken, { installationId }));
  }

  async redeemVoucher(accessToken: string, code: string) {
    return voucherSchema.parse(await this.authenticatedPost("redeem-voucher", accessToken, { code }));
  }

  signOut(): void {
    window.sessionStorage.removeItem(sessionKey);
  }

  private installationId(): string {
    const existing = window.localStorage.getItem(installationKey);
    if (existing && z.string().uuid().safeParse(existing).success) return existing;
    const created = crypto.randomUUID();
    window.localStorage.setItem(installationKey, created);
    return created;
  }

  private storeSession(session: LandingSession): void {
    window.sessionStorage.setItem(sessionKey, JSON.stringify(session));
  }

  private async publicPost(functionName: string, body: Record<string, unknown>): Promise<unknown> {
    return this.post(functionName, body);
  }

  private async authenticatedPost(functionName: string, accessToken: string, body: Record<string, unknown>): Promise<unknown> {
    if (!accessToken || accessToken.length > 8192) throw new Error("Entre na sua conta para continuar.");
    return this.post(functionName, body, accessToken);
  }

  private async post(functionName: string, body: Record<string, unknown>, accessToken?: string): Promise<unknown> {
    const response = await fetch(`${this.supabaseUrl}/functions/v1/${functionName}`, {
      method: "POST",
      headers: {
        apikey: this.supabasePublicKey,
        "content-type": "application/json",
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(body),
      redirect: "error",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    const data: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      const code = data && typeof data === "object" && "error" in data ? String((data as { error?: unknown }).error) : "";
      if (response.status === 401) throw new Error("E-mail ou senha inválidos.");
      if (response.status === 409 && code === "voucher_unavailable") throw new Error("Voucher inválido, expirado ou já utilizado.");
      if (response.status === 409) throw new Error("Já existe uma assinatura ativa para esta conta.");
      throw new Error("Não foi possível concluir a operação agora.");
    }
    return data;
  }
}

export function createLandingCommerce(): LandingCommerce | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  if (!url || !key) return null;
  return new LandingCommerce(url, key);
}

export function hasReleaseAccess(status: BillingStatus): boolean {
  return status.access?.active ?? (status.paymentConfirmed && status.subscription?.status === "active");
}
