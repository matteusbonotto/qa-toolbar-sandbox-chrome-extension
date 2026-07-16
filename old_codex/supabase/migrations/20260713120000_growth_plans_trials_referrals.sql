alter table public.profiles add column if not exists trial_started_at timestamptz;
alter table public.profiles add column if not exists trial_ends_at timestamptz;

create table public.referral_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  code text not null unique check (code ~ '^QTS-[A-Z0-9]{8}$'),
  qualified_referrals integer not null default 0 check (qualified_referrals >= 0),
  created_at timestamptz not null default now()
);

create table public.referrals (
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
