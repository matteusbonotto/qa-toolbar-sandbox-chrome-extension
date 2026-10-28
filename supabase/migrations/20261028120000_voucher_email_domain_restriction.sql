begin;

-- Voucher restricted to e-mail domains (incident 2026-10-28).
--
-- The campaigns "MB Labs - Release Manager vitalicio" and "Bankeiro - Release Manager vitalicio"
-- were meant only for people with an @mblabs.com.br / @bankeiro.com.br e-mail, but the schema never
-- had any way to express that: whoever got the code redeemed a lifetime Release Manager grant.
-- Production was mitigated by hand (campaigns disabled, bad grants revoked); this is the permanent
-- fix.
--
-- Rule (founder, 2026-10-28):
--   * allowed_email_domains NULL or empty = any e-mail (every voucher that already exists keeps
--     working exactly as before; purely additive).
--   * non-empty list = the redeeming account must have a CONFIRMED e-mail (auth.users
--     .email_confirmed_at not null) whose domain (lowercased text after the last "@") is EXACTLY
--     one of the listed domains. Exact match only: "evil-mblabs.com.br", "mblabs.com.br.evil.com"
--     and also subdomains like "x.mblabs.com.br" are rejected. Subdomains are deliberately NOT
--     implicit: a company that wants them lists them explicitly, so nobody who controls some
--     subdomain host (or a look-alike) inherits the grant by accident.
--   * Enforced inside the security definer RPCs (redeem_voucher, reserve_voucher_discount), not
--     only in the Edge Functions: the RPC is the single place every redemption passes through, so a
--     stale or buggy Edge Function deploy can never bypass it. Raises 'voucher_domain_not_allowed'.
--   * Why "confirmed": an unconfirmed sign-up can type any address (e.g. someone@mblabs.com.br) and
--     would otherwise get the grant without ever proving they own that mailbox. Only the current
--     auth.users.email counts (a pending email_change never does) and only an ASCII domain can
--     match (see voucher_user_email_domain). This depends on Supabase Auth "Confirm email" being ON
--     and on every enabled provider verifying e-mail: guarded live by
--     scripts/backend-security/check-live-auth-settings.mjs (docs/security.md).
--   * Forensics: audit_logs metadata of voucher.redeemed / voucher.discount_finalized carries the
--     voucher/campaign id and the e-mail DOMAIN only (never the full address).
--
-- Side fix in reserve_voucher_discount (section 5): its WHERE clauses used a bare `kind`, which is
-- ambiguous with the function's own OUT parameter `kind` (RETURNS TABLE), so every call raised
-- 'column reference "kind" is ambiguous' and checkout-create-session answered voucher_unavailable
-- for every discount voucher/campaign. Columns are now table-qualified. Covered by
-- scripts/backend-security/test-voucher-domain-restriction.mjs.

-- 1) Validator used by the CHECK constraints ----------------------------------------------------
-- Lowercase domains without "@", at least one dot, each label 1-63 chars of [a-z0-9-] not starting
-- or ending with "-", at most 20 domains. Pure function (no table access), so it is safe to leave
-- executable by the founder session that writes vouchers from the Admin.
create or replace function public.is_valid_email_domain_list(domains text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select domains is null or (
    coalesce(array_ndims(domains), 1) = 1
    and cardinality(domains) <= 20
    and not exists (
      select 1 from unnest(domains) as d(value)
      where d.value is null
        or char_length(d.value) > 253
        or d.value !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
    )
  );
$$;
revoke all on function public.is_valid_email_domain_list(text[]) from public, anon;
grant execute on function public.is_valid_email_domain_list(text[]) to authenticated, service_role;

-- 2) Column + constraint on both voucher tables -------------------------------------------------
alter table public.vouchers add column if not exists allowed_email_domains text[];
alter table public.voucher_campaigns add column if not exists allowed_email_domains text[];
alter table public.vouchers drop constraint if exists vouchers_allowed_email_domains_check;
alter table public.vouchers add constraint vouchers_allowed_email_domains_check
  check (public.is_valid_email_domain_list(allowed_email_domains));
alter table public.voucher_campaigns drop constraint if exists voucher_campaigns_allowed_email_domains_check;
alter table public.voucher_campaigns add constraint voucher_campaigns_allowed_email_domains_check
  check (public.is_valid_email_domain_list(allowed_email_domains));

-- 3) Domain helpers used by the redemption RPCs ------------------------------------------------
-- Neither is security definer nor executable by any API role: they only run inside the security
-- definer RPCs below (owned by postgres), so they never become an oracle that tells a caller which
-- e-mail a user id has.
--
-- voucher_user_email_domain: lowercased domain (text after the last "@") of the user's CURRENT
-- auth.users.email, or NULL when there is no e-mail or the domain has anything outside ASCII
-- [A-Za-z0-9.-]. The ASCII check runs on the RAW text BEFORE lower(): with a libc collation lower()
-- can fold non-ASCII letters into ASCII (e.g. U+0130 "İ" into "i"), which would let
-- "x@bankeİro.com.br" match "bankeiro.com.br" (security review 2026-10-28). Only `email` is read:
-- a pending `email_change` is not proven yet and never counts.
create or replace function public.voucher_user_email_domain(target_user_id uuid)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  raw_domain text;
begin
  select substring(u.email from '@([^@]+)$') into raw_domain
  from auth.users u where u.id = target_user_id;
  if raw_domain is null or raw_domain !~ '^[A-Za-z0-9.-]+$' then
    return null;
  end if;
  return lower(raw_domain);
end;
$$;
revoke all on function public.voucher_user_email_domain(uuid) from public, anon, authenticated;

create or replace function public.voucher_email_domain_allowed(allowed_domains text[], target_user_id uuid)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  user_confirmed_at timestamptz;
  user_domain text;
begin
  if allowed_domains is null or cardinality(allowed_domains) = 0 then
    return true;
  end if;
  select u.email_confirmed_at into user_confirmed_at from auth.users u where u.id = target_user_id;
  if user_confirmed_at is null then
    return false;
  end if;
  user_domain := public.voucher_user_email_domain(target_user_id);
  -- Second, redundant ASCII check right before the comparison (defense in depth).
  if user_domain is null or user_domain !~ '^[a-z0-9.-]+$' then
    return false;
  end if;
  return user_domain = any(allowed_domains);
end;
$$;
revoke all on function public.voucher_email_domain_allowed(text[], uuid) from public, anon, authenticated;

-- 4) redeem_voucher: same as 20260721010000 plus the domain check on both paths ----------------
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
    if not public.voucher_email_domain_allowed(campaign.allowed_email_domains, target_user_id) then
      raise exception 'voucher_domain_not_allowed';
    end if;
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
    values (target_user_id, 'voucher.redeemed', 'voucher_campaign', campaign.id::text, 'Self-service campaign redemption',
      jsonb_build_object('label', campaign.label, 'campaign_id', campaign.id,
        'email_domain', public.voucher_user_email_domain(target_user_id)));
    return query select campaign.label, ending;
    return;
  end if;

  select * into selected from public.vouchers
  where code_hash = voucher_hash and kind in ('days', 'lifetime') and status = 'available' and (expires_at is null or expires_at > now())
  for update skip locked;
  if selected.id is null then raise exception 'voucher_unavailable'; end if;
  if not public.voucher_email_domain_allowed(selected.allowed_email_domains, target_user_id) then
    raise exception 'voucher_domain_not_allowed';
  end if;
  ending := case when selected.grant_days is null then null else now() + make_interval(days => selected.grant_days) end;
  update public.vouchers set status = 'used', redeemed_by = target_user_id, redeemed_at = now() where id = selected.id;
  insert into public.entitlement_grants (user_id, plan_id, source, starts_at, expires_at)
  values (target_user_id, selected.plan_id, 'voucher', now(), ending);
  insert into public.audit_logs (actor_id, action, target_type, target_id, reason, metadata)
  values (target_user_id, 'voucher.redeemed', 'voucher', selected.id::text, 'Self-service voucher redemption',
    jsonb_build_object('label', selected.label, 'voucher_id', selected.id,
      'email_domain', public.voucher_user_email_domain(target_user_id)));
  return query select selected.label, ending;
end;
$$;
revoke all on function public.redeem_voucher(uuid, text) from public, anon, authenticated;
grant execute on function public.redeem_voucher(uuid, text) to service_role;

-- 5) reserve_voucher_discount: same as 20260721010000 plus the domain check -------------------
-- Also re-checked on the idempotent retry path, so a reservation can never be handed back to an
-- account that no longer qualifies (e.g. e-mail changed between the two calls).
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

  select * into existing from public.voucher_reservations
  where user_id = target_user_id and request_id = request_id_input and status = 'pending';
  if existing.id is not null then
    if existing.campaign_id is not null then
      select * into campaign from public.voucher_campaigns where id = existing.campaign_id;
      if not public.voucher_email_domain_allowed(campaign.allowed_email_domains, target_user_id) then
        raise exception 'voucher_domain_not_allowed';
      end if;
      return query select campaign.kind, campaign.label, campaign.plan_id, campaign.discount_percent_off, campaign.discount_amount_off_minor, campaign.discount_currency;
      return;
    else
      select * into selected from public.vouchers where id = existing.voucher_id;
      if not public.voucher_email_domain_allowed(selected.allowed_email_domains, target_user_id) then
        raise exception 'voucher_domain_not_allowed';
      end if;
      return query select selected.kind, selected.label, selected.plan_id, selected.discount_percent_off, selected.discount_amount_off_minor, selected.discount_currency;
      return;
    end if;
  end if;

  -- Columns qualified with the table alias: this function RETURNS TABLE(kind, label, ...), so a bare
  -- `kind` here is ambiguous with the OUT parameter and plpgsql raised 'column reference "kind" is
  -- ambiguous' on every call (found by test-voucher-domain-restriction.mjs on 2026-10-28; the
  -- 20260721010000 version had the same defect).
  select vc.* into campaign from public.voucher_campaigns vc
  where vc.code_hash = voucher_hash and vc.kind = 'discount' and vc.enabled and (vc.expires_at is null or vc.expires_at > now())
  for update;
  if campaign.id is not null then
    if not public.voucher_email_domain_allowed(campaign.allowed_email_domains, target_user_id) then
      raise exception 'voucher_domain_not_allowed';
    end if;
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

  select v.* into selected from public.vouchers v
  where v.code_hash = voucher_hash and v.kind = 'discount' and v.status = 'available' and (v.expires_at is null or v.expires_at > now())
  for update skip locked;
  if selected.id is null then raise exception 'voucher_unavailable'; end if;
  if not public.voucher_email_domain_allowed(selected.allowed_email_domains, target_user_id) then
    raise exception 'voucher_domain_not_allowed';
  end if;
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

-- 6) finalize_voucher_reservation: same as 20260721010000, audit metadata now also carries the
-- voucher/campaign id and the user's e-mail DOMAIN (never the full address) for forensics.
-- reserve_voucher_discount itself writes no audit row; the discount flow is audited here, when
-- the Stripe webhook confirms payment.
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
    'Stripe checkout completed with discount voucher',
    jsonb_build_object('request_id', request_id_input, 'voucher_id', reservation.voucher_id,
      'campaign_id', reservation.campaign_id,
      'email_domain', public.voucher_user_email_domain(reservation.user_id)));
  return true;
end;
$$;
revoke all on function public.finalize_voucher_reservation(uuid) from public, anon, authenticated;
grant execute on function public.finalize_voucher_reservation(uuid) to service_role;

commit;
