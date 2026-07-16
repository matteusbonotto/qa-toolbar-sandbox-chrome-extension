import { z } from "zod";
import { getSupabaseClient } from "../supabaseClient";

export interface WhoAmI {
  userId: string;
  email: string | null;
  roles: string[];
  isAdmin: boolean;
  isFounder: boolean;
}

export interface DashboardOverview {
  total_users: number;
  active_paid_subscriptions: number;
  active_manual_grants: number;
  active_founder_grants: number;
  active_voucher_grants: number;
  vouchers_available: number;
  vouchers_redeemed: number;
  campaigns_active: number;
}

export interface AdminUserRow {
  id: string;
  email: string | null;
  created_at: string;
  roles: string[];
  plan_key: string | null;
  access_source: string | null;
  access_expires_at: string | null;
}

export interface AuditLogEntry {
  id: number;
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  reason: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface Plan { id: string; key: string; name: string; is_active: boolean; created_at: string }
export interface Feature { id: string; key: string; value_type: string; description: string }
export interface PlanFeature { plan_id: string; feature_id: string; value: unknown }
export interface PlanPrice { id: string; plan_id: string; billing_interval: "monthly" | "yearly"; stripe_price_id: string; updated_at: string }
export interface FeatureFlag { key: string; enabled: boolean; config: Record<string, unknown>; description: string; updated_at: string }
export interface SystemNotice { id: string; severity: "info" | "warning" | "critical"; title: string; message: string; starts_at: string; ends_at: string | null; is_active: boolean; created_at: string }
export interface AppVersion { id: string; version: string; minimum_supported_version: string; is_blocked: boolean; released_at: string }

export interface CatalogSnapshot {
  plans: Plan[];
  features: Feature[];
  planFeatures: PlanFeature[];
  prices: PlanPrice[];
  flags: FeatureFlag[];
  notices: SystemNotice[];
  versions: AppVersion[];
}

export interface Voucher { id: string; label: string; plan_id: string; grant_days: number | null; status: "available" | "used" | "disabled"; expires_at: string | null; redeemed_by: string | null; redeemed_at: string | null; created_at: string }
export interface VoucherCampaign { id: string; label: string; plan_id: string; grant_days: number; maximum_redemptions: number | null; redemption_count: number; enabled: boolean; expires_at: string | null; created_at: string }

export interface VouchersSnapshot { vouchers: Voucher[]; campaigns: VoucherCampaign[] }

export interface EntitlementGrant { id: string; plan_id: string | null; source: string; starts_at: string; expires_at: string | null; revoked_at: string | null; plans: { key: string; name: string } | null }
export interface EntitlementOverride { id: string; feature_id: string; value: unknown; starts_at: string; expires_at: string | null; revoked_at: string | null; reason: string | null; features: { key: string } | null }
export interface UserAccessSnapshot {
  userId: string;
  grants: EntitlementGrant[];
  overrides: EntitlementOverride[];
  subscription: { status: string; current_period_end: string | null; plans: { key: string; name: string } | null } | null;
}

const apiErrorSchema = z.object({ error: z.string() });

export class AdminApiError extends Error {
  constructor(public readonly code: string, message?: string) {
    super(message ?? code);
  }
}

async function currentAccessToken(): Promise<string> {
  const { data, error } = await getSupabaseClient().auth.getSession();
  if (error || !data.session) throw new AdminApiError("no_session", "Sua sessão expirou. Entre novamente.");
  return data.session.access_token;
}

async function callFunction<T = unknown>(functionName: string, body: Record<string, unknown>): Promise<T> {
  const url = import.meta.env.VITE_SUPABASE_URL as string;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
  const accessToken = await currentAccessToken();
  const response = await fetch(`${url}/functions/v1/${functionName}`, {
    method: "POST",
    headers: {
      apikey: key,
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    redirect: "error",
    credentials: "omit",
    referrerPolicy: "no-referrer",
  });
  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const parsedError = apiErrorSchema.safeParse(payload);
    const code = parsedError.success ? parsedError.data.error : "request_failed";
    if (response.status === 401) throw new AdminApiError("session_expired", "Sua sessão expirou. Entre novamente.");
    if (response.status === 403 && code === "administrator_required") throw new AdminApiError(code, "Esta conta não tem acesso ao painel administrativo.");
    if (response.status === 403 && code === "founder_required") throw new AdminApiError(code, "Apenas o founder pode executar esta ação.");
    if (response.status === 403 && code === "recent_mfa_required") throw new AdminApiError(code, "Confirme a autenticação novamente (login recente) para continuar.");
    if (response.status === 429) throw new AdminApiError(code, "Muitas tentativas em pouco tempo. Aguarde e tente novamente.");
    throw new AdminApiError(code, `Não foi possível concluir esta ação (${code}).`);
  }
  return payload as T;
}

export const adminApi = {
  whoAmI: () => callFunction<WhoAmI>("whoami", {}),

  dashboard: () => callFunction<{ overview: DashboardOverview }>("admin-overview", { action: "dashboard" }),
  searchUsers: (search?: string) => callFunction<{ users: AdminUserRow[] }>("admin-overview", { action: "searchUsers", search }),
  auditLog: (targetType?: string) => callFunction<{ entries: AuditLogEntry[] }>("admin-overview", { action: "auditLog", targetType }),

  catalog: () => callFunction<CatalogSnapshot>("admin-catalog", { action: "list" }),
  upsertPlan: (input: { planId?: string; key: string; name: string; isActive: boolean; reason: string }) =>
    callFunction<{ planId: string }>("admin-catalog", { action: "upsertPlan", ...input }),
  upsertFeatureValue: (input: { planId: string; featureId: string; value: unknown; reason: string }) =>
    callFunction<{ applied: true }>("admin-catalog", { action: "upsertFeatureValue", ...input }),
  upsertPrice: (input: { planId: string; billingInterval: "monthly" | "yearly"; stripePriceId: string; reason: string }) =>
    callFunction<{ applied: true }>("admin-catalog", { action: "upsertPrice", ...input }),
  upsertFeatureFlag: (input: { key: string; enabled: boolean; description?: string; config?: Record<string, unknown>; reason: string }) =>
    callFunction<{ applied: true }>("admin-catalog", { action: "upsertFeatureFlag", ...input }),
  upsertNotice: (input: { noticeId?: string; severity: "info" | "warning" | "critical"; title: string; message: string; isActive: boolean; endsAt?: string | null; reason: string }) =>
    callFunction<{ noticeId: string }>("admin-catalog", { action: "upsertNotice", ...input }),
  upsertVersion: (input: { version: string; minimumSupportedVersion: string; isBlocked: boolean; reason: string }) =>
    callFunction<{ versionId: string }>("admin-catalog", { action: "upsertVersion", ...input }),

  vouchers: () => callFunction<VouchersSnapshot>("admin-vouchers", { action: "list" }),
  createVoucher: (input: { code: string; label: string; planId: string; grantDays: number | null; expiresAt?: string | null; reason: string }) =>
    callFunction<{ voucherId: string }>("admin-vouchers", { action: "createVoucher", ...input }),
  setVoucherStatus: (input: { voucherId: string; status: "available" | "disabled"; reason: string }) =>
    callFunction<{ applied: true }>("admin-vouchers", { action: "setVoucherStatus", ...input }),
  createCampaign: (input: { code: string; label: string; planId: string; grantDays: number; maximumRedemptions: number | null; expiresAt?: string | null; reason: string }) =>
    callFunction<{ campaignId: string }>("admin-vouchers", { action: "createCampaign", ...input }),
  setCampaignEnabled: (input: { campaignId: string; enabled: boolean; reason: string }) =>
    callFunction<{ applied: true }>("admin-vouchers", { action: "setCampaignEnabled", ...input }),

  grantAccess: (input: { userEmail: string; planId: string; source: "manual" | "founder"; expiresAt: string | null; reason: string }) =>
    callFunction<{ grantId: string }>("admin-entitlements", { action: "grantAccess", ...input }),
  revokeAccess: (input: { grantId: string; reason: string }) =>
    callFunction<{ applied: true }>("admin-entitlements", { action: "revokeAccess", ...input }),
  listUserAccess: (userEmail: string) =>
    callFunction<UserAccessSnapshot>("admin-entitlements", { action: "listUserAccess", userEmail }),
  setFeatureOverride: (input: { userEmail: string; featureId: string; value: unknown; expiresAt: string | null; reason: string }) =>
    callFunction<{ overrideId: string }>("admin-entitlements", { action: "setFeatureOverride", ...input }),
  revokeFeatureOverride: (input: { overrideId: string; reason: string }) =>
    callFunction<{ applied: true }>("admin-entitlements", { action: "revokeFeatureOverride", ...input }),
  createLicenseKey: (input: { planId: string; maximumActivations: number; expiresAt: string | null; reason: string }) =>
    callFunction<{ licenseKeyId: string; plainKey: string }>("admin-entitlements", { action: "createLicenseKey", ...input }),
  revokeLicenseKey: (input: { licenseKeyId: string; reason: string }) =>
    callFunction<{ applied: true }>("admin-entitlements", { action: "revokeLicenseKey", ...input }),

  setRole: (input: { action: "grant" | "revoke"; targetUserId: string; roleKey: "support" | "admin"; reason: string }) =>
    callFunction<{ applied: true }>("admin-role-action", input),
};
