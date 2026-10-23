begin;

-- Multi Testador: the server is the source of truth for chat and consensus votes
-- (docs/adr/0003-multi-testador-sessao-colaborativa.md, "Fase MT2"). Supabase Realtime evaluates the
-- realtime.messages policies when a socket JOINS and keeps that decision for the connection, so the
-- per-event filter of "mt members send room channel" is defense in depth, not a per-message
-- guarantee: a member with a custom client could still broadcast a forged `chat` or `vote`. Clients
-- therefore treat those broadcasts only as a "poke" to fetch the room state, and the multi-tester
-- Edge Function (service role) is the only writer of these rows, with the sender taken from the
-- verified JWT. Clients never read or write them directly (RLS on, no policies, no grants).

create table if not exists public.mt_chat_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.mt_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  text text not null check (char_length(text) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists mt_chat_messages_room_created on public.mt_chat_messages (room_id, created_at desc);

-- One row per held host action. status: open while waiting; approved when every active guest
-- approved; rejected on any rejection; expired after the vote timeout; cancelled by the host or
-- when no guest is left to ask (fails closed).
create table if not exists public.mt_votes (
  room_id uuid not null references public.mt_rooms(id) on delete cascade,
  vote_id text not null check (vote_id ~ '^[A-Za-z0-9_-]{8,40}$'),
  requested_by uuid not null references auth.users(id) on delete cascade,
  description text not null check (char_length(description) between 1 and 300),
  status text not null default 'open' check (status in ('open', 'approved', 'rejected', 'expired', 'cancelled')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  primary key (room_id, vote_id)
);

-- One ballot per guest per vote (the first answer counts; it cannot be changed).
create table if not exists public.mt_vote_ballots (
  room_id uuid not null,
  vote_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  approve boolean not null,
  created_at timestamptz not null default now(),
  unique (room_id, vote_id, user_id),
  foreign key (room_id, vote_id) references public.mt_votes(room_id, vote_id) on delete cascade
);

alter table public.mt_chat_messages enable row level security;
alter table public.mt_votes enable row level security;
alter table public.mt_vote_ballots enable row level security;
revoke all on table public.mt_chat_messages from anon, authenticated;
revoke all on table public.mt_votes from anon, authenticated;
revoke all on table public.mt_vote_ballots from anon, authenticated;

commit;
