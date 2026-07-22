import { supabase } from "./supabaseClient";
import { sha256Hex } from "./hash";
import type {
  AuditLogEntry,
  DashboardMetrics,
  EntitlementGrant,
  EntitlementSource,
  Feature,
  LicenseActivation,
  LicenseKey,
  Plan,
  PlanFeatureValue,
  Profile,
  Referral,
  Role,
  Subscription,
  UserRole,
  LegalRegistration,
  LegalRegistrationStatus,
  Voucher,
  VoucherCampaign,
  VoucherKind,
} from "./types";

function requireClient() {
  if (!supabase) throw new Error("Supabase não configurado — defina VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY.");
  return supabase;
}

// ---------- Plans ----------
export async function listPlans(): Promise<Plan[]> {
  const { data, error } = await requireClient().from("plans").select("*").order("created_at");
  if (error) throw error;
  return data ?? [];
}

// ---------- Features / plan_features (per-plan feature flags) ----------
export async function listFeatures(): Promise<Feature[]> {
  const { data, error } = await requireClient().from("features").select("*").order("key");
  if (error) throw error;
  return data ?? [];
}

export async function listPlanFeatures(): Promise<PlanFeatureValue[]> {
  const { data, error } = await requireClient().from("plan_features").select("plan_id,feature_id,value");
  if (error) throw error;
  return data ?? [];
}

export async function setPlanFeatureValue(planId: string, featureId: string, value: boolean | number | string) {
  const { error } = await requireClient().from("plan_features")
    .upsert({ plan_id: planId, feature_id: featureId, value }, { onConflict: "plan_id,feature_id" });
  if (error) throw error;
}

// ---------- Dashboard ----------
export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const client = requireClient();
  const [subscriptions, prices, vouchers, licenses, referrals, profiles] = await Promise.all([
    client.from("subscriptions").select("status,provider_price_id", { count: "exact" }),
    client.from("stripe_prices").select("provider_price_id,billing_cycle,amount_minor,currency").eq("is_active", true),
    client.from("vouchers").select("status", { count: "exact" }),
    client.from("license_activations").select("revoked_at", { count: "exact" }).is("revoked_at", null),
    client.from("referrals").select("status", { count: "exact" }).in("status", ["qualified", "rewarded"]),
    client.from("profiles").select("id", { count: "exact", head: true }),
  ]);
  for (const result of [subscriptions, prices, vouchers, licenses, referrals, profiles]) {
    if (result.error) throw result.error;
  }
  const subs = subscriptions.data ?? [];
  const priceById = new Map((prices.data ?? []).map((price) => [price.provider_price_id, price]));
  const vList = vouchers.data ?? [];
  return {
    monthlyRecurringRevenueMinor: subs.filter((subscription) => subscription.status === "active").reduce((total, subscription) => {
      const price = priceById.get(subscription.provider_price_id);
      if (!price) return total;
      return total + (price.billing_cycle === "yearly" ? Math.round(Number(price.amount_minor) / 12) : Number(price.amount_minor));
    }, 0),
    activeSubscriptions: subs.filter((s) => s.status === "active").length,
    trialingSubscriptions: subs.filter((s) => s.status === "trialing").length,
    vouchersRedeemed: vList.filter((v) => v.status === "used").length,
    vouchersAvailable: vList.filter((v) => v.status === "available").length,
    activeLicenses: licenses.count ?? 0,
    qualifiedReferrals: referrals.count ?? 0,
    totalUsers: profiles.count ?? 0,
  };
}

// ---------- Vouchers ----------
export async function listVouchers(): Promise<Voucher[]> {
  const { data, error } = await requireClient().from("vouchers").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export interface VoucherInput {
  label: string;
  kind: VoucherKind;
  planId: string | null;
  grantDays: number | null;
  discountPercentOff: number | null;
  discountAmountOffMinor: number | null;
  expiresAt: string | null;
}

function voucherKindFields(input: VoucherInput) {
  return {
    kind: input.kind,
    plan_id: input.planId,
    grant_days: input.grantDays,
    discount_percent_off: input.discountPercentOff,
    discount_amount_off_minor: input.discountAmountOffMinor,
    discount_currency: input.discountPercentOff || input.discountAmountOffMinor ? "brl" : null,
  };
}

export async function createVoucher(input: VoucherInput & { code: string }) {
  const codeHash = await sha256Hex(input.code);
  const { error } = await requireClient().from("vouchers").insert({
    code_hash: codeHash,
    label: input.label,
    ...voucherKindFields(input),
    expires_at: input.expiresAt,
    status: "available",
  });
  if (error) throw error;
}

export async function setVoucherStatus(id: string, status: "available" | "disabled") {
  const { error } = await requireClient().from("vouchers").update({ status }).eq("id", id);
  if (error) throw error;
}

export async function updateVoucher(id: string, input: VoucherInput) {
  const { error } = await requireClient().from("vouchers")
    .update({ label: input.label, ...voucherKindFields(input), expires_at: input.expiresAt })
    .eq("id", id).neq("status", "used");
  if (error) throw error;
}

export async function deleteVoucher(id: string) {
  const { error } = await requireClient().from("vouchers").delete().eq("id", id).neq("status", "used");
  if (error) throw error;
}

// ---------- Voucher campaigns (multi-redemption codes: discount / extra days / lifetime) ----------
export async function listVoucherCampaigns(): Promise<VoucherCampaign[]> {
  const { data, error } = await requireClient().from("voucher_campaigns").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export interface VoucherCampaignInput {
  label: string;
  kind: VoucherKind;
  planId: string | null;
  grantDays: number | null;
  discountPercentOff: number | null;
  discountAmountOffMinor: number | null;
  maximumRedemptions: number | null;
  expiresAt: string | null;
}

function campaignKindFields(input: VoucherCampaignInput) {
  return {
    kind: input.kind,
    plan_id: input.planId,
    grant_days: input.grantDays,
    discount_percent_off: input.discountPercentOff,
    discount_amount_off_minor: input.discountAmountOffMinor,
    discount_currency: input.discountPercentOff || input.discountAmountOffMinor ? "brl" : null,
  };
}

export async function createVoucherCampaign(input: VoucherCampaignInput & { code: string }) {
  const codeHash = await sha256Hex(input.code);
  const { error } = await requireClient().from("voucher_campaigns").insert({
    code_hash: codeHash,
    label: input.label,
    ...campaignKindFields(input),
    maximum_redemptions: input.maximumRedemptions,
    expires_at: input.expiresAt,
    enabled: true,
  });
  if (error) throw error;
}

export async function setVoucherCampaignEnabled(id: string, enabled: boolean) {
  const { error } = await requireClient().from("voucher_campaigns").update({ enabled }).eq("id", id);
  if (error) throw error;
}

export async function updateVoucherCampaign(id: string, input: VoucherCampaignInput) {
  const { error } = await requireClient().from("voucher_campaigns")
    .update({ label: input.label, ...campaignKindFields(input), maximum_redemptions: input.maximumRedemptions, expires_at: input.expiresAt })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteVoucherCampaign(id: string) {
  const { error } = await requireClient().from("voucher_campaigns").delete().eq("id", id).eq("redemption_count", 0);
  if (error) throw error;
}

// ---------- Entitlement grants (manual access) ----------
export async function listEntitlementGrants(): Promise<EntitlementGrant[]> {
  const { data, error } = await requireClient().from("entitlement_grants").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createEntitlementGrant(input: {
  userId: string;
  planId: string | null;
  source: EntitlementSource;
  expiresAt: string | null;
}) {
  const { error } = await requireClient().from("entitlement_grants").insert({
    user_id: input.userId,
    plan_id: input.planId,
    source: input.source,
    expires_at: input.expiresAt,
  });
  if (error) throw error;
}

export async function revokeEntitlementGrant(id: string) {
  const { error } = await requireClient().from("entitlement_grants").update({ revoked_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

// ---------- Licenses ----------
export async function listLicenseKeys(): Promise<LicenseKey[]> {
  const { data, error } = await requireClient().from("license_keys").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function listLicenseActivations(): Promise<LicenseActivation[]> {
  const { data, error } = await requireClient().from("license_activations").select("*").order("activated_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createLicenseKey(input: { keySuffix: string; planId: string; maximumActivations: number; expiresAt: string | null; createdBy: string }) {
  const prefix = `QTS-${input.keySuffix.trim().toUpperCase()}`;
  const keyHash = await sha256Hex(prefix);
  const { error } = await requireClient().from("license_keys").insert({
    key_prefix: prefix,
    key_hash: keyHash,
    plan_id: input.planId,
    maximum_activations: input.maximumActivations,
    expires_at: input.expiresAt,
    created_by: input.createdBy,
  });
  if (error) throw error;
}

export async function revokeLicenseKey(id: string) {
  const { error } = await requireClient().from("license_keys").update({ revoked_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

// ---------- Users / roles ----------
export async function listProfiles(): Promise<Profile[]> {
  const { data, error } = await requireClient().rpc("admin_list_users");
  if (error) throw error;
  return data ?? [];
}

export async function listRoles(): Promise<Role[]> {
  const { data, error } = await requireClient().from("roles").select("*").order("key");
  if (error) throw error;
  return data ?? [];
}

export async function listUserRoles(): Promise<UserRole[]> {
  const { data, error } = await requireClient().from("user_roles").select("*");
  if (error) throw error;
  return data ?? [];
}

export async function grantRole(userId: string, roleId: string, grantedBy: string, reason: string) {
  const { error } = await requireClient().from("user_roles").insert({ user_id: userId, role_id: roleId, granted_by: grantedBy, reason });
  if (error) throw error;
}

export async function revokeRole(userId: string, roleId: string) {
  const { error } = await requireClient().from("user_roles").delete().eq("user_id", userId).eq("role_id", roleId);
  if (error) throw error;
}

// ---------- Read-only context for the dashboard/users screens ----------
export async function listSubscriptions(): Promise<Subscription[]> {
  const { data, error } = await requireClient().from("subscriptions").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function listReferrals(): Promise<Referral[]> {
  const { data, error } = await requireClient().from("referrals").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function listAuditLogs(limit = 100): Promise<AuditLogEntry[]> {
  const { data, error } = await requireClient().from("audit_logs").select("*").order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return data ?? [];
}

// ---------- Legal registration (INPI "Registro de Programa de Computador" status) ----------
export async function getLegalRegistration(): Promise<LegalRegistration> {
  const { data, error } = await requireClient().from("legal_registration").select("*").eq("id", true).single();
  if (error) throw error;
  return data;
}

export async function updateLegalRegistration(input: {
  status: LegalRegistrationStatus;
  softwareName: string;
  holderName: string;
  protocolNumber: string | null;
  protocolDate: string | null;
  registrationNumber: string | null;
  grantDate: string | null;
  publicQueryUrl: string | null;
  publicNotice: string | null;
}) {
  const client = requireClient();
  const { data: userData } = await client.auth.getUser();
  const { error } = await client.from("legal_registration").update({
    status: input.status,
    software_name: input.softwareName,
    holder_name: input.holderName,
    protocol_number: input.protocolNumber,
    protocol_date: input.protocolDate,
    registration_number: input.registrationNumber,
    grant_date: input.grantDate,
    public_query_url: input.publicQueryUrl,
    public_notice: input.publicNotice,
    updated_at: new Date().toISOString(),
    updated_by: userData.user?.id ?? null,
  }).eq("id", true);
  if (error) throw error;
}
