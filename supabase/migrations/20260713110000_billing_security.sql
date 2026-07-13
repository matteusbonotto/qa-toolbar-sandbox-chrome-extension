create table public.roles (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z][a-z0-9_-]{1,31}$'),
  description text not null,
  is_system boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete restrict,
  granted_by uuid references auth.users(id) on delete set null,
  reason text not null check (char_length(reason) between 3 and 500),
  created_at timestamptz not null default now(),
  primary key (user_id, role_id)
);

create table public.payment_customers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  provider text not null check (provider = 'stripe'),
  provider_customer_id text not null unique check (provider_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.subscriptions (
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

create index subscriptions_user_status_idx on public.subscriptions (user_id, status);
create unique index subscriptions_one_current_per_user_idx on public.subscriptions (user_id)
where status in ('incomplete', 'trialing', 'active', 'past_due', 'unpaid', 'paused');

create table public.entitlement_overrides (
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

create index entitlement_overrides_user_active_idx on public.entitlement_overrides (user_id, expires_at) where revoked_at is null;

create table public.license_keys (
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

create table public.license_activations (
  id uuid primary key default gen_random_uuid(),
  license_key_id uuid not null references public.license_keys(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  installation_id uuid not null references public.installations(id) on delete cascade,
  activated_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (license_key_id, installation_id)
);

create table public.webhook_events (
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

create table public.payment_events (
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

create table public.app_versions (
  id uuid primary key default gen_random_uuid(),
  version text not null unique check (version ~ '^[0-9]+\.[0-9]+\.[0-9]+([+-][A-Za-z0-9.-]+)?$'),
  minimum_supported_version text not null,
  is_blocked boolean not null default false,
  released_at timestamptz not null default now()
);

create table public.system_notices (
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

create table public.api_rate_limits (
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

create trigger payment_customers_set_updated_at before update on public.payment_customers
for each row execute function public.set_updated_at();
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
