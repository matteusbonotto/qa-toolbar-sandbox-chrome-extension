create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (char_length(display_name) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z][a-z0-9._-]+$'),
  name text not null check (char_length(name) between 1 and 80),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.features (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z][a-zA-Z0-9._-]+$'),
  value_type text not null check (value_type in ('boolean', 'integer', 'string')),
  description text not null,
  created_at timestamptz not null default now()
);

create table public.plan_features (
  plan_id uuid not null references public.plans(id) on delete cascade,
  feature_id uuid not null references public.features(id) on delete cascade,
  value jsonb not null,
  primary key (plan_id, feature_id)
);

create table public.entitlement_grants (
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

create index entitlement_grants_user_active_idx on public.entitlement_grants (user_id, expires_at) where revoked_at is null;

create table public.installations (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  label text check (char_length(label) <= 100),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, id)
);

create table public.audit_logs (
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
alter table public.plans enable row level security;
alter table public.features enable row level security;
alter table public.plan_features enable row level security;
alter table public.entitlement_grants enable row level security;
alter table public.installations enable row level security;
alter table public.audit_logs enable row level security;

create policy "profiles_select_own" on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "profiles_update_own" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy "plans_read_active" on public.plans for select to authenticated using (is_active);
create policy "features_read" on public.features for select to authenticated using (true);
create policy "plan_features_read" on public.plan_features for select to authenticated using (true);
create policy "grants_select_own" on public.entitlement_grants for select to authenticated using ((select auth.uid()) = user_id);
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

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.create_profile_for_new_user();

revoke all on public.audit_logs from anon, authenticated;
