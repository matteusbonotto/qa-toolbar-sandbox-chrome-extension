-- ============================================================================
-- QA Toolbar Sandbox — Supabase schema (rebuilt from scratch)
-- ============================================================================
-- Run this once on a BRAND NEW Supabase project (SQL Editor or the bootstrap
-- script below). It intentionally fails on conflicting pre-existing policies,
-- so a partially initialized database is not silently accepted as healthy.
--
-- PostgreSQL cannot create/deploy Supabase Edge Function source files. To apply
-- this schema, upload secrets and deploy every function in one operation, run:
--   npm run backend:bootstrap -- -ProjectRef <20-char-ref>
-- If this file was applied manually in the SQL Editor, add -SkipSchema; price
-- registration and function deploy still happen through authenticated APIs.
-- The script uses this file as the single database source of truth and then uses
-- the Supabase Management API for the Deno deployments.
--
-- Design notes:
-- - Every table has RLS enabled. Nothing is readable/writable by default —
--   each policy below is an explicit grant, not a restriction.
-- - The `service_role` key (used only by Edge Functions, never shipped to
--   the browser or the extension) bypasses RLS entirely, per Supabase's
--   default behavior — that's intentional: webhook/checkout/voucher-redeem
--   logic runs there, not as the end user.
-- - Founder access is enforced here, in Postgres, not just in the frontend
--   route guard. See `bootstrap_founder()` below.
-- ============================================================================

begin;

create extension if not exists pgcrypto;

-- ============================================================================
-- 1. Core reference tables: roles, plans, features
-- ============================================================================

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z][a-z0-9_-]{1,31}$'),
  description text not null,
  is_system boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z][a-z0-9._-]+$'),
  name text not null check (char_length(name) between 1 and 80),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.features (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z][a-zA-Z0-9._-]+$'),
  value_type text not null check (value_type in ('boolean', 'integer', 'string')),
  description text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.plan_features (
  plan_id uuid not null references public.plans(id) on delete cascade,
  feature_id uuid not null references public.features(id) on delete cascade,
  value jsonb not null,
  primary key (plan_id, feature_id)
);

-- ============================================================================
-- 2. Identity: profiles, user_roles
-- ============================================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (char_length(display_name) <= 120),
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  affiliate_code text unique check (affiliate_code is null or affiliate_code ~ '^QTS-[A-Z0-9]{8}$'),
  referred_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  granted_by uuid references auth.users(id),
  reason text not null check (char_length(reason) between 3 and 500),
  created_at timestamptz not null default now(),
  primary key (user_id, role_id)
);

-- ============================================================================
-- 3. Entitlements (the single source of truth for "what can this user do")
-- ============================================================================

create table if not exists public.entitlement_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid references public.plans(id),
  source text not null check (source in ('subscription', 'license', 'founder', 'manual', 'trial', 'voucher')),
  source_reference text,
  starts_at timestamptz not null default now(),
  expires_at timestamptz, -- null = permanent
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.entitlement_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  feature_id uuid not null references public.features(id) on delete cascade,
  value jsonb not null,
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  granted_by uuid not null references auth.users(id),
  reason text not null check (char_length(reason) between 3 and 500),
  created_at timestamptz not null default now()
);

create table if not exists public.installations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text check (char_length(label) <= 100),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- 4. Stripe / payments (Stripe is the financial source of truth; these
--    tables mirror it for fast reads and audit — never store card data)
-- ============================================================================

create table if not exists public.payment_customers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  provider text not null check (provider = 'stripe'),
  provider_customer_id text not null unique check (provider_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stripe_prices (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  billing_cycle text not null check (billing_cycle in ('monthly', 'yearly')),
  provider_price_id text not null unique check (provider_price_id ~ '^price_[A-Za-z0-9]+$'),
  currency text not null default 'brl' check (currency ~ '^[a-z]{3}$'),
  amount_minor bigint not null check (amount_minor > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, billing_cycle)
);

create table if not exists public.checkout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid not null references public.plans(id),
  billing_cycle text not null check (billing_cycle in ('monthly', 'yearly')),
  request_id uuid not null,
  provider_session_id text unique check (provider_session_id is null or provider_session_id ~ '^cs_'),
  checkout_url text,
  status text not null default 'creating' check (status in ('creating', 'open', 'complete', 'expired', 'failed')),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, request_id)
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid not null references public.plans(id),
  provider text not null check (provider = 'stripe'),
  provider_subscription_id text not null unique check (provider_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
  provider_price_id text not null check (provider_price_id ~ '^price_[A-Za-z0-9]+$'),
  billing_cycle text not null default 'monthly' check (billing_cycle in ('monthly', 'yearly')),
  status text not null check (status in ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  last_provider_event_created bigint not null default 0 check (last_provider_event_created >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider = 'stripe'),
  provider_event_id text not null unique,
  event_type text not null,
  status text not null default 'processing' check (status in ('processing', 'processed', 'ignored', 'failed')),
  attempts integer not null default 1 check (attempts > 0),
  last_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create table if not exists public.payment_events (
  id bigint generated always as identity primary key,
  webhook_event_id uuid not null references public.webhook_events(id),
  -- ON DELETE SET NULL (not CASCADE): account self-deletion (LGPD) must not erase financial/audit
  -- history required for fiscal retention — the row survives, anonymized, per Art. 16.
  user_id uuid references auth.users(id) on delete set null,
  provider_customer_id text,
  provider_subscription_id text,
  event_type text not null,
  amount_minor bigint check (amount_minor is null or amount_minor >= 0),
  currency text check (currency is null or currency ~ '^[a-z]{3}$'),
  created_at timestamptz not null default now()
);

-- ============================================================================
-- 5. Licenses (offline/corporate distribution — separate from subscriptions)
-- ============================================================================

create table if not exists public.license_keys (
  id uuid primary key default gen_random_uuid(),
  key_prefix text not null check (key_prefix ~ '^QTS-[A-Z0-9-]{4,32}$'),
  key_hash text not null unique check (char_length(key_hash) = 64),
  plan_id uuid not null references public.plans(id),
  maximum_activations integer not null default 1 check (maximum_activations between 1 and 10000),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.license_activations (
  id uuid primary key default gen_random_uuid(),
  license_key_id uuid not null references public.license_keys(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  installation_id uuid not null references public.installations(id) on delete cascade,
  activated_at timestamptz not null default now(),
  revoked_at timestamptz
);

-- ============================================================================
-- 6. Vouchers (single-use codes + multi-redemption campaigns)
-- ============================================================================

-- `kind` drives which fields are meaningful (enforced by *_kind_fields_check below):
--   'days'/'lifetime' -> plan_id required, grant_days set (null = lifetime), no discount fields.
--   'discount'        -> plan_id optional (null = applies to whatever plan the buyer picks at
--                         checkout), grant_days null, exactly one of discount_percent_off /
--                         discount_amount_off_minor set. Never grants instant access -- it drives
--                         a real Stripe Checkout Session (see reserve_voucher_discount below).
create table if not exists public.vouchers (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique check (code_hash ~ '^[a-f0-9]{64}$'),
  label text not null check (char_length(label) between 3 and 100),
  kind text not null check (kind in ('discount', 'days', 'lifetime')),
  plan_id uuid references public.plans(id),
  grant_days integer check (grant_days between 1 and 3650),
  discount_percent_off integer check (discount_percent_off is null or discount_percent_off between 1 and 100),
  discount_amount_off_minor bigint check (discount_amount_off_minor is null or discount_amount_off_minor > 0),
  discount_currency text check (discount_currency is null or discount_currency ~ '^[a-z]{3}$'),
  status text not null default 'available' check (status in ('available', 'used', 'disabled')),
  expires_at timestamptz,
  redeemed_by uuid references auth.users(id),
  redeemed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vouchers_kind_fields_check check (
    (kind = 'days' and grant_days is not null and plan_id is not null
      and discount_percent_off is null and discount_amount_off_minor is null)
    or (kind = 'lifetime' and grant_days is null and plan_id is not null
      and discount_percent_off is null and discount_amount_off_minor is null)
    or (kind = 'discount' and grant_days is null
      and (discount_percent_off is not null) <> (discount_amount_off_minor is not null))
  )
);

create table if not exists public.voucher_campaigns (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique check (code_hash ~ '^[a-f0-9]{64}$'),
  label text not null check (char_length(label) between 3 and 100),
  kind text not null check (kind in ('discount', 'days', 'lifetime')),
  plan_id uuid references public.plans(id),
  grant_days integer check (grant_days is null or grant_days between 1 and 36500), -- null = real lifetime; up to ~100y was the old "lifetime" convention
  discount_percent_off integer check (discount_percent_off is null or discount_percent_off between 1 and 100),
  discount_amount_off_minor bigint check (discount_amount_off_minor is null or discount_amount_off_minor > 0),
  discount_currency text check (discount_currency is null or discount_currency ~ '^[a-z]{3}$'),
  maximum_redemptions integer check (maximum_redemptions is null or maximum_redemptions > 0),
  redemption_count integer not null default 0 check (redemption_count >= 0),
  enabled boolean not null default true,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint voucher_campaigns_kind_fields_check check (
    (kind = 'days' and grant_days is not null and plan_id is not null
      and discount_percent_off is null and discount_amount_off_minor is null)
    or (kind = 'lifetime' and grant_days is null and plan_id is not null
      and discount_percent_off is null and discount_amount_off_minor is null)
    or (kind = 'discount' and grant_days is null
      and (discount_percent_off is not null) <> (discount_amount_off_minor is not null))
  )
);

create table if not exists public.voucher_campaign_redemptions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.voucher_campaigns(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  entitlement_grant_id uuid not null references public.entitlement_grants(id),
  redeemed_at timestamptz not null default now(),
  unique (campaign_id, user_id) -- one redemption per user per campaign
);

-- Backs the anti-double-discount guarantee for kind='discount' vouchers: keyed by (user_id,
-- request_id), the same request_id uuid the front end generates before ever calling Stripe, so we
-- can reserve the voucher BEFORE creating the Checkout Session (whose own id only exists after).
-- See reserve_voucher_discount / release_voucher_reservation / finalize_voucher_reservation.
create table if not exists public.voucher_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  voucher_id uuid references public.vouchers(id) on delete cascade,
  campaign_id uuid references public.voucher_campaigns(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'completed', 'released')),
  reserved_at timestamptz not null default now(),
  expires_at timestamptz not null,
  completed_at timestamptz,
  released_at timestamptz,
  check ((voucher_id is not null) <> (campaign_id is not null)),
  unique (user_id, request_id)
);

-- ============================================================================
-- 7. Affiliates / referrals
-- ============================================================================

create table if not exists public.referral_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  referral_code text not null unique check (referral_code ~ '^QTS-[A-F0-9]{8}$'),
  qualified_referrals integer not null default 0 check (qualified_referrals >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_user_id uuid not null references auth.users(id) on delete cascade,
  referred_user_id uuid not null unique references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'qualified', 'rewarded', 'rejected')),
  reward_type text check (reward_type in ('extra_days', 'discount_percent')),
  reward_reference text,
  qualified_at timestamptz,
  rewarded_at timestamptz,
  created_at timestamptz not null default now(),
  check (referrer_user_id <> referred_user_id)
);

-- ============================================================================
-- 8. Operational tables: audit, versions, notices, feature flags, rate limits,
--    and founder password + email OTP challenges
-- ============================================================================

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id),
  action text not null check (char_length(action) between 3 and 120),
  target_type text not null,
  target_id text,
  reason text,
  correlation_id uuid not null default gen_random_uuid(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.app_versions (
  id uuid primary key default gen_random_uuid(),
  version text not null unique check (version ~ '^[0-9]+\.[0-9]+\.[0-9]+([+-][A-Za-z0-9.-]+)?$'),
  minimum_supported_version text not null,
  is_blocked boolean not null default false,
  released_at timestamptz not null default now()
);

-- Single-row (id is always `true`) tracker for whether the Chrome Web Store listing has caught
-- up with the latest package — the founder updates it by hand via the Supabase dashboard
-- whenever they check the real Chrome Web Store Developer Dashboard; nothing here is automated.
create table if not exists public.store_listing_status (
  id boolean primary key default true check (id),
  chrome_web_store_version text,
  status text not null default 'pending_review' check (status in ('pending_review', 'live', 'rejected')),
  updated_at timestamptz not null default now()
);
insert into public.store_listing_status (id) values (true) on conflict (id) do nothing;

-- Single-row tracker for the QA Toolbar Sandbox INPI "Registro de Programa de Computador"
-- process. The founder updates it via the admin panel as the real-world process advances;
-- nothing here is automated or inferred, and the LP/extension only ever render what's actually
-- stored -- never a claim ahead of reality. No sensitive fields (CPF, GRU number, bank details,
-- signed documents) live here, so the whole row is safe to expose publicly as-is.
create table if not exists public.legal_registration (
  id boolean primary key default true check (id),
  status text not null default 'preparation'
    check (status in ('preparation', 'payment_pending', 'protocolled', 'registered')),
  software_name text not null default 'QA Toolbar Sandbox',
  holder_name text not null default 'Matheus Alves Bonotto Santos',
  protocol_number text,
  protocol_date date,
  registration_number text,
  grant_date date,
  public_query_url text,
  public_notice text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  constraint legal_registration_protocolled_fields check (
    status <> 'protocolled' or (protocol_number is not null and protocol_date is not null)
  ),
  constraint legal_registration_registered_fields check (
    status <> 'registered' or (registration_number is not null and grant_date is not null)
  )
);
insert into public.legal_registration (id) values (true) on conflict (id) do nothing;

create table if not exists public.system_notices (
  id uuid primary key default gen_random_uuid(),
  severity text not null check (severity in ('info', 'warning', 'critical')),
  title text not null check (char_length(title) between 1 and 120),
  message text not null check (char_length(message) between 1 and 2000),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  is_active boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.feature_flags (
  key text primary key check (key ~ '^[a-z][a-zA-Z0-9._-]+$'),
  enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  description text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.api_rate_limits (
  key_hash text not null,
  window_started_at timestamptz not null,
  request_count integer not null default 1 check (request_count > 0),
  primary key (key_hash, window_started_at)
);

create table if not exists public.admin_otp_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  password_authenticated_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check (consumed_at is null or consumed_at >= created_at)
);

create table if not exists public.admin_mfa_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  verified_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > verified_at),
  check (expires_at <= verified_at + interval '60 minutes'),
  check (revoked_at is null or revoked_at >= verified_at)
);

-- ============================================================================
-- Indexes
-- ============================================================================

create index if not exists idx_entitlement_grants_user on public.entitlement_grants(user_id) where revoked_at is null;
create unique index if not exists idx_entitlement_grants_source_reference
  on public.entitlement_grants(user_id, source, source_reference)
  where source_reference is not null;
create index if not exists idx_user_roles_user on public.user_roles(user_id);
create index if not exists idx_subscriptions_user on public.subscriptions(user_id);
create index if not exists idx_subscriptions_status on public.subscriptions(status);
create index if not exists idx_checkout_sessions_user on public.checkout_sessions(user_id, created_at desc);
create index if not exists idx_vouchers_status on public.vouchers(status);
create index if not exists idx_voucher_campaigns_enabled on public.voucher_campaigns(enabled);
-- The real guarantee against a race is these unique indexes, not the plpgsql checks in the RPCs.
create unique index if not exists idx_voucher_reservations_voucher_pending
  on public.voucher_reservations(voucher_id) where status = 'pending';
create unique index if not exists idx_voucher_reservations_campaign_user_active
  on public.voucher_reservations(campaign_id, user_id) where status in ('pending', 'completed');
create index if not exists idx_voucher_reservations_campaign_pending
  on public.voucher_reservations(campaign_id) where status = 'pending';
create index if not exists idx_license_activations_license on public.license_activations(license_key_id) where revoked_at is null;
create index if not exists idx_installations_user on public.installations(user_id);
create index if not exists idx_referrals_referrer on public.referrals(referrer_user_id);
create index if not exists idx_audit_logs_actor on public.audit_logs(actor_id);
create index if not exists idx_payment_events_user on public.payment_events(user_id);
create index if not exists idx_admin_otp_challenges_user_active
  on public.admin_otp_challenges(user_id, expires_at desc)
  where consumed_at is null;
create index if not exists idx_admin_mfa_sessions_user_active
  on public.admin_mfa_sessions(user_id, expires_at desc)
  where revoked_at is null;

-- ============================================================================
-- Triggers: updated_at bookkeeping + auto-create profile on signup
-- ============================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['profiles', 'payment_customers', 'stripe_prices', 'checkout_sessions', 'subscriptions', 'referral_profiles', 'vouchers', 'voucher_campaigns']
  loop
    execute format(
      'drop trigger if exists trg_set_updated_at on public.%I; create trigger trg_set_updated_at before update on public.%I for each row execute function public.set_updated_at();',
      t, t
    );
  end loop;
end $$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, trial_started_at, trial_ends_at, affiliate_code)
  values (new.id, now(), now() + interval '30 days', 'QTS-' || upper(substr(replace(new.id::text, '-', ''), 1, 8)))
  on conflict (id) do nothing;
  insert into public.referral_profiles (user_id, referral_code)
  select new.id, affiliate_code from public.profiles where id = new.id
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_handle_new_user on auth.users;
create trigger trg_handle_new_user
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- Founder bootstrap — this is the actual security boundary, not the frontend.
-- Only the exact, hardcoded, verified email may ever receive the founder
-- role, and only for itself (no one can grant founder to anyone else).
-- ============================================================================

create or replace function public.bootstrap_founder()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := auth.uid();
  caller_email text;
  caller_confirmed boolean;
  founder_role_id uuid;
begin
  if caller_id is null then
    raise exception 'not authenticated';
  end if;

  select email, (email_confirmed_at is not null) into caller_email, caller_confirmed
  from auth.users where id = caller_id;

  if lower(coalesce(caller_email, '')) <> 'matteusbonotto+admin@gmail.com' or coalesce(caller_confirmed, false) = false then
    insert into public.audit_logs (actor_id, action, target_type, target_id, reason, metadata)
    values (caller_id, 'bootstrap_founder.denied', 'user_roles', caller_id::text, 'email not authorized or unverified', jsonb_build_object('email', caller_email));
    return false;
  end if;

  select id into founder_role_id from public.roles where key = 'founder';
  if founder_role_id is null then
    insert into public.roles (key, description, is_system) values ('founder', 'Founder — full administrative access', true)
    returning id into founder_role_id;
  end if;

  perform set_config('app.bootstrap_context', 'true', true);
  insert into public.user_roles (user_id, role_id, granted_by, reason)
  values (caller_id, founder_role_id, caller_id, 'bootstrap_founder: authorized founder email')
  on conflict (user_id, role_id) do nothing;

  insert into public.audit_logs (actor_id, action, target_type, target_id, reason, metadata)
  values (caller_id, 'bootstrap_founder.granted', 'user_roles', caller_id::text, 'authorized founder email', jsonb_build_object('email', caller_email));

  return true;
end;
$$;

-- Guard rail even against a compromised/buggy client: nobody can insert a
-- 'founder' row into user_roles except through bootstrap_founder() above
-- (which sets the app.bootstrap_context GUC for the duration of its own
-- transaction). Regular admin role grants (e.g. "support") are unaffected.
create or replace function public.guard_founder_role_grant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  role_key text;
  in_bootstrap boolean;
begin
  select key into role_key from public.roles where id = new.role_id;
  if role_key = 'founder' then
    in_bootstrap := coalesce(current_setting('app.bootstrap_context', true), 'false') = 'true';
    if not in_bootstrap then
      raise exception 'founder role can only be granted via bootstrap_founder()';
    end if;
  end if;
  if new.user_id = new.granted_by and role_key <> 'founder' then
    raise exception 'users may not grant roles to themselves';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_founder_role_grant on public.user_roles;
create trigger trg_guard_founder_role_grant
  before insert on public.user_roles
  for each row execute function public.guard_founder_role_grant();

-- ============================================================================
-- Helpers: founder access requires both the role and a live 60-minute proof
-- issued only after password + email OTP verification. The custom header is
-- hashed before comparison; the raw bearer proof is never stored in Postgres.
-- ============================================================================

create or replace function public.current_admin_mfa_token_hash()
returns text
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  headers jsonb;
  raw_token text;
begin
  headers := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  raw_token := coalesce(headers ->> 'x-admin-mfa-token', '');
  if raw_token !~ '^[A-Za-z0-9_-]{43}$' then
    return null;
  end if;
  return encode(extensions.digest(raw_token, 'sha256'), 'hex');
exception
  when others then
    return null;
end;
$$;
revoke all on function public.current_admin_mfa_token_hash() from public, anon, authenticated;

create or replace function public.is_founder()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    join public.admin_mfa_sessions m on m.user_id = ur.user_id
    where ur.user_id = auth.uid()
      and r.key = 'founder'
      and m.token_hash = public.current_admin_mfa_token_hash()
      and m.revoked_at is null
      and m.expires_at > now()
  );
$$;

create or replace function public.admin_mfa_expires_at()
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select max(m.expires_at)
  from public.admin_mfa_sessions m
  join public.user_roles ur on ur.user_id = m.user_id
  join public.roles r on r.id = ur.role_id and r.key = 'founder'
  where m.user_id = auth.uid()
    and m.token_hash = public.current_admin_mfa_token_hash()
    and m.revoked_at is null
    and m.expires_at > now();
$$;
revoke all on function public.admin_mfa_expires_at() from public, anon;
grant execute on function public.admin_mfa_expires_at() to authenticated, service_role;

-- Supabase's built-in reauthentication mail sends an 8-digit nonce and only
-- runs for an already authenticated user. This service-role-only verifier binds
-- that nonce to the preceding password challenge and creates the RLS proof.
create or replace function public.verify_admin_reauthentication_otp(
  user_id_input uuid,
  challenge_id_input uuid,
  nonce_input text,
  token_hash_input text
)
returns timestamptz
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  challenge_user_id uuid;
  challenge_email text;
  challenge_created_at timestamptz;
  challenge_expires_at timestamptz;
  challenge_consumed_at timestamptz;
  user_email text;
  reauthentication_token text;
  reauthentication_sent_at timestamptz;
  expected_token text;
  session_expires_at timestamptz;
begin
  if nonce_input !~ '^[0-9]{8}$' or token_hash_input !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid_or_expired_otp';
  end if;

  select c.user_id, c.email, c.created_at, c.expires_at, c.consumed_at,
         u.email, u.reauthentication_token, u.reauthentication_sent_at
  into challenge_user_id, challenge_email, challenge_created_at,
       challenge_expires_at, challenge_consumed_at, user_email,
       reauthentication_token, reauthentication_sent_at
  from public.admin_otp_challenges c
  join auth.users u on u.id = c.user_id
  where c.id = challenge_id_input and c.user_id = user_id_input
  for update of c, u;

  if challenge_user_id is null
    or challenge_consumed_at is not null
    or challenge_expires_at <= now()
    or lower(coalesce(challenge_email, '')) <> 'matteusbonotto+admin@gmail.com'
    or lower(coalesce(user_email, '')) <> lower(challenge_email)
    or coalesce(reauthentication_token, '') = ''
    or reauthentication_sent_at is null
    or reauthentication_sent_at < challenge_created_at
    or reauthentication_sent_at < now() - interval '10 minutes' then
    raise exception 'invalid_or_expired_otp';
  end if;

  expected_token := encode(extensions.digest(user_email || nonce_input, 'sha224'), 'hex');
  if expected_token <> reauthentication_token then
    raise exception 'invalid_or_expired_otp';
  end if;

  update public.admin_otp_challenges set consumed_at = now()
  where id = challenge_id_input and consumed_at is null;
  update auth.users set reauthentication_token = '' where id = user_id_input;
  update public.admin_mfa_sessions set revoked_at = now()
  where user_id = user_id_input and revoked_at is null;

  session_expires_at := now() + interval '60 minutes';
  insert into public.admin_mfa_sessions (user_id, token_hash, verified_at, expires_at)
  values (user_id_input, token_hash_input, now(), session_expires_at);
  insert into public.audit_logs (actor_id, action, target_type, target_id, reason, metadata)
  values (user_id_input, 'admin.otp_verified', 'admin_mfa_sessions', challenge_id_input::text,
    'password and reauthentication email OTP verified', jsonb_build_object('expires_at', session_expires_at));
  return session_expires_at;
end;
$$;
revoke all on function public.verify_admin_reauthentication_otp(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.verify_admin_reauthentication_otp(uuid, uuid, text, text) to service_role;

-- Founder-only directory of users (exposes auth.users.email, which isn't
-- otherwise selectable from the client) — used by the admin Users screen.
create or replace function public.admin_list_users()
returns table (id uuid, email text, display_name text, trial_ends_at timestamptz, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_founder() then
    raise exception 'forbidden';
  end if;
  return query
    select u.id, u.email::text, p.display_name, p.trial_ends_at, p.created_at
    from auth.users u
    join public.profiles p on p.id = u.id
    order by p.created_at desc;
end;
$$;

-- Atomic rate limiting for service-role Edge Functions.
create or replace function public.consume_rate_limit(
  request_key_hash text,
  maximum_requests integer,
  window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_window timestamptz;
  next_count integer;
begin
  if request_key_hash !~ '^[a-f0-9]{64}$' or maximum_requests < 1 or window_seconds < 1 then
    raise exception 'invalid_rate_limit_arguments';
  end if;
  current_window := to_timestamp(floor(extract(epoch from now()) / window_seconds) * window_seconds);
  insert into public.api_rate_limits (key_hash, window_started_at, request_count)
  values (request_key_hash, current_window, 1)
  on conflict (key_hash, window_started_at) do update
    set request_count = public.api_rate_limits.request_count + 1
  returning request_count into next_count;
  return next_count <= maximum_requests;
end;
$$;
revoke all on function public.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;

-- Voucher lookup, grant creation and redemption happen in one transaction. Row locks
-- prevent two concurrent requests from consuming the same voucher or campaign slot.
create or replace function public.redeem_voucher(target_user_id uuid, voucher_hash text)
returns table(label text, access_expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  campaign public.voucher_campaigns%rowtype;
  selected public.vouchers%rowtype;
  ending timestamptz;
  created_grant_id uuid;
begin
  if voucher_hash !~ '^[a-f0-9]{64}$' or not exists (select 1 from auth.users where id = target_user_id) then
    raise exception 'voucher_unavailable';
  end if;

  select * into campaign from public.voucher_campaigns
  where code_hash = voucher_hash and kind in ('days', 'lifetime') and enabled and (expires_at is null or expires_at > now())
  for update;
  if campaign.id is not null then
    if campaign.maximum_redemptions is not null and campaign.redemption_count >= campaign.maximum_redemptions then
      raise exception 'voucher_unavailable';
    end if;
    if exists (select 1 from public.voucher_campaign_redemptions where campaign_id = campaign.id and user_id = target_user_id) then
      raise exception 'voucher_already_redeemed';
    end if;
    ending := case when campaign.grant_days is null then null else now() + make_interval(days => campaign.grant_days) end;
    insert into public.entitlement_grants (user_id, plan_id, source, starts_at, expires_at)
    values (target_user_id, campaign.plan_id, 'voucher', now(), ending)
    returning id into created_grant_id;
    insert into public.voucher_campaign_redemptions (campaign_id, user_id, entitlement_grant_id)
    values (campaign.id, target_user_id, created_grant_id);
    update public.voucher_campaigns set redemption_count = redemption_count + 1 where id = campaign.id;
    insert into public.audit_logs (actor_id, action, target_type, target_id, reason, metadata)
    values (target_user_id, 'voucher.redeemed', 'voucher_campaign', campaign.id::text, 'Self-service campaign redemption', jsonb_build_object('label', campaign.label));
    return query select campaign.label, ending;
    return;
  end if;

  select * into selected from public.vouchers
  where code_hash = voucher_hash and kind in ('days', 'lifetime') and status = 'available' and (expires_at is null or expires_at > now())
  for update skip locked;
  if selected.id is null then raise exception 'voucher_unavailable'; end if;
  ending := case when selected.grant_days is null then null else now() + make_interval(days => selected.grant_days) end;
  update public.vouchers set status = 'used', redeemed_by = target_user_id, redeemed_at = now() where id = selected.id;
  insert into public.entitlement_grants (user_id, plan_id, source, starts_at, expires_at)
  values (target_user_id, selected.plan_id, 'voucher', now(), ending);
  insert into public.audit_logs (actor_id, action, target_type, target_id, reason, metadata)
  values (target_user_id, 'voucher.redeemed', 'voucher', selected.id::text, 'Self-service voucher redemption', jsonb_build_object('label', selected.label));
  return query select selected.label, ending;
end;
$$;
revoke all on function public.redeem_voucher(uuid, text) from public, anon, authenticated;
grant execute on function public.redeem_voucher(uuid, text) to service_role;

-- Reserve a discount voucher before creating a Stripe Checkout Session -- idempotent per
-- (user_id, request_id), so a retry with the same request_id hands back the same reservation
-- instead of double-reserving. Capacity checks count active 'pending' reservations alongside
-- redemption_count so concurrent in-flight checkouts can't oversell a limited campaign.
create or replace function public.reserve_voucher_discount(
  target_user_id uuid, voucher_hash text, request_id_input uuid, reservation_ttl_minutes integer default 35
)
returns table(
  kind text, label text, target_plan_id uuid,
  percent_off integer, amount_off_minor bigint, discount_currency text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  campaign public.voucher_campaigns%rowtype;
  selected public.vouchers%rowtype;
  existing public.voucher_reservations%rowtype;
  active_count integer;
begin
  if voucher_hash !~ '^[a-f0-9]{64}$' or request_id_input is null then raise exception 'voucher_unavailable'; end if;

  select * into existing from public.voucher_reservations
  where user_id = target_user_id and request_id = request_id_input and status = 'pending';
  if existing.id is not null then
    if existing.campaign_id is not null then
      select * into campaign from public.voucher_campaigns where id = existing.campaign_id;
      return query select campaign.kind, campaign.label, campaign.plan_id, campaign.discount_percent_off, campaign.discount_amount_off_minor, campaign.discount_currency;
      return;
    else
      select * into selected from public.vouchers where id = existing.voucher_id;
      return query select selected.kind, selected.label, selected.plan_id, selected.discount_percent_off, selected.discount_amount_off_minor, selected.discount_currency;
      return;
    end if;
  end if;

  select * into campaign from public.voucher_campaigns
  where code_hash = voucher_hash and kind = 'discount' and enabled and (expires_at is null or expires_at > now())
  for update;
  if campaign.id is not null then
    update public.voucher_reservations set status = 'released', released_at = now()
    where campaign_id = campaign.id and status = 'pending' and expires_at < now();
    if exists (select 1 from public.voucher_reservations where campaign_id = campaign.id and user_id = target_user_id and status in ('pending', 'completed')) then
      raise exception 'voucher_already_redeemed';
    end if;
    select count(*) into active_count from public.voucher_reservations where campaign_id = campaign.id and status = 'pending';
    if campaign.maximum_redemptions is not null and (campaign.redemption_count + active_count) >= campaign.maximum_redemptions then
      raise exception 'voucher_unavailable';
    end if;
    insert into public.voucher_reservations (user_id, request_id, campaign_id, expires_at)
    values (target_user_id, request_id_input, campaign.id, now() + make_interval(mins => reservation_ttl_minutes));
    return query select campaign.kind, campaign.label, campaign.plan_id, campaign.discount_percent_off, campaign.discount_amount_off_minor, campaign.discount_currency;
    return;
  end if;

  select * into selected from public.vouchers
  where code_hash = voucher_hash and kind = 'discount' and status = 'available' and (expires_at is null or expires_at > now())
  for update skip locked;
  if selected.id is null then raise exception 'voucher_unavailable'; end if;
  update public.voucher_reservations set status = 'released', released_at = now()
  where voucher_id = selected.id and status = 'pending' and expires_at < now();
  if exists (select 1 from public.voucher_reservations where voucher_id = selected.id and status = 'pending') then
    raise exception 'voucher_unavailable';
  end if;
  insert into public.voucher_reservations (user_id, request_id, voucher_id, expires_at)
  values (target_user_id, request_id_input, selected.id, now() + make_interval(mins => reservation_ttl_minutes));
  return query select selected.kind, selected.label, selected.plan_id, selected.discount_percent_off, selected.discount_amount_off_minor, selected.discount_currency;
end;
$$;
revoke all on function public.reserve_voucher_discount(uuid, text, uuid, integer) from public, anon, authenticated;
grant execute on function public.reserve_voucher_discount(uuid, text, uuid, integer) to service_role;

-- Called by the Stripe webhook on checkout.session.expired (or right after a reservation if
-- session creation itself then fails) so an abandoned discount voucher isn't stuck reserved.
create or replace function public.release_voucher_reservation(request_id_input uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.voucher_reservations set status = 'released', released_at = now()
  where request_id = request_id_input and status = 'pending';
  return found;
end;
$$;
revoke all on function public.release_voucher_reservation(uuid) from public, anon, authenticated;
grant execute on function public.release_voucher_reservation(uuid) to service_role;

-- Called by the Stripe webhook on checkout.session.completed, after the subscription itself has
-- been synchronized -- this is the only place a discount voucher actually gets consumed.
create or replace function public.finalize_voucher_reservation(request_id_input uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare reservation public.voucher_reservations%rowtype;
begin
  select * into reservation from public.voucher_reservations where request_id = request_id_input and status = 'pending' for update;
  if reservation.id is null then return false; end if;
  if reservation.voucher_id is not null then
    update public.vouchers set status = 'used', redeemed_by = reservation.user_id, redeemed_at = now()
    where id = reservation.voucher_id and status <> 'used';
  end if;
  if reservation.campaign_id is not null then
    update public.voucher_campaigns set redemption_count = redemption_count + 1 where id = reservation.campaign_id;
  end if;
  update public.voucher_reservations set status = 'completed', completed_at = now() where id = reservation.id;
  insert into public.audit_logs (actor_id, action, target_type, target_id, reason, metadata)
  values (reservation.user_id, 'voucher.discount_finalized',
    case when reservation.voucher_id is not null then 'voucher' else 'voucher_campaign' end,
    coalesce(reservation.voucher_id, reservation.campaign_id)::text,
    'Stripe checkout completed with discount voucher', jsonb_build_object('request_id', request_id_input));
  return true;
end;
$$;
revoke all on function public.finalize_voucher_reservation(uuid) from public, anon, authenticated;
grant execute on function public.finalize_voucher_reservation(uuid) to service_role;

create or replace function public.activate_free_trial(target_user_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  free_plan_id uuid;
  trial_end timestamptz;
begin
  select id into free_plan_id from public.plans where key = 'smoke-test' and is_active;
  select trial_ends_at into trial_end from public.profiles where id = target_user_id for update;
  if free_plan_id is null or trial_end is null or trial_end <= now() then
    raise exception 'free_trial_unavailable';
  end if;
  if exists (
    select 1 from public.entitlement_grants
    where user_id = target_user_id and revoked_at is null
      and starts_at <= now() and (expires_at is null or expires_at > now())
      and source <> 'trial'
  ) then
    raise exception 'active_entitlement_exists';
  end if;
  insert into public.entitlement_grants (user_id, plan_id, source, source_reference, expires_at)
  values (target_user_id, free_plan_id, 'trial', 'initial-free-trial', trial_end)
  on conflict (user_id, source, source_reference) where source_reference is not null
  do update set revoked_at = null, expires_at = excluded.expires_at;
  return trial_end;
end;
$$;
revoke all on function public.activate_free_trial(uuid) from public, anon, authenticated;
grant execute on function public.activate_free_trial(uuid) to service_role;

create or replace function public.register_referral(target_user_id uuid, referral_code_input text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  referrer_id uuid;
begin
  select user_id into referrer_id from public.referral_profiles
  where public.referral_profiles.referral_code = upper(trim(referral_code_input));
  if referrer_id is null or referrer_id = target_user_id then return false; end if;
  if exists (select 1 from public.referrals where referred_user_id = target_user_id) then return false; end if;
  insert into public.referrals (referrer_user_id, referred_user_id, status)
  values (referrer_id, target_user_id, 'pending');
  insert into public.audit_logs (actor_id, action, target_type, target_id, reason)
  values (target_user_id, 'referral.registered', 'referral', referrer_id::text, 'Self-service referral registration');
  return true;
exception when unique_violation then
  return false;
end;
$$;
revoke all on function public.register_referral(uuid, text) from public, anon, authenticated;
grant execute on function public.register_referral(uuid, text) to service_role;

create or replace function public.reward_referral(referred_user_id_input uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  referral_row public.referrals%rowtype;
  reward_plan_id uuid;
  reward_grant_id uuid;
begin
  select * into referral_row from public.referrals
  where referred_user_id = referred_user_id_input and status = 'pending'
  for update skip locked;
  if referral_row.id is null then return false; end if;
  select id into reward_plan_id from public.plans where key = 'regression-runner' and is_active;
  if reward_plan_id is null then raise exception 'referral_reward_plan_missing'; end if;
  insert into public.entitlement_grants (user_id, plan_id, source, source_reference, expires_at)
  values (referral_row.referrer_user_id, reward_plan_id, 'manual', 'referral:' || referral_row.id::text, now() + interval '30 days')
  returning id into reward_grant_id;
  update public.referrals set status = 'rewarded', qualified_at = now(), rewarded_at = now(),
    reward_type = 'extra_days', reward_reference = reward_grant_id::text
  where id = referral_row.id;
  update public.referral_profiles set qualified_referrals = qualified_referrals + 1
  where user_id = referral_row.referrer_user_id;
  return true;
end;
$$;
revoke all on function public.reward_referral(uuid) from public, anon, authenticated;
grant execute on function public.reward_referral(uuid) to service_role;

create or replace function public.sync_stripe_subscription(
  target_user_id uuid,
  target_plan_id uuid,
  stripe_subscription_id text,
  stripe_price_id text,
  subscription_status text,
  billing_interval text,
  period_start timestamptz,
  period_end timestamptz,
  will_cancel boolean,
  canceled_timestamp timestamptz,
  provider_event_created bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  subscription_row_id uuid;
  previous_event bigint;
  previous_user_id uuid;
begin
  if subscription_status not in ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused')
    or billing_interval not in ('monthly', 'yearly') then
    raise exception 'invalid_subscription_state';
  end if;
  select id, last_provider_event_created, user_id into subscription_row_id, previous_event, previous_user_id
  from public.subscriptions where provider_subscription_id = stripe_subscription_id for update;
  if previous_user_id is not null and previous_user_id <> target_user_id then
    raise exception 'subscription_user_mismatch';
  end if;
  if previous_event is not null and previous_event > provider_event_created then return false; end if;

  insert into public.subscriptions (
    user_id, plan_id, provider, provider_subscription_id, provider_price_id, billing_cycle,
    status, current_period_start, current_period_end, cancel_at_period_end, canceled_at, last_provider_event_created
  ) values (
    target_user_id, target_plan_id, 'stripe', stripe_subscription_id, stripe_price_id, billing_interval,
    subscription_status, period_start, period_end, coalesce(will_cancel, false), canceled_timestamp, provider_event_created
  )
  on conflict (provider_subscription_id) do update set
    plan_id = excluded.plan_id, provider_price_id = excluded.provider_price_id,
    billing_cycle = excluded.billing_cycle, status = excluded.status,
    current_period_start = excluded.current_period_start, current_period_end = excluded.current_period_end,
    cancel_at_period_end = excluded.cancel_at_period_end, canceled_at = excluded.canceled_at,
    last_provider_event_created = excluded.last_provider_event_created;

  if subscription_status in ('trialing', 'active', 'past_due') then
    insert into public.entitlement_grants (user_id, plan_id, source, source_reference, starts_at, expires_at)
    values (target_user_id, target_plan_id, 'subscription', stripe_subscription_id, coalesce(period_start, now()), period_end)
    on conflict (user_id, source, source_reference) where source_reference is not null
    do update set plan_id = excluded.plan_id, starts_at = excluded.starts_at,
      expires_at = excluded.expires_at, revoked_at = null;
  else
    update public.entitlement_grants set revoked_at = coalesce(revoked_at, now())
    where user_id = target_user_id and source = 'subscription' and source_reference = stripe_subscription_id;
  end if;
  return true;
end;
$$;
revoke all on function public.sync_stripe_subscription(uuid, uuid, text, text, text, text, timestamptz, timestamptz, boolean, timestamptz, bigint) from public, anon, authenticated;
grant execute on function public.sync_stripe_subscription(uuid, uuid, text, text, text, text, timestamptz, timestamptz, boolean, timestamptz, bigint) to service_role;

create or replace function public.configure_stripe_price(
  plan_key_input text,
  billing_cycle_input text,
  provider_price_id_input text,
  amount_minor_input bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_plan_id uuid;
  configured_id uuid;
begin
  select id into target_plan_id from public.plans where key = plan_key_input and is_active;
  if target_plan_id is null or billing_cycle_input not in ('monthly', 'yearly')
    or provider_price_id_input !~ '^price_[A-Za-z0-9]+$' or amount_minor_input <= 0 then
    raise exception 'invalid_stripe_price_configuration';
  end if;
  insert into public.stripe_prices (plan_id, billing_cycle, provider_price_id, amount_minor, is_active)
  values (target_plan_id, billing_cycle_input, provider_price_id_input, amount_minor_input, true)
  on conflict (plan_id, billing_cycle) do update set
    provider_price_id = excluded.provider_price_id,
    amount_minor = excluded.amount_minor,
    is_active = true
  returning id into configured_id;
  return configured_id;
end;
$$;
revoke all on function public.configure_stripe_price(text, text, text, bigint) from public, anon, authenticated;
grant execute on function public.configure_stripe_price(text, text, text, bigint) to service_role;

-- ============================================================================
-- Row Level Security
-- ============================================================================

alter table public.roles enable row level security;
alter table public.plans enable row level security;
alter table public.features enable row level security;
alter table public.plan_features enable row level security;
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.entitlement_grants enable row level security;
alter table public.entitlement_overrides enable row level security;
alter table public.installations enable row level security;
alter table public.payment_customers enable row level security;
alter table public.stripe_prices enable row level security;
alter table public.checkout_sessions enable row level security;
alter table public.subscriptions enable row level security;
alter table public.webhook_events enable row level security;
alter table public.payment_events enable row level security;
alter table public.license_keys enable row level security;
alter table public.license_activations enable row level security;
alter table public.vouchers enable row level security;
alter table public.voucher_campaigns enable row level security;
alter table public.voucher_campaign_redemptions enable row level security;
alter table public.voucher_reservations enable row level security;
alter table public.referrals enable row level security;
alter table public.referral_profiles enable row level security;
alter table public.audit_logs enable row level security;
alter table public.app_versions enable row level security;
alter table public.store_listing_status enable row level security;
alter table public.legal_registration enable row level security;
alter table public.system_notices enable row level security;
alter table public.feature_flags enable row level security;
alter table public.api_rate_limits enable row level security;
alter table public.admin_otp_challenges enable row level security;
alter table public.admin_mfa_sessions enable row level security;

-- Public read: plans/features/plan_features/app_versions/system_notices/feature_flags
-- are what the LP and the extension need to render prices/limits/notices without
-- being authenticated at all.
create policy "plans are publicly readable" on public.plans for select using (is_active);
create policy "features are publicly readable" on public.features for select using (true);
create policy "plan_features are publicly readable" on public.plan_features for select using (true);
create policy "app_versions are publicly readable" on public.app_versions for select using (true);
create policy "store_listing_status is publicly readable" on public.store_listing_status for select using (true);
create policy "legal_registration is publicly readable" on public.legal_registration for select using (true);
create policy "active system_notices are publicly readable" on public.system_notices for select using (is_active);
create policy "feature_flags are publicly readable" on public.feature_flags for select using (true);
create policy "active stripe_prices are publicly readable" on public.stripe_prices for select using (is_active);

create policy "founder manages plans" on public.plans for all using (public.is_founder()) with check (public.is_founder());
create policy "founder manages features" on public.features for all using (public.is_founder()) with check (public.is_founder());
create policy "founder manages plan_features" on public.plan_features for all using (public.is_founder()) with check (public.is_founder());
create policy "founder manages app_versions" on public.app_versions for all using (public.is_founder()) with check (public.is_founder());
create policy "founder manages store_listing_status" on public.store_listing_status for all using (public.is_founder()) with check (public.is_founder());
create policy "founder manages legal_registration" on public.legal_registration for all using (public.is_founder()) with check (public.is_founder());
create policy "founder manages system_notices" on public.system_notices for all using (public.is_founder()) with check (public.is_founder());
create policy "founder manages feature_flags" on public.feature_flags for all using (public.is_founder()) with check (public.is_founder());
create policy "founder manages stripe_prices" on public.stripe_prices for all using (public.is_founder()) with check (public.is_founder());

-- roles: founder-only (the role catalog itself isn't public information)
create policy "founder reads roles" on public.roles for select using (public.is_founder());
create policy "founder manages roles" on public.roles for all using (public.is_founder()) with check (public.is_founder());

-- profiles: user reads/updates own row; founder reads/updates all
create policy "user reads own profile" on public.profiles for select using (auth.uid() = id or public.is_founder());
create policy "user updates own profile" on public.profiles for update using (auth.uid() = id or public.is_founder()) with check (auth.uid() = id or public.is_founder());

-- user_roles: user reads own role assignments; founder full access (writes still gated
-- by the guard_founder_role_grant trigger above regardless of RLS)
create policy "user reads own roles" on public.user_roles for select using (auth.uid() = user_id or public.is_founder());
create policy "founder grants roles" on public.user_roles for insert with check (public.is_founder());
create policy "founder revokes roles" on public.user_roles for delete using (public.is_founder());

-- entitlement_grants: user reads own; founder full
create policy "user reads own entitlements" on public.entitlement_grants for select using (auth.uid() = user_id or public.is_founder());
create policy "founder manages entitlement_grants" on public.entitlement_grants for insert with check (public.is_founder());
create policy "founder updates entitlement_grants" on public.entitlement_grants for update using (public.is_founder()) with check (public.is_founder());

create policy "user reads own overrides" on public.entitlement_overrides for select using (auth.uid() = user_id or public.is_founder());
create policy "founder manages overrides" on public.entitlement_overrides for all using (public.is_founder()) with check (public.is_founder());

-- installations: user manages own
create policy "user reads own installations" on public.installations for select using (auth.uid() = user_id or public.is_founder());
create policy "user inserts own installations" on public.installations for insert with check (auth.uid() = user_id);
create policy "user updates own installations" on public.installations for update using (auth.uid() = user_id or public.is_founder()) with check (auth.uid() = user_id or public.is_founder());

-- payment/subscriptions: user reads own; only service_role (bypasses RLS) or founder writes
create policy "user reads own payment_customer" on public.payment_customers for select using (auth.uid() = user_id or public.is_founder());
create policy "founder reads all payment_customers" on public.payment_customers for all using (public.is_founder()) with check (public.is_founder());
create policy "user reads own subscriptions" on public.subscriptions for select using (auth.uid() = user_id or public.is_founder());
create policy "founder manages subscriptions" on public.subscriptions for all using (public.is_founder()) with check (public.is_founder());
create policy "user reads own checkout_sessions" on public.checkout_sessions for select using (auth.uid() = user_id or public.is_founder());
create policy "founder manages checkout_sessions" on public.checkout_sessions for all using (public.is_founder()) with check (public.is_founder());

-- webhook/payment events: founder-only (internal bookkeeping)
create policy "founder reads webhook_events" on public.webhook_events for select using (public.is_founder());
create policy "founder reads payment_events" on public.payment_events for select using (public.is_founder());

-- licenses: founder-only for keys (sensitive); user reads own activations
create policy "founder manages license_keys" on public.license_keys for all using (public.is_founder()) with check (public.is_founder());
create policy "user reads own activations" on public.license_activations for select using (auth.uid() = user_id or public.is_founder());
create policy "founder manages license_activations" on public.license_activations for all using (public.is_founder()) with check (public.is_founder());

-- vouchers: founder-only (codes are pre-hashed; redemption goes through the
-- voucher-redeem Edge Function using the service role, not direct client writes)
create policy "founder manages vouchers" on public.vouchers for all using (public.is_founder()) with check (public.is_founder());
create policy "founder manages voucher_campaigns" on public.voucher_campaigns for all using (public.is_founder()) with check (public.is_founder());
create policy "user reads own redemptions" on public.voucher_campaign_redemptions for select using (auth.uid() = user_id or public.is_founder());
create policy "founder reads all redemptions" on public.voucher_campaign_redemptions for all using (public.is_founder()) with check (public.is_founder());
-- No insert/update policy for authenticated/anon: only the security-definer RPCs write here.
create policy "founder reads voucher_reservations" on public.voucher_reservations for select using (public.is_founder());
create policy "user reads own voucher_reservations" on public.voucher_reservations for select using (auth.uid() = user_id or public.is_founder());

-- referrals: user sees rows where they're the referrer or the referred
create policy "user reads own referrals" on public.referrals for select using (auth.uid() = referrer_user_id or auth.uid() = referred_user_id or public.is_founder());
create policy "founder manages referrals" on public.referrals for all using (public.is_founder()) with check (public.is_founder());
create policy "user reads own referral_profile" on public.referral_profiles for select using (auth.uid() = user_id or public.is_founder());
create policy "founder manages referral_profiles" on public.referral_profiles for all using (public.is_founder()) with check (public.is_founder());

-- audit logs: founder-only read; inserts only via SECURITY DEFINER functions (no direct
-- client insert policy at all, intentionally)
create policy "founder reads audit_logs" on public.audit_logs for select using (public.is_founder());

-- api_rate_limits/admin OTP tables: no client access at all (service-role only,
-- bypasses RLS). Founder access is exposed only through is_founder().

-- ============================================================================
-- Every founder mutation made directly through PostgREST is audited without
-- copying row contents (which may contain hashes or other sensitive fields).
create or replace function public.audit_founder_table_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  payload jsonb;
  target text;
begin
  if auth.uid() is null or not public.is_founder() then
    return coalesce(new, old);
  end if;
  payload := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  target := coalesce(payload->>'id', payload->>'user_id', payload->>'key', payload->>'plan_id');
  insert into public.audit_logs (actor_id, action, target_type, target_id, reason, metadata)
  values (auth.uid(), 'admin.' || tg_table_name || '.' || lower(tg_op), tg_table_name, target,
    nullif(payload->>'reason', ''), jsonb_build_object('operation', lower(tg_op)));
  return coalesce(new, old);
end;
$$;
revoke all on function public.audit_founder_table_mutation() from public, anon, authenticated;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'plans','features','plan_features','stripe_prices','subscriptions','checkout_sessions',
    'vouchers','voucher_campaigns','entitlement_grants','entitlement_overrides',
    'license_keys','license_activations','user_roles','app_versions','system_notices','feature_flags',
    'store_listing_status','legal_registration'
  ] loop
    execute format('drop trigger if exists trg_audit_founder_mutation on public.%I', table_name);
    execute format('create trigger trg_audit_founder_mutation after insert or update or delete on public.%I for each row execute function public.audit_founder_table_mutation()', table_name);
  end loop;
end;
$$;

-- Seed data (safe, non-sensitive — plans/features/roles only, no user data,
-- no credentials, matching the "seeds não sensíveis" requirement)
-- ============================================================================

insert into public.roles (key, description, is_system) values
  ('founder', 'Founder — full administrative access', true),
  ('admin', 'Admin — operational role managed by the founder', true),
  ('support', 'Support — read access + limited grants, no founder-level changes', true)
on conflict (key) do nothing;

insert into public.plans (key, name, is_active) values
  ('smoke-test', 'Smoke Test', true),
  ('regression-runner', 'Regression Runner', true),
  ('root-cause-analyst', 'Root Cause Analyst', true),
  ('release-manager', 'Release Manager', true)
on conflict (key) do nothing;

insert into public.features (key, value_type, description) values
  ('clients.maximum', 'integer', 'Max number of clients in the workspace'),
  ('projects.maximum', 'integer', 'Max number of projects per client'),
  ('products.maximum', 'integer', 'Max number of products per project'),
  ('environments.maximum', 'integer', 'Max number of environments per product'),
  ('accounts.maximum', 'integer', 'Max number of sandbox test accounts'),
  ('recording.mp4', 'boolean', 'Evidence recording can export MP4'),
  ('recording.gif', 'boolean', 'Evidence recording can export GIF'),
  ('breakpointViewer.enabled', 'boolean', 'Full-screen Breakpoint Viewer'),
  ('inspectors.maximum', 'integer', 'Max captured network entries kept'),
  ('jsonStudio.enabled', 'boolean', 'JSON Studio format/compact/copy tool'),
  ('advancedExport.enabled', 'boolean', 'Team workspace import/export'),
  ('prioritySupport.enabled', 'boolean', 'Priority support queue')
on conflict (key) do nothing;

-- Plan × feature matrix (ascending limits matching the LP's pricing table)
insert into public.plan_features (plan_id, feature_id, value)
select p.id, f.id, v.value::jsonb
from (values
  ('smoke-test', 'clients.maximum', '1'),
  ('smoke-test', 'projects.maximum', '2'),
  ('smoke-test', 'products.maximum', '2'),
  ('smoke-test', 'environments.maximum', '4'),
  ('smoke-test', 'accounts.maximum', '1'),
  ('smoke-test', 'recording.mp4', 'false'),
  ('smoke-test', 'recording.gif', 'false'),
  ('smoke-test', 'breakpointViewer.enabled', 'false'),
  ('smoke-test', 'inspectors.maximum', '20'),
  ('smoke-test', 'jsonStudio.enabled', 'false'),
  ('smoke-test', 'advancedExport.enabled', 'false'),
  ('smoke-test', 'prioritySupport.enabled', 'false'),

  ('regression-runner', 'clients.maximum', '5'),
  ('regression-runner', 'projects.maximum', '20'),
  ('regression-runner', 'products.maximum', '40'),
  ('regression-runner', 'environments.maximum', '999'),
  ('regression-runner', 'accounts.maximum', '10'),
  ('regression-runner', 'recording.mp4', 'true'),
  ('regression-runner', 'recording.gif', 'false'),
  ('regression-runner', 'breakpointViewer.enabled', 'false'),
  ('regression-runner', 'inspectors.maximum', '150'),
  ('regression-runner', 'jsonStudio.enabled', 'true'),
  ('regression-runner', 'advancedExport.enabled', 'false'),
  ('regression-runner', 'prioritySupport.enabled', 'false'),

  ('root-cause-analyst', 'clients.maximum', '999'),
  ('root-cause-analyst', 'projects.maximum', '999'),
  ('root-cause-analyst', 'products.maximum', '999'),
  ('root-cause-analyst', 'environments.maximum', '999'),
  ('root-cause-analyst', 'accounts.maximum', '50'),
  ('root-cause-analyst', 'recording.mp4', 'true'),
  ('root-cause-analyst', 'recording.gif', 'true'),
  ('root-cause-analyst', 'breakpointViewer.enabled', 'true'),
  ('root-cause-analyst', 'inspectors.maximum', '150'),
  ('root-cause-analyst', 'jsonStudio.enabled', 'true'),
  ('root-cause-analyst', 'advancedExport.enabled', 'true'),
  ('root-cause-analyst', 'prioritySupport.enabled', 'true'),

  ('release-manager', 'clients.maximum', '999'),
  ('release-manager', 'projects.maximum', '999'),
  ('release-manager', 'products.maximum', '999'),
  ('release-manager', 'environments.maximum', '999'),
  ('release-manager', 'accounts.maximum', '999'),
  ('release-manager', 'recording.mp4', 'true'),
  ('release-manager', 'recording.gif', 'true'),
  ('release-manager', 'breakpointViewer.enabled', 'true'),
  ('release-manager', 'inspectors.maximum', '999'),
  ('release-manager', 'jsonStudio.enabled', 'true'),
  ('release-manager', 'advancedExport.enabled', 'true'),
  ('release-manager', 'prioritySupport.enabled', 'true')
) as v(plan_key, feature_key, value)
join public.plans p on p.key = v.plan_key
join public.features f on f.key = v.feature_key
on conflict (plan_id, feature_id) do update set value = excluded.value;

-- New QA productivity kit / Macro Studio / Key View tools (v1.1.0-v1.1.2)
insert into public.features (key, value_type, description) values
  ('characterCounter.enabled', 'boolean', 'Character/word/line/byte counter tool'),
  ('multiClick.enabled', 'boolean', 'Multiclick tool with visual selection and limits'),
  ('inputLab.enabled', 'boolean', 'Input Lab: tests input classes without submitting the form'),
  ('fakerFill.enabled', 'boolean', 'Faker Fill: local synthetic data autofill'),
  ('macroStudio.enabled', 'boolean', 'Macro Studio: record/replay, Vibe Code, Playwright export'),
  ('keyView.enabled', 'boolean', 'Key View: on-screen keystroke/typing/mouse visualizer')
on conflict (key) do nothing;

insert into public.plan_features (plan_id, feature_id, value)
select p.id, f.id, v.value::jsonb
from (values
  ('smoke-test', 'characterCounter.enabled', 'true'),
  ('smoke-test', 'multiClick.enabled', 'true'),
  ('smoke-test', 'inputLab.enabled', 'false'),
  ('smoke-test', 'fakerFill.enabled', 'false'),
  ('smoke-test', 'macroStudio.enabled', 'false'),
  ('smoke-test', 'keyView.enabled', 'false'),

  ('regression-runner', 'characterCounter.enabled', 'true'),
  ('regression-runner', 'multiClick.enabled', 'true'),
  ('regression-runner', 'inputLab.enabled', 'true'),
  ('regression-runner', 'fakerFill.enabled', 'true'),
  ('regression-runner', 'macroStudio.enabled', 'false'),
  ('regression-runner', 'keyView.enabled', 'false'),

  ('root-cause-analyst', 'characterCounter.enabled', 'true'),
  ('root-cause-analyst', 'multiClick.enabled', 'true'),
  ('root-cause-analyst', 'inputLab.enabled', 'true'),
  ('root-cause-analyst', 'fakerFill.enabled', 'true'),
  ('root-cause-analyst', 'macroStudio.enabled', 'true'),
  ('root-cause-analyst', 'keyView.enabled', 'false'),

  ('release-manager', 'characterCounter.enabled', 'true'),
  ('release-manager', 'multiClick.enabled', 'true'),
  ('release-manager', 'inputLab.enabled', 'true'),
  ('release-manager', 'fakerFill.enabled', 'true'),
  ('release-manager', 'macroStudio.enabled', 'true'),
  ('release-manager', 'keyView.enabled', 'true')
) as v(plan_key, feature_key, value)
join public.plans p on p.key = v.plan_key
join public.features f on f.key = v.feature_key
on conflict (plan_id, feature_id) do update set value = excluded.value;

-- "Capturar Elementos" tool: CSV export of interactive elements with CSS
-- selector/XPath for the automation team. Same tier as Macro Studio.
insert into public.features (key, value_type, description) values
  ('elementCapture.enabled', 'boolean', 'Capturar Elementos: exports a CSV of interactive elements with CSS selector/XPath for automation')
on conflict (key) do nothing;

insert into public.plan_features (plan_id, feature_id, value)
select p.id, f.id, v.value::jsonb
from (values
  ('smoke-test', 'elementCapture.enabled', 'false'),
  ('regression-runner', 'elementCapture.enabled', 'false'),
  ('root-cause-analyst', 'elementCapture.enabled', 'true'),
  ('release-manager', 'elementCapture.enabled', 'true')
) as v(plan_key, feature_key, value)
join public.plans p on p.key = v.plan_key
join public.features f on f.key = v.feature_key
on conflict (plan_id, feature_id) do update set value = excluded.value;

commit;

-- ============================================================================
-- Post-install steps (do these after running this file):
--
-- 1. Create and confirm matteusbonotto+admin@gmail.com through Supabase Auth, then sign in to the admin.
--    (creates the auth.users row + profiles row automatically).
-- 2. The admin calls bootstrap_founder() after password authentication, sends
--    the built-in 8-digit reauthentication code to that Gmail address, and requires it before RLS
--    accepts founder operations. The proof expires after at most 60 minutes.
-- 3. Run `supabase/seed-test-users.mjs` (Node script, needs the service-role
--    key as an env var — never paste that key in chat) to create the 4 test
--    accounts and their entitlement grants.
-- 4. Configure Stripe keys as Supabase Edge Function secrets (never in this
--    repo) and deploy supabase/functions/*.
-- ============================================================================
