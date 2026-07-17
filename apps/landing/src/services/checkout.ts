import type { Session } from "@supabase/supabase-js";
import type { PlanId } from "../data/pricingData";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

export type BillingCycle = "monthly" | "yearly";

export interface DisplayPrice {
  amountMinor: number;
  currency: string;
}

export type PriceCatalog = Partial<Record<PlanId, Partial<Record<BillingCycle, DisplayPrice>>>>;

export interface AccessStatus {
  active: boolean;
  plan: { key: PlanId; name: string } | null;
  source: string | null;
  expiresAt: string | null;
  billing: { status: string; cancelAtPeriodEnd: boolean; paymentConfirmed: boolean } | null;
  installUrl: string | null;
  checkedAt: string;
}

export interface CheckoutResult {
  checkoutUrl?: string;
  accessGranted?: boolean;
  expiresAt?: string | null;
  label?: string;
}

function requireClient() {
  if (!isSupabaseConfigured || !supabase) throw new Error("backend_not_configured");
  return supabase;
}

function safeCheckoutUrl(value: unknown): string {
  const url = new URL(String(value));
  if (url.protocol !== "https:" || url.hostname !== "checkout.stripe.com" || url.username || url.password) {
    throw new Error("invalid_checkout_url");
  }
  return url.href;
}

function safeStoreUrl(value: unknown): string {
  const url = new URL(String(value));
  if (url.protocol !== "https:" || url.hostname !== "chromewebstore.google.com" || url.username || url.password) {
    throw new Error("invalid_store_url");
  }
  return url.href;
}

async function functionErrorCode(error: unknown): Promise<string> {
  if (!error || typeof error !== "object" || !("context" in error)) return "request_failed";
  const context = (error as { context?: Response }).context;
  if (!context || typeof context.clone !== "function") return "request_failed";
  const body = await context.clone().json().catch(() => null) as { error?: unknown } | null;
  return typeof body?.error === "string" ? body.error : "request_failed";
}

export async function loadPriceCatalog(): Promise<PriceCatalog> {
  const client = requireClient();
  const { data, error } = await client.from("stripe_prices")
    .select("billing_cycle,amount_minor,currency,plans!inner(key)")
    .eq("is_active", true);
  if (error) throw new Error("pricing_unavailable");

  const catalog: PriceCatalog = {};
  for (const row of data ?? []) {
    const planRelation = Array.isArray(row.plans) ? row.plans[0] : row.plans;
    const planKey = planRelation?.key as PlanId | undefined;
    const cycle = row.billing_cycle as BillingCycle;
    if (!planKey || !["monthly", "yearly"].includes(cycle)) continue;
    catalog[planKey] ??= {};
    catalog[planKey]![cycle] = { amountMinor: Number(row.amount_minor), currency: row.currency };
  }
  return catalog;
}

export async function signIn(email: string, password: string): Promise<Session> {
  const { data, error } = await requireClient().auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error("invalid_credentials");
  return data.session;
}

export async function signUp(email: string, password: string): Promise<Session | null> {
  const redirectTo = new URL(import.meta.env.BASE_URL, window.location.origin).href;
  const { data, error } = await requireClient().auth.signUp({
    email,
    password,
    options: { emailRedirectTo: redirectTo },
  });
  if (error) throw new Error("signup_failed");
  return data.session;
}

export async function sendSignInLink(email: string): Promise<void> {
  const redirectTo = new URL(import.meta.env.BASE_URL, window.location.origin).href;
  const { error } = await requireClient().auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo, shouldCreateUser: false },
  });
  if (error) throw new Error("magic_link_failed");
}

export async function signOut(): Promise<void> {
  const { error } = await requireClient().auth.signOut();
  if (error) throw new Error("signout_failed");
}

export async function startCheckout(input: {
  planId: PlanId;
  billingCycle: BillingCycle;
  voucherCode: string | null;
}): Promise<CheckoutResult> {
  const client = requireClient();
  const requestId = crypto.randomUUID();
  const { data, error } = await client.functions.invoke("checkout-create-session", {
    headers: { "x-correlation-id": requestId },
    body: {
      planKey: input.planId,
      billingCycle: input.billingCycle,
      requestId,
      ...(input.voucherCode ? { voucherCode: input.voucherCode } : {}),
    },
  });
  if (error) throw new Error(await functionErrorCode(error));
  if (data?.checkoutUrl) return { checkoutUrl: safeCheckoutUrl(data.checkoutUrl) };
  if (data?.accessGranted === true) {
    return {
      accessGranted: true,
      expiresAt: typeof data.expiresAt === "string" ? data.expiresAt : null,
      label: typeof data.label === "string" ? data.label : undefined,
    };
  }
  throw new Error("invalid_checkout_response");
}

export async function loadAccessStatus(): Promise<AccessStatus> {
  const { data, error } = await requireClient().functions.invoke("access-status", { body: {} });
  if (error) throw new Error(await functionErrorCode(error));
  if (!data || typeof data.active !== "boolean") throw new Error("invalid_access_response");
  if (data.installUrl) data.installUrl = safeStoreUrl(data.installUrl);
  return data as AccessStatus;
}
