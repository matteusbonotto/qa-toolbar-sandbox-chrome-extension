-- QA Toolbar Sandbox - instalacao/atualizacao idempotente
-- Gerado em 2026-07-13. Pode ser executado em projeto novo ou com a tabela profiles existente.
-- Preserva dados: nao remove tabelas, nao usa CASCADE e reverte tudo em caso de erro.

begin;
create extension if not exists pgcrypto;
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (char_length(display_name) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Compatibilidade com projetos que ja possuem public.profiles.
-- Nenhum dado existente e removido.
alter table public.profiles add column if not exists display_name text;
alter table public.profiles add column if not exists created_at timestamptz not null default now();
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

-- Falha cedo com mensagem clara se profiles nao usar o padrao Supabase id uuid.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'id' and data_type = 'uuid'
  ) then
    raise exception 'public.profiles existente precisa ter coluna id do tipo uuid; nenhuma alteracao foi confirmada';
  end if;
end $$;

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

create table if not exists public.entitlement_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid references public.plans(id),
  source text not null check (source in ('subscription', 'license', 'founder', 'manual', 'trial')),
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at is null or expires_at > starts_at)
);

create index if not exists entitlement_grants_user_active_idx on public.entitlement_grants (user_id, expires_at) where revoked_at is null;

create table if not exists public.installations (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  label text check (char_length(label) <= 100),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, id)
);

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

alter table public.profiles enable row level security;
alter table public.profiles force row level security;
alter table public.plans enable row level security;
alter table public.features enable row level security;
alter table public.plan_features enable row level security;
alter table public.entitlement_grants enable row level security;
alter table public.installations enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select to authenticated using ((select auth.uid()) = id);
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
drop policy if exists "plans_read_active" on public.plans;
create policy "plans_read_active" on public.plans for select to authenticated using (is_active);
drop policy if exists "features_read" on public.features;
create policy "features_read" on public.features for select to authenticated using (true);
drop policy if exists "plan_features_read" on public.plan_features;
create policy "plan_features_read" on public.plan_features for select to authenticated using (true);
drop policy if exists "grants_select_own" on public.entitlement_grants;
create policy "grants_select_own" on public.entitlement_grants for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "installations_select_own" on public.installations;
create policy "installations_select_own" on public.installations for select to authenticated using ((select auth.uid()) = user_id);

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(new.raw_user_meta_data ->> 'name', ''));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.create_profile_for_new_user();

revoke all on public.audit_logs from anon, authenticated;


create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z][a-z0-9_-]{1,31}$'),
  description text not null,
  is_system boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete restrict,
  granted_by uuid references auth.users(id) on delete set null,
  reason text not null check (char_length(reason) between 3 and 500),
  created_at timestamptz not null default now(),
  primary key (user_id, role_id)
);

create table if not exists public.payment_customers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  provider text not null check (provider = 'stripe'),
  provider_customer_id text not null unique check (provider_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid not null references public.plans(id) on delete restrict,
  provider text not null check (provider = 'stripe'),
  provider_subscription_id text not null unique check (provider_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
  provider_price_id text not null check (provider_price_id ~ '^price_[A-Za-z0-9]+$'),
  status text not null check (status in ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  last_provider_event_created bigint not null default 0 check (last_provider_event_created >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists subscriptions_user_status_idx on public.subscriptions (user_id, status);
create unique index if not exists subscriptions_one_current_per_user_idx on public.subscriptions (user_id)
where status in ('incomplete', 'trialing', 'active', 'past_due', 'unpaid', 'paused');

create table if not exists public.entitlement_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  feature_id uuid not null references public.features(id) on delete cascade,
  value jsonb not null,
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  granted_by uuid not null references auth.users(id) on delete restrict,
  reason text not null check (char_length(reason) between 3 and 500),
  created_at timestamptz not null default now(),
  check (expires_at is null or expires_at > starts_at)
);

create index if not exists entitlement_overrides_user_active_idx on public.entitlement_overrides (user_id, expires_at) where revoked_at is null;

create table if not exists public.license_keys (
  id uuid primary key default gen_random_uuid(),
  key_prefix text not null check (key_prefix ~ '^QTS-[A-Z0-9-]{4,32}$'),
  key_hash text not null unique check (char_length(key_hash) = 64),
  plan_id uuid not null references public.plans(id) on delete restrict,
  maximum_activations integer not null default 1 check (maximum_activations between 1 and 10000),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.license_activations (
  id uuid primary key default gen_random_uuid(),
  license_key_id uuid not null references public.license_keys(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  installation_id uuid not null references public.installations(id) on delete cascade,
  activated_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (license_key_id, installation_id)
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
  webhook_event_id uuid not null references public.webhook_events(id) on delete restrict,
  user_id uuid references auth.users(id) on delete set null,
  provider_customer_id text,
  provider_subscription_id text,
  event_type text not null,
  amount_minor bigint check (amount_minor is null or amount_minor >= 0),
  currency text check (currency is null or currency ~ '^[a-z]{3}$'),
  created_at timestamptz not null default now()
);

create table if not exists public.app_versions (
  id uuid primary key default gen_random_uuid(),
  version text not null unique check (version ~ '^[0-9]+\.[0-9]+\.[0-9]+([+-][A-Za-z0-9.-]+)?$'),
  minimum_supported_version text not null,
  is_blocked boolean not null default false,
  released_at timestamptz not null default now()
);

create table if not exists public.system_notices (
  id uuid primary key default gen_random_uuid(),
  severity text not null check (severity in ('info', 'warning', 'critical')),
  title text not null check (char_length(title) between 1 and 120),
  message text not null check (char_length(message) between 1 and 2000),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  is_active boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);

create table if not exists public.api_rate_limits (
  key_hash text not null,
  window_started_at timestamptz not null,
  request_count integer not null default 1 check (request_count > 0),
  primary key (key_hash, window_started_at)
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists payment_customers_set_updated_at on public.payment_customers;
create trigger payment_customers_set_updated_at before update on public.payment_customers
for each row execute function public.set_updated_at();
drop trigger if exists subscriptions_set_updated_at on public.subscriptions;
create trigger subscriptions_set_updated_at before update on public.subscriptions
for each row execute function public.set_updated_at();

create or replace function public.validate_plan_feature_value()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  expected_type text;
begin
  select value_type into expected_type from public.features where id = new.feature_id;
  if expected_type = 'boolean' and jsonb_typeof(new.value) <> 'boolean' then
    raise exception 'Feature value must be boolean';
  elsif expected_type = 'integer' and (jsonb_typeof(new.value) <> 'number' or (new.value #>> '{}') !~ '^-?[0-9]+$') then
    raise exception 'Feature value must be integer';
  elsif expected_type = 'string' and jsonb_typeof(new.value) <> 'string' then
    raise exception 'Feature value must be string';
  end if;
  return new;
end;
$$;

drop trigger if exists plan_features_validate_value on public.plan_features;
create trigger plan_features_validate_value before insert or update on public.plan_features
for each row execute function public.validate_plan_feature_value();

create or replace function public.has_role(required_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = (select auth.uid()) and r.key = required_role
  );
$$;

revoke all on function public.has_role(text) from public;
grant execute on function public.has_role(text) to authenticated;

alter table public.roles enable row level security;
alter table public.user_roles enable row level security;
alter table public.payment_customers enable row level security;
alter table public.subscriptions enable row level security;
alter table public.entitlement_overrides enable row level security;
alter table public.license_keys enable row level security;
alter table public.license_activations enable row level security;
alter table public.webhook_events enable row level security;
alter table public.payment_events enable row level security;
alter table public.app_versions enable row level security;
alter table public.system_notices enable row level security;
alter table public.api_rate_limits enable row level security;

alter table public.roles force row level security;
alter table public.user_roles force row level security;
alter table public.payment_customers force row level security;
alter table public.subscriptions force row level security;
alter table public.entitlement_overrides force row level security;
alter table public.license_keys force row level security;
alter table public.license_activations force row level security;
alter table public.webhook_events force row level security;
alter table public.payment_events force row level security;
alter table public.audit_logs force row level security;
alter table public.app_versions force row level security;
alter table public.system_notices force row level security;
alter table public.api_rate_limits force row level security;

revoke all on public.roles, public.user_roles, public.payment_customers, public.subscriptions,
  public.entitlement_overrides, public.license_keys, public.license_activations,
  public.webhook_events, public.payment_events, public.app_versions, public.system_notices,
  public.api_rate_limits
  from anon, authenticated;

revoke select on public.plans, public.features, public.plan_features, public.entitlement_grants,
  public.installations from anon, authenticated;

drop policy if exists "plans_read_active" on public.plans;
drop policy if exists "features_read" on public.features;
drop policy if exists "plan_features_read" on public.plan_features;
drop policy if exists "grants_select_own" on public.entitlement_grants;
drop policy if exists "installations_select_own" on public.installations;

alter table public.plans force row level security;
alter table public.features force row level security;
alter table public.plan_features force row level security;
alter table public.entitlement_grants force row level security;
alter table public.installations force row level security;

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
  bucket timestamptz;
  next_count integer;
begin
  if maximum_requests < 1 or maximum_requests > 10000 or window_seconds < 1 or window_seconds > 86400 then
    raise exception 'Invalid rate-limit configuration';
  end if;
  bucket := to_timestamp(floor(extract(epoch from now()) / window_seconds) * window_seconds);
  insert into public.api_rate_limits (key_hash, window_started_at, request_count)
  values (request_key_hash, bucket, 1)
  on conflict (key_hash, window_started_at)
  do update set request_count = public.api_rate_limits.request_count + 1
  returning request_count into next_count;
  return next_count <= maximum_requests;
end;
$$;

revoke all on function public.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;

create or replace function public.upsert_stripe_subscription(
  target_user_id uuid,
  target_plan_id uuid,
  stripe_subscription_id text,
  stripe_price_id text,
  subscription_status text,
  period_start timestamptz,
  period_end timestamptz,
  will_cancel boolean,
  canceled_timestamp timestamptz,
  provider_event_created bigint
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.subscriptions (
    user_id, plan_id, provider, provider_subscription_id, provider_price_id, status,
    current_period_start, current_period_end, cancel_at_period_end, canceled_at,
    last_provider_event_created
  ) values (
    target_user_id, target_plan_id, 'stripe', stripe_subscription_id, stripe_price_id, subscription_status,
    period_start, period_end, will_cancel, canceled_timestamp, provider_event_created
  )
  on conflict (provider_subscription_id) do update set
    plan_id = excluded.plan_id,
    provider_price_id = excluded.provider_price_id,
    status = excluded.status,
    current_period_start = excluded.current_period_start,
    current_period_end = excluded.current_period_end,
    cancel_at_period_end = excluded.cancel_at_period_end,
    canceled_at = excluded.canceled_at,
    last_provider_event_created = excluded.last_provider_event_created
  where excluded.last_provider_event_created >= public.subscriptions.last_provider_event_created;
$$;

revoke all on function public.upsert_stripe_subscription(uuid, uuid, text, text, text, timestamptz, timestamptz, boolean, timestamptz, bigint)
from public, anon, authenticated;
grant execute on function public.upsert_stripe_subscription(uuid, uuid, text, text, text, timestamptz, timestamptz, boolean, timestamptz, bigint)
to service_role;

insert into public.roles (key, description) values
  ('user', 'Default authenticated user'),
  ('support', 'Read-only support operator'),
  ('admin', 'Billing and entitlement administrator'),
  ('founder', 'Audited founder-level administrator')
on conflict (key) do nothing;

insert into public.app_versions (version, minimum_supported_version)
values ('0.1.0', '0.1.0') on conflict (version) do nothing;

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(new.raw_user_meta_data ->> 'name', ''));
  insert into public.user_roles (user_id, role_id, reason)
  select new.id, r.id, 'Automatic role for new account'
  from public.roles r where r.key = 'user';
  return new;
end;
$$;

insert into public.user_roles (user_id, role_id, reason)
select u.id, r.id, 'Backfill default role for existing account'
from auth.users u
cross join public.roles r
where r.key = 'user'
on conflict (user_id, role_id) do nothing;

insert into public.profiles (id, display_name)
select u.id, nullif(u.raw_user_meta_data ->> 'name', '')
from auth.users u
on conflict (id) do nothing;

create or replace function public.bootstrap_founder(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  founder_role_id uuid;
begin
  perform pg_advisory_xact_lock(724101983);
  select id into founder_role_id from public.roles where key = 'founder';
  if founder_role_id is null then raise exception 'Founder role is not configured'; end if;
  if exists (
    select 1 from public.user_roles where role_id = founder_role_id
  ) then raise exception 'Founder is already configured'; end if;
  if not exists (select 1 from auth.users where id = target_user_id) then
    raise exception 'Target user does not exist';
  end if;
  insert into public.user_roles (user_id, role_id, granted_by, reason)
  values (target_user_id, founder_role_id, target_user_id, 'One-time founder bootstrap');
  insert into public.audit_logs (actor_id, action, target_type, target_id, reason)
  values (target_user_id, 'founder.bootstrap', 'user', target_user_id::text, 'One-time founder bootstrap');
end;
$$;

revoke all on function public.bootstrap_founder(uuid) from public, anon, authenticated;
grant execute on function public.bootstrap_founder(uuid) to service_role;


insert into public.plans (key, name, is_active)
values ('free', 'Free', true), ('pro', 'Pro', true)
on conflict (key) do nothing;

insert into public.features (key, value_type, description)
values
  ('projects.maximum', 'integer', 'Maximum number of local projects'),
  ('networkHistory.maximum', 'integer', 'Maximum local request records'),
  ('jsonDiff.enabled', 'boolean', 'JSON diff capability'),
  ('exportFull.enabled', 'boolean', 'Full export capability')
on conflict (key) do nothing;

insert into public.plan_features (plan_id, feature_id, value)
select p.id, f.id, defaults.value
from (values
  ('free', 'projects.maximum', '2'::jsonb),
  ('free', 'networkHistory.maximum', '200'::jsonb),
  ('free', 'jsonDiff.enabled', 'false'::jsonb),
  ('free', 'exportFull.enabled', 'false'::jsonb),
  ('pro', 'projects.maximum', '50'::jsonb),
  ('pro', 'networkHistory.maximum', '10000'::jsonb),
  ('pro', 'jsonDiff.enabled', 'true'::jsonb),
  ('pro', 'exportFull.enabled', 'true'::jsonb)
) as defaults(plan_key, feature_key, value)
join public.plans p on p.key = defaults.plan_key
join public.features f on f.key = defaults.feature_key
on conflict (plan_id, feature_id) do update set value = excluded.value;


-- Growth plans, 30-day Full Access trial and referrals.
alter table public.profiles add column if not exists trial_started_at timestamptz;
alter table public.profiles add column if not exists trial_ends_at timestamptz;

create table if not exists public.referral_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  code text not null unique check (code ~ '^QTS-[A-Z0-9]{8}$'),
  qualified_referrals integer not null default 0 check (qualified_referrals >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_user_id uuid not null references auth.users(id) on delete cascade,
  referred_user_id uuid not null unique references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','qualified','rewarded','rejected')),
  reward_type text check (reward_type in ('stripe_credit','pro_access')),
  reward_reference text,
  qualified_at timestamptz,
  rewarded_at timestamptz,
  created_at timestamptz not null default now(),
  check (referrer_user_id <> referred_user_id)
);

alter table public.referral_profiles enable row level security;
alter table public.referral_profiles force row level security;
alter table public.referrals enable row level security;
alter table public.referrals force row level security;
revoke all on public.referral_profiles, public.referrals from anon, authenticated;

create unique index if not exists entitlement_grants_one_trial_per_user_idx
on public.entitlement_grants(user_id) where source = 'trial';

insert into public.plans (key, name, is_active) values
  ('free', 'Starter', true),
  ('pro', 'Pro', true),
  ('scale', 'Scale', true)
on conflict (key) do update set name = excluded.name, is_active = true;

insert into public.features (key, value_type, description) values
  ('domains.maximum', 'integer', 'Maximum configured domains'),
  ('clients.maximum', 'integer', 'Maximum client workspaces'),
  ('screenshot.enabled', 'boolean', 'Screenshot evidence'),
  ('passFail.enabled', 'boolean', 'Pass and Fail evidence markers'),
  ('recording.enabled', 'boolean', 'Video evidence recording'),
  ('annotations.enabled', 'boolean', 'Text and shape annotations'),
  ('inspectors.enabled', 'boolean', 'Declarative API inspectors'),
  ('httpControls.enabled', 'boolean', 'Advanced HTTP response controls'),
  ('referrals.enabled', 'boolean', 'Referral rewards')
on conflict (key) do nothing;

insert into public.plan_features (plan_id, feature_id, value)
select p.id, f.id, v.value
from (values
  ('free','domains.maximum','1'::jsonb), ('free','clients.maximum','1'::jsonb),
  ('free','projects.maximum','1'::jsonb), ('free','networkHistory.maximum','50'::jsonb),
  ('free','screenshot.enabled','true'::jsonb), ('free','passFail.enabled','true'::jsonb),
  ('free','recording.enabled','false'::jsonb), ('free','annotations.enabled','false'::jsonb),
  ('free','jsonDiff.enabled','false'::jsonb), ('free','exportFull.enabled','false'::jsonb),
  ('free','inspectors.enabled','false'::jsonb), ('free','httpControls.enabled','false'::jsonb),
  ('free','referrals.enabled','true'::jsonb),
  ('pro','domains.maximum','10'::jsonb), ('pro','clients.maximum','25'::jsonb),
  ('pro','projects.maximum','10'::jsonb), ('pro','networkHistory.maximum','10000'::jsonb),
  ('pro','screenshot.enabled','true'::jsonb), ('pro','passFail.enabled','true'::jsonb),
  ('pro','recording.enabled','true'::jsonb), ('pro','annotations.enabled','true'::jsonb),
  ('pro','jsonDiff.enabled','true'::jsonb), ('pro','exportFull.enabled','true'::jsonb),
  ('pro','inspectors.enabled','true'::jsonb), ('pro','httpControls.enabled','false'::jsonb),
  ('pro','referrals.enabled','true'::jsonb),
  ('scale','domains.maximum','9999'::jsonb), ('scale','clients.maximum','9999'::jsonb),
  ('scale','projects.maximum','9999'::jsonb), ('scale','networkHistory.maximum','100000'::jsonb),
  ('scale','screenshot.enabled','true'::jsonb), ('scale','passFail.enabled','true'::jsonb),
  ('scale','recording.enabled','true'::jsonb), ('scale','annotations.enabled','true'::jsonb),
  ('scale','jsonDiff.enabled','true'::jsonb), ('scale','exportFull.enabled','true'::jsonb),
  ('scale','inspectors.enabled','true'::jsonb), ('scale','httpControls.enabled','true'::jsonb),
  ('scale','referrals.enabled','true'::jsonb)
) v(plan_key, feature_key, value)
join public.plans p on p.key = v.plan_key
join public.features f on f.key = v.feature_key
on conflict (plan_id, feature_id) do update set value = excluded.value;

create or replace function public.ensure_user_trial(target_user_id uuid)
returns table(trial_started_at timestamptz, trial_ends_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare scale_plan_id uuid; started timestamptz; ending timestamptz;
begin
  if not exists (select 1 from auth.users where id = target_user_id) then raise exception 'User not found'; end if;
  select p.id into scale_plan_id from public.plans p where p.key = 'scale';
  if scale_plan_id is null then raise exception 'Scale plan is not configured'; end if;
  select eg.starts_at, eg.expires_at into started, ending from public.entitlement_grants eg
    where eg.user_id = target_user_id and eg.source = 'trial' limit 1;
  if started is null then
    started := now(); ending := now() + interval '30 days';
    insert into public.entitlement_grants(user_id,plan_id,source,starts_at,expires_at)
      values(target_user_id,scale_plan_id,'trial',started,ending);
    update public.profiles set trial_started_at=started,trial_ends_at=ending where id=target_user_id;
  end if;
  insert into public.referral_profiles(user_id,code)
    values(target_user_id,'QTS-' || upper(substr(replace(target_user_id::text,'-',''),1,8)))
    on conflict(user_id) do nothing;
  return query select started, ending;
end $$;
revoke all on function public.ensure_user_trial(uuid) from public,anon,authenticated;
grant execute on function public.ensure_user_trial(uuid) to service_role;

create or replace function public.register_referral(target_user_id uuid, referral_code text)
returns boolean language plpgsql security definer set search_path='' as $$
declare referrer_id uuid;
begin
  select rp.user_id into referrer_id from public.referral_profiles rp where rp.code=upper(trim(referral_code));
  if referrer_id is null or referrer_id=target_user_id then return false; end if;
  insert into public.referrals(referrer_user_id,referred_user_id) values(referrer_id,target_user_id)
    on conflict(referred_user_id) do nothing;
  return true;
end $$;
revoke all on function public.register_referral(uuid,text) from public,anon,authenticated;
grant execute on function public.register_referral(uuid,text) to service_role;

select public.ensure_user_trial(u.id) from auth.users u
where not exists(select 1 from public.entitlement_grants eg where eg.user_id=u.id and eg.source='trial');

-- Falha dentro da transacao se a instalacao ficar incompleta.
do $$
declare
  expected_tables constant text[] := array[
    'profiles', 'plans', 'features', 'plan_features', 'entitlement_grants',
    'installations', 'audit_logs', 'roles', 'user_roles', 'payment_customers',
    'subscriptions', 'entitlement_overrides', 'license_keys', 'license_activations',
    'webhook_events', 'payment_events', 'app_versions', 'system_notices',
    'api_rate_limits', 'referral_profiles', 'referrals'
  ];
  missing_or_unprotected text[];
begin
  select array_agg(expected.name order by expected.name)
  into missing_or_unprotected
  from unnest(expected_tables) as expected(name)
  left join pg_catalog.pg_namespace n
    on n.nspname = 'public'
  left join pg_catalog.pg_class c
    on c.relnamespace = n.oid and c.relname = expected.name and c.relkind in ('r', 'p')
  where c.oid is null or not c.relrowsecurity or not c.relforcerowsecurity;

  if coalesce(cardinality(missing_or_unprotected), 0) > 0 then
    raise exception 'Tabelas ausentes ou sem RLS forcada: %', array_to_string(missing_or_unprotected, ', ');
  end if;

  if (select count(*) from public.plans where key in ('free', 'pro', 'scale') and is_active) <> 3 then
    raise exception 'Catalogo de planos incompleto';
  end if;

  if exists (
    select 1 from (values
      ('free', 'domains.maximum'), ('free', 'clients.maximum'),
      ('pro', 'recording.enabled'), ('pro', 'inspectors.enabled'),
      ('scale', 'httpControls.enabled')
    ) required(plan_key, feature_key)
    where not exists (
      select 1
      from public.plan_features pf
      join public.plans p on p.id = pf.plan_id
      join public.features f on f.id = pf.feature_id
      where p.key = required.plan_key and f.key = required.feature_key
    )
  ) then
    raise exception 'Recursos obrigatorios dos planos nao foram configurados';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;

-- Verificacao: pg_tables expoe rowsecurity, mas nao forcerowsecurity.
-- Os dois estados corretos ficam em pg_class.relrowsecurity/relforcerowsecurity.
select
  n.nspname as schemaname,
  c.relname as tablename,
  c.relrowsecurity as rowsecurity,
  c.relforcerowsecurity as forcerowsecurity
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'p')
  and c.relname in (
    'profiles', 'plans', 'features', 'plan_features', 'entitlement_grants',
    'installations', 'audit_logs', 'roles', 'user_roles', 'payment_customers',
    'subscriptions', 'entitlement_overrides', 'license_keys', 'license_activations',
    'webhook_events', 'payment_events', 'app_versions', 'system_notices', 'api_rate_limits',
    'referral_profiles', 'referrals'
  )
order by c.relname;

select p.key as plan, f.key as feature, pf.value
from public.plan_features pf
join public.plans p on p.id = pf.plan_id
join public.features f on f.id = pf.feature_id
order by p.key, f.key;


