alter table public.profiles enable row level security;
alter table public.profiles force row level security;
alter table public.app_versions enable row level security;
alter table public.app_versions force row level security;
alter table public.system_notices enable row level security;
alter table public.system_notices force row level security;

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
  left join pg_catalog.pg_namespace n on n.nspname = 'public'
  left join pg_catalog.pg_class c
    on c.relnamespace = n.oid and c.relname = expected.name and c.relkind in ('r', 'p')
  where c.oid is null or not c.relrowsecurity or not c.relforcerowsecurity;

  if coalesce(cardinality(missing_or_unprotected), 0) > 0 then
    raise exception 'Missing tables or FORCE RLS: %', array_to_string(missing_or_unprotected, ', ');
  end if;
end $$;
