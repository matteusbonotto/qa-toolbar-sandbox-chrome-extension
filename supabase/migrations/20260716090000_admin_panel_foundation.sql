-- Admin panel foundation: fixes a critical gap where bootstrap_founder never
-- verified the target account's e-mail, and adds the read/write surface the
-- admin panel needs (plan prices, user search, dashboard aggregates).

-- 1. bootstrap_founder must compare the target account's verified e-mail
--    against the single authorized founder identity, not just "nobody is
--    founder yet" + a shared secret header (the header alone does not prove
--    which human is calling).
create or replace function public.bootstrap_founder(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  founder_role_id uuid;
  target_email text;
begin
  perform pg_advisory_xact_lock(724101983);
  select id into founder_role_id from public.roles where key = 'founder';
  if founder_role_id is null then raise exception 'Founder role is not configured'; end if;
  if exists (
    select 1 from public.user_roles where role_id = founder_role_id
  ) then raise exception 'Founder is already configured'; end if;

  select email into target_email from auth.users where id = target_user_id;
  if target_email is null then raise exception 'Target user does not exist'; end if;
  if lower(target_email) <> 'matteusbonotto+qa@gmail.com' then
    raise exception 'founder_email_mismatch';
  end if;

  insert into public.user_roles (user_id, role_id, granted_by, reason)
  values (target_user_id, founder_role_id, target_user_id, 'One-time founder bootstrap');
  insert into public.audit_logs (actor_id, action, target_type, target_id, reason)
  values (target_user_id, 'founder.bootstrap', 'user', target_user_id::text, 'One-time founder bootstrap');
end;
$$;

revoke all on function public.bootstrap_founder(uuid) from public, anon, authenticated;
grant execute on function public.bootstrap_founder(uuid) to service_role;

-- 2. Admin-managed Stripe price catalog. Keeps the checkout price IDs
--    editable from the admin panel without a redeploy, while
--    create-checkout/_shared/stripe.ts still falls back to the existing
--    environment variables when no row is configured, so nothing breaks
--    until an admin explicitly overrides a price.
create table public.plan_prices (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  billing_interval text not null check (billing_interval in ('monthly', 'yearly')),
  stripe_price_id text not null check (stripe_price_id ~ '^price_[A-Za-z0-9]+$'),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, billing_interval)
);

create trigger plan_prices_set_updated_at before update on public.plan_prices
for each row execute function public.set_updated_at();

alter table public.plan_prices enable row level security;
alter table public.plan_prices force row level security;
revoke all on public.plan_prices from anon, authenticated;

-- 3. auth.users is not exposed through PostgREST, so admin Edge Functions
--    need a security-definer RPC to search/list accounts together with
--    their role and effective-access summary in one round trip.
create or replace function public.admin_search_users(search text default null, limit_count integer default 50)
returns table(
  id uuid,
  email text,
  created_at timestamptz,
  roles text[],
  plan_key text,
  access_source text,
  access_expires_at timestamptz
)
language sql
security definer
set search_path = ''
stable
as $$
  select
    u.id,
    u.email,
    u.created_at,
    coalesce(array_agg(distinct r.key) filter (where r.key is not null), '{}'),
    (
      select p.key from public.entitlement_grants g
      join public.plans p on p.id = g.plan_id
      where g.user_id = u.id and g.revoked_at is null
        and (g.expires_at is null or g.expires_at > now())
      order by g.expires_at desc nulls first
      limit 1
    ),
    (
      select g.source from public.entitlement_grants g
      where g.user_id = u.id and g.revoked_at is null
        and (g.expires_at is null or g.expires_at > now())
      order by g.expires_at desc nulls first
      limit 1
    ),
    (
      select g.expires_at from public.entitlement_grants g
      where g.user_id = u.id and g.revoked_at is null
        and (g.expires_at is null or g.expires_at > now())
      order by g.expires_at desc nulls first
      limit 1
    )
  from auth.users u
  left join public.user_roles ur on ur.user_id = u.id
  left join public.roles r on r.id = ur.role_id
  where search is null or u.email ilike '%' || search || '%'
  group by u.id, u.email, u.created_at
  order by u.created_at desc
  limit greatest(1, least(limit_count, 200));
$$;

revoke all on function public.admin_search_users(text, integer) from public, anon, authenticated;
grant execute on function public.admin_search_users(text, integer) to service_role;

-- 4. Dashboard aggregate counts in a single round trip.
create or replace function public.admin_dashboard_overview()
returns table(
  total_users bigint,
  active_paid_subscriptions bigint,
  active_manual_grants bigint,
  active_founder_grants bigint,
  active_voucher_grants bigint,
  vouchers_available bigint,
  vouchers_redeemed bigint,
  campaigns_active bigint
)
language sql
security definer
set search_path = ''
stable
as $$
  select
    (select count(*) from auth.users),
    (select count(*) from public.subscriptions where status in ('active', 'trialing', 'past_due')),
    (select count(*) from public.entitlement_grants where source = 'manual' and revoked_at is null and (expires_at is null or expires_at > now())),
    (select count(*) from public.entitlement_grants where source = 'founder' and revoked_at is null and (expires_at is null or expires_at > now())),
    (select count(*) from public.entitlement_grants where source = 'voucher' and revoked_at is null and (expires_at is null or expires_at > now())),
    (select count(*) from public.vouchers where status = 'available'),
    (select count(*) from public.vouchers where status = 'used'),
    (select count(*) from public.voucher_campaigns where enabled);
$$;

revoke all on function public.admin_dashboard_overview() from public, anon, authenticated;
grant execute on function public.admin_dashboard_overview() to service_role;
