begin;

-- Password + email OTP is enforced as an administrative authorization layer.
-- Supabase email OTP by itself is a passwordless AAL1 login, so it must never
-- be accepted as the founder second factor without a challenge that was first
-- created from a recently password-authenticated session.
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

create index if not exists idx_admin_otp_challenges_user_active
  on public.admin_otp_challenges(user_id, expires_at desc)
  where consumed_at is null;
create index if not exists idx_admin_mfa_sessions_user_active
  on public.admin_mfa_sessions(user_id, expires_at desc)
  where revoked_at is null;

alter table public.admin_otp_challenges enable row level security;
alter table public.admin_mfa_sessions enable row level security;

-- There are intentionally no client policies on either table. Only the
-- service-role Edge Function can create/consume challenges and sessions.

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

-- Every existing founder RLS policy calls this helper, so replacing it makes
-- the second factor a database boundary rather than a frontend-only screen.
create or replace function public.is_founder()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
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

commit;
