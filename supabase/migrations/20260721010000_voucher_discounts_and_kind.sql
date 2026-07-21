-- Adds an explicit `kind` ('discount' | 'days' | 'lifetime') to vouchers and voucher_campaigns,
-- discount fields for the new 'discount' kind, and a reservation table + RPCs so a discount
-- voucher can be safely consumed exactly once even though the Stripe Checkout flow it drives has
-- a real gap between "code applied" and "payment confirmed" (unlike days/lifetime vouchers, which
-- already grant access atomically in one transaction). Purely additive — no existing row becomes
-- invalid, no column is removed.

begin;

-- 1) `kind` on vouchers (single-use) ------------------------------------------------------------
alter table public.vouchers add column if not exists kind text;
update public.vouchers set kind = case when grant_days is null then 'lifetime' else 'days' end where kind is null;
alter table public.vouchers alter column kind set not null;
alter table public.vouchers add constraint vouchers_kind_check check (kind in ('discount', 'days', 'lifetime'));

-- 2) `kind` on voucher_campaigns ------------------------------------------------------------------
-- Every existing row has grant_days NOT NULL today (no campaign has ever been a real lifetime —
-- only the "36500 days" convention) and the discount feature never existed, so every existing
-- campaign safely backfills to 'days'. Not auto-promoted to 'lifetime': 36500 is a business
-- decision the founder made, not an unambiguous sentinel — reclassify manually in the admin UI
-- if that's what a given campaign actually meant.
alter table public.voucher_campaigns add column if not exists kind text;
update public.voucher_campaigns set kind = 'days' where kind is null;
alter table public.voucher_campaigns alter column kind set not null;
alter table public.voucher_campaigns add constraint voucher_campaigns_kind_check check (kind in ('discount', 'days', 'lifetime'));

-- 3) Real lifetime support in campaigns: grant_days becomes optional --------------------------
alter table public.voucher_campaigns drop constraint if exists voucher_campaigns_grant_days_check;
alter table public.voucher_campaigns alter column grant_days drop not null;
alter table public.voucher_campaigns add constraint voucher_campaigns_grant_days_check
  check (grant_days is null or grant_days between 1 and 36500);

-- 4) Discount fields (mutually exclusive: percent vs fixed amount) on both tables --------------
alter table public.vouchers
  add column if not exists discount_percent_off integer,
  add column if not exists discount_amount_off_minor bigint,
  add column if not exists discount_currency text;
alter table public.voucher_campaigns
  add column if not exists discount_percent_off integer,
  add column if not exists discount_amount_off_minor bigint,
  add column if not exists discount_currency text;

do $$
declare t text;
begin
  foreach t in array array['vouchers', 'voucher_campaigns'] loop
    execute format(
      'alter table public.%I add constraint %I check (discount_percent_off is null or discount_percent_off between 1 and 100)',
      t, t || '_discount_percent_check');
    execute format(
      'alter table public.%I add constraint %I check (discount_amount_off_minor is null or discount_amount_off_minor > 0)',
      t, t || '_discount_amount_check');
    execute format(
      'alter table public.%I add constraint %I check (discount_currency is null or discount_currency ~ ''^[a-z]{3}$'')',
      t, t || '_discount_currency_check');
  end loop;
end $$;

-- 5) plan_id becomes optional (a discount can apply to whatever plan the user picks at checkout) -
alter table public.vouchers alter column plan_id drop not null;
alter table public.voucher_campaigns alter column plan_id drop not null;

-- 6) Per-row shape: each `kind` requires exactly the right set of fields ------------------------
do $$
declare t text;
begin
  foreach t in array array['vouchers', 'voucher_campaigns'] loop
    execute format($f$
      alter table public.%I add constraint %I check (
        (kind = 'days' and grant_days is not null and plan_id is not null
          and discount_percent_off is null and discount_amount_off_minor is null)
        or (kind = 'lifetime' and grant_days is null and plan_id is not null
          and discount_percent_off is null and discount_amount_off_minor is null)
        or (kind = 'discount' and grant_days is null
          and (discount_percent_off is not null) <> (discount_amount_off_minor is not null))
      )
    $f$, t, t || '_kind_fields_check');
  end loop;
end $$;

-- 7) Reservation table backing the anti-double-discount guarantee -------------------------------
-- Keyed by (user_id, request_id) -- the same request_id uuid the front end already generates
-- before ever calling Stripe (checkout-create-session already uses it for Stripe idempotency and
-- checkout_sessions dedupe). That sidesteps the ordering problem: we need to reserve the voucher
-- BEFORE creating the Stripe Checkout Session, but the session's own id (cs_...) only exists
-- AFTER creating it.
create table if not exists public.voucher_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  voucher_id uuid references public.vouchers(id) on delete cascade,
  campaign_id uuid references public.voucher_campaigns(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'completed', 'released')),
  reserved_at timestamptz not null default now(),
  expires_at timestamptz not null,
  completed_at timestamptz,
  released_at timestamptz,
  check ((voucher_id is not null) <> (campaign_id is not null)),
  unique (user_id, request_id)
);
alter table public.voucher_reservations enable row level security;
create policy "founder reads voucher_reservations" on public.voucher_reservations
  for select using (public.is_founder());
create policy "user reads own voucher_reservations" on public.voucher_reservations
  for select using (auth.uid() = user_id or public.is_founder());
-- No insert/update policy for authenticated/anon: only the security-definer RPCs below write here.

-- The real guarantee against a race is these unique indexes, not the plpgsql checks in the RPCs.
create unique index if not exists idx_voucher_reservations_voucher_pending
  on public.voucher_reservations(voucher_id) where status = 'pending';
create unique index if not exists idx_voucher_reservations_campaign_user_active
  on public.voucher_reservations(campaign_id, user_id) where status in ('pending', 'completed');
create index if not exists idx_voucher_reservations_campaign_pending
  on public.voucher_reservations(campaign_id) where status = 'pending';

-- 8) redeem_voucher must never grant instant access for kind='discount' -------------------------
-- (that would bypass Stripe entirely) -- same logic as before, gated by kind.
create or replace function public.redeem_voucher(target_user_id uuid, voucher_hash text)
returns table(label text, access_expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  campaign public.voucher_campaigns%rowtype;
  selected public.vouchers%rowtype;
  ending timestamptz;
  created_grant_id uuid;
begin
  if voucher_hash !~ '^[a-f0-9]{64}$' or not exists (select 1 from auth.users where id = target_user_id) then
    raise exception 'voucher_unavailable';
  end if;

  select * into campaign from public.voucher_campaigns
  where code_hash = voucher_hash and kind in ('days', 'lifetime') and enabled and (expires_at is null or expires_at > now())
  for update;
  if campaign.id is not null then
    if campaign.maximum_redemptions is not null and campaign.redemption_count >= campaign.maximum_redemptions then
      raise exception 'voucher_unavailable';
    end if;
    if exists (select 1 from public.voucher_campaign_redemptions where campaign_id = campaign.id and user_id = target_user_id) then
      raise exception 'voucher_already_redeemed';
    end if;
    ending := case when campaign.grant_days is null then null else now() + make_interval(days => campaign.grant_days) end;
    insert into public.entitlement_grants (user_id, plan_id, source, starts_at, expires_at)
    values (target_user_id, campaign.plan_id, 'voucher', now(), ending)
    returning id into created_grant_id;
    insert into public.voucher_campaign_redemptions (campaign_id, user_id, entitlement_grant_id)
    values (campaign.id, target_user_id, created_grant_id);
    update public.voucher_campaigns set redemption_count = redemption_count + 1 where id = campaign.id;
    insert into public.audit_logs (actor_id, action, target_type, target_id, reason, metadata)
    values (target_user_id, 'voucher.redeemed', 'voucher_campaign', campaign.id::text, 'Self-service campaign redemption', jsonb_build_object('label', campaign.label));
    return query select campaign.label, ending;
    return;
  end if;

  select * into selected from public.vouchers
  where code_hash = voucher_hash and kind in ('days', 'lifetime') and status = 'available' and (expires_at is null or expires_at > now())
  for update skip locked;
  if selected.id is null then raise exception 'voucher_unavailable'; end if;
  ending := case when selected.grant_days is null then null else now() + make_interval(days => selected.grant_days) end;
  update public.vouchers set status = 'used', redeemed_by = target_user_id, redeemed_at = now() where id = selected.id;
  insert into public.entitlement_grants (user_id, plan_id, source, starts_at, expires_at)
  values (target_user_id, selected.plan_id, 'voucher', now(), ending);
  insert into public.audit_logs (actor_id, action, target_type, target_id, reason, metadata)
  values (target_user_id, 'voucher.redeemed', 'voucher', selected.id::text, 'Self-service voucher redemption', jsonb_build_object('label', selected.label));
  return query select selected.label, ending;
end;
$$;
revoke all on function public.redeem_voucher(uuid, text) from public, anon, authenticated;
grant execute on function public.redeem_voucher(uuid, text) to service_role;

-- 9) Reserve a discount voucher -- called by checkout-create-session BEFORE talking to Stripe ----
create or replace function public.reserve_voucher_discount(
  target_user_id uuid, voucher_hash text, request_id_input uuid, reservation_ttl_minutes integer default 35
)
returns table(
  kind text, label text, target_plan_id uuid,
  percent_off integer, amount_off_minor bigint, discount_currency text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  campaign public.voucher_campaigns%rowtype;
  selected public.vouchers%rowtype;
  existing public.voucher_reservations%rowtype;
  active_count integer;
begin
  if voucher_hash !~ '^[a-f0-9]{64}$' or request_id_input is null then raise exception 'voucher_unavailable'; end if;

  -- Idempotent retry: this exact request_id already reserved something, hand back the same reservation.
  select * into existing from public.voucher_reservations
  where user_id = target_user_id and request_id = request_id_input and status = 'pending';
  if existing.id is not null then
    if existing.campaign_id is not null then
      select * into campaign from public.voucher_campaigns where id = existing.campaign_id;
      return query select campaign.kind, campaign.label, campaign.plan_id, campaign.discount_percent_off, campaign.discount_amount_off_minor, campaign.discount_currency;
      return;
    else
      select * into selected from public.vouchers where id = existing.voucher_id;
      return query select selected.kind, selected.label, selected.plan_id, selected.discount_percent_off, selected.discount_amount_off_minor, selected.discount_currency;
      return;
    end if;
  end if;

  select * into campaign from public.voucher_campaigns
  where code_hash = voucher_hash and kind = 'discount' and enabled and (expires_at is null or expires_at > now())
  for update;
  if campaign.id is not null then
    -- Lazy reclaim: release this campaign's own abandoned reservations before counting capacity.
    update public.voucher_reservations set status = 'released', released_at = now()
    where campaign_id = campaign.id and status = 'pending' and expires_at < now();
    if exists (select 1 from public.voucher_reservations where campaign_id = campaign.id and user_id = target_user_id and status in ('pending', 'completed')) then
      raise exception 'voucher_already_redeemed';
    end if;
    select count(*) into active_count from public.voucher_reservations where campaign_id = campaign.id and status = 'pending';
    if campaign.maximum_redemptions is not null and (campaign.redemption_count + active_count) >= campaign.maximum_redemptions then
      raise exception 'voucher_unavailable';
    end if;
    insert into public.voucher_reservations (user_id, request_id, campaign_id, expires_at)
    values (target_user_id, request_id_input, campaign.id, now() + make_interval(mins => reservation_ttl_minutes));
    return query select campaign.kind, campaign.label, campaign.plan_id, campaign.discount_percent_off, campaign.discount_amount_off_minor, campaign.discount_currency;
    return;
  end if;

  select * into selected from public.vouchers
  where code_hash = voucher_hash and kind = 'discount' and status = 'available' and (expires_at is null or expires_at > now())
  for update skip locked;
  if selected.id is null then raise exception 'voucher_unavailable'; end if;
  update public.voucher_reservations set status = 'released', released_at = now()
  where voucher_id = selected.id and status = 'pending' and expires_at < now();
  if exists (select 1 from public.voucher_reservations where voucher_id = selected.id and status = 'pending') then
    raise exception 'voucher_unavailable';
  end if;
  insert into public.voucher_reservations (user_id, request_id, voucher_id, expires_at)
  values (target_user_id, request_id_input, selected.id, now() + make_interval(mins => reservation_ttl_minutes));
  return query select selected.kind, selected.label, selected.plan_id, selected.discount_percent_off, selected.discount_amount_off_minor, selected.discount_currency;
end;
$$;
revoke all on function public.reserve_voucher_discount(uuid, text, uuid, integer) from public, anon, authenticated;
grant execute on function public.reserve_voucher_discount(uuid, text, uuid, integer) to service_role;

-- 10) Explicit release -- called by the webhook on checkout.session.expired, or when session
-- creation itself fails right after reserving ----------------------------------------------------
create or replace function public.release_voucher_reservation(request_id_input uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.voucher_reservations set status = 'released', released_at = now()
  where request_id = request_id_input and status = 'pending';
  return found;
end;
$$;
revoke all on function public.release_voucher_reservation(uuid) from public, anon, authenticated;
grant execute on function public.release_voucher_reservation(uuid) to service_role;

-- 11) Finalize -- called by the webhook on checkout.session.completed, after the subscription
-- itself has been synchronized -------------------------------------------------------------------
create or replace function public.finalize_voucher_reservation(request_id_input uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare reservation public.voucher_reservations%rowtype;
begin
  select * into reservation from public.voucher_reservations where request_id = request_id_input and status = 'pending' for update;
  if reservation.id is null then return false; end if;
  if reservation.voucher_id is not null then
    update public.vouchers set status = 'used', redeemed_by = reservation.user_id, redeemed_at = now()
    where id = reservation.voucher_id and status <> 'used';
  end if;
  if reservation.campaign_id is not null then
    update public.voucher_campaigns set redemption_count = redemption_count + 1 where id = reservation.campaign_id;
  end if;
  update public.voucher_reservations set status = 'completed', completed_at = now() where id = reservation.id;
  insert into public.audit_logs (actor_id, action, target_type, target_id, reason, metadata)
  values (reservation.user_id, 'voucher.discount_finalized',
    case when reservation.voucher_id is not null then 'voucher' else 'voucher_campaign' end,
    coalesce(reservation.voucher_id, reservation.campaign_id)::text,
    'Stripe checkout completed with discount voucher', jsonb_build_object('request_id', request_id_input));
  return true;
end;
$$;
revoke all on function public.finalize_voucher_reservation(uuid) from public, anon, authenticated;
grant execute on function public.finalize_voucher_reservation(uuid) to service_role;

commit;
