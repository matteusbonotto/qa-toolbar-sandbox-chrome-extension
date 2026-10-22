begin;

-- Multi Testador (docs/adr/0003-multi-testador-sessao-colaborativa.md): up to 4 release managers
-- testing the same screen together. Rooms and members are written ONLY by the multi-tester Edge
-- Function (service role), which checks the plan with the same entitlement code as access-status
-- before creating any member row. Clients never read or write these tables directly (RLS on, no
-- policies, no grants); the only client-facing surface is the private Realtime channel below.

create table if not exists public.mt_rooms (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references auth.users(id) on delete cascade,
  -- 8 chars without look-alikes (no I, O, 0, 1). Replaced by a fresh random code when the room
  -- ends, so an old code can never reach the room again.
  code text not null unique check (code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  status text not null default 'open' check (status in ('open', 'ended')),
  duration_minutes integer not null check (duration_minutes between 5 and 480),
  idle_timeout_minutes integer not null check (idle_timeout_minutes between 2 and 120),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_activity_at timestamptz not null default now(),
  ended_at timestamptz,
  end_reason text check (end_reason in ('host', 'expired', 'idle'))
);
create unique index if not exists mt_rooms_one_open_per_host on public.mt_rooms (host_id) where status = 'open';

create table if not exists public.mt_members (
  room_id uuid not null references public.mt_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Nickname only (never the e-mail): founder decision D1.
  nickname text not null check (char_length(nickname) between 1 and 40),
  color text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  role text not null check (role in ('host', 'guest')),
  status text not null check (status in ('pending', 'active', 'removed', 'left', 'rejected')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  primary key (room_id, user_id)
);
create index if not exists mt_members_user_status on public.mt_members (user_id, status);

alter table public.mt_rooms enable row level security;
alter table public.mt_members enable row level security;
revoke all on table public.mt_rooms from anon, authenticated;
revoke all on table public.mt_members from anon, authenticated;

-- True only for an ACTIVE member of an open, unexpired, non-idle room whose channel topic is
-- 'mt:<room id>'. Security definer so the Realtime policies can consult the locked tables.
create or replace function public.mt_can_use_channel(channel_topic text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.mt_rooms r
    join public.mt_members m on m.room_id = r.id
    where channel_topic = 'mt:' || r.id::text
      and r.status = 'open'
      and r.expires_at > now()
      and r.last_activity_at > now() - make_interval(mins => r.idle_timeout_minutes)
      and m.user_id = auth.uid()
      and m.status = 'active'
  );
$$;
revoke all on function public.mt_can_use_channel(text) from public, anon;
grant execute on function public.mt_can_use_channel(text) to authenticated;

-- Realtime Authorization for private channels: broadcast (cursors, chat) and presence (who is in
-- the room) only for active members of that exact room.
drop policy if exists "mt members receive room channel" on realtime.messages;
create policy "mt members receive room channel" on realtime.messages for select to authenticated
  using (realtime.messages.extension in ('broadcast', 'presence') and public.mt_can_use_channel(realtime.topic()));
drop policy if exists "mt members send room channel" on realtime.messages;
create policy "mt members send room channel" on realtime.messages for insert to authenticated
  with check (realtime.messages.extension in ('broadcast', 'presence') and public.mt_can_use_channel(realtime.topic()));

insert into public.features (key, value_type, description) values
  ('multiTester.enabled', 'boolean', 'Multi Testador: up to 4 release managers in one live test session (cursors, chat, host-controlled room)')
on conflict (key) do nothing;

-- Founder decision D2: exclusive to the Release Manager plan.
insert into public.plan_features (plan_id, feature_id, value)
select p.id, f.id, v.value::jsonb
from (values
  ('smoke-test', 'multiTester.enabled', 'false'),
  ('regression-runner', 'multiTester.enabled', 'false'),
  ('root-cause-analyst', 'multiTester.enabled', 'false'),
  ('release-manager', 'multiTester.enabled', 'true')
) as v(plan_key, feature_key, value)
join public.plans p on p.key = v.plan_key
join public.features f on f.key = v.feature_key
on conflict (plan_id, feature_id) do update set value = excluded.value;

commit;
