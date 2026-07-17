// Mirrors supabase/schema.sql (public schema). Kept hand-written and minimal — only the
// columns the admin UI actually reads/writes — rather than a full generated Database type,
// since there's no live project yet to generate types from.

export interface Plan {
  id: string;
  key: string;
  name: string;
  is_active: boolean;
  created_at: string;
}

export interface Profile {
  id: string;
  display_name: string | null;
  created_at: string;
  trial_started_at: string | null;
  trial_ends_at: string | null;
  email?: string | null; // joined from auth.users via the admin_user_directory view
}

export interface Role {
  id: string;
  key: string;
  description: string;
  is_system: boolean;
}

export interface UserRole {
  user_id: string;
  role_id: string;
  granted_by: string | null;
  reason: string;
  created_at: string;
}

export type EntitlementSource = "subscription" | "license" | "founder" | "manual" | "trial" | "voucher";

export interface EntitlementGrant {
  id: string;
  user_id: string;
  plan_id: string | null;
  source: EntitlementSource;
  starts_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export type VoucherStatus = "available" | "used" | "disabled";

export interface Voucher {
  id: string;
  code_hash: string;
  label: string;
  plan_id: string;
  grant_days: number | null;
  status: VoucherStatus;
  expires_at: string | null;
  redeemed_by: string | null;
  redeemed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface VoucherCampaign {
  id: string;
  code_hash: string;
  label: string;
  plan_id: string;
  grant_days: number;
  maximum_redemptions: number | null;
  redemption_count: number;
  enabled: boolean;
  expires_at: string | null;
  created_at: string;
}

export type LicenseKeyStatus = "active" | "revoked" | "expired";

export interface LicenseKey {
  id: string;
  key_prefix: string;
  plan_id: string;
  maximum_activations: number;
  expires_at: string | null;
  revoked_at: string | null;
  created_by: string;
  created_at: string;
}

export interface LicenseActivation {
  id: string;
  license_key_id: string;
  user_id: string;
  installation_id: string;
  activated_at: string;
  revoked_at: string | null;
}

export type SubscriptionStatus =
  | "incomplete"
  | "incomplete_expired"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "paused";

export interface Subscription {
  id: string;
  user_id: string;
  plan_id: string;
  provider_price_id: string;
  billing_cycle: "monthly" | "yearly";
  status: SubscriptionStatus;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  created_at: string;
}

export interface Referral {
  id: string;
  referrer_user_id: string;
  referred_user_id: string;
  status: "pending" | "qualified" | "rewarded" | "rejected";
  reward_type: "extra_days" | "discount_percent" | null;
  created_at: string;
}

export interface AuditLogEntry {
  id: number;
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  reason: string | null;
  correlation_id: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface DashboardMetrics {
  monthlyRecurringRevenueMinor: number;
  activeSubscriptions: number;
  trialingSubscriptions: number;
  vouchersRedeemed: number;
  vouchersAvailable: number;
  activeLicenses: number;
  qualifiedReferrals: number;
  totalUsers: number;
}
