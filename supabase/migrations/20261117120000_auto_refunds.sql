-- Reembolso automático do arrependimento (cancel-access). Uma linha por reembolso feito, usada como
-- trava antifraude: a mesma conta, o mesmo e-mail ou o mesmo cartão só recebem UM reembolso
-- automático na vida. O resto vai para o suporte. Só o service_role lê e escreve.
create table if not exists public.auto_refunds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete set null,
  email_hash text not null,
  card_fingerprint text,
  stripe_payment text not null unique,
  stripe_refund text,
  amount bigint not null,
  currency text not null,
  created_at timestamptz not null default now()
);
-- user_id pode virar null quando a conta é excluída; a trava continua pelo e-mail e pelo cartão.
alter table public.auto_refunds alter column user_id drop not null;
create index if not exists auto_refunds_user_idx on public.auto_refunds(user_id);
create index if not exists auto_refunds_email_idx on public.auto_refunds(email_hash);
create index if not exists auto_refunds_card_idx on public.auto_refunds(card_fingerprint) where card_fingerprint is not null;

alter table public.auto_refunds enable row level security;
revoke all on public.auto_refunds from anon, authenticated;

-- Reverter: drop table public.auto_refunds;
