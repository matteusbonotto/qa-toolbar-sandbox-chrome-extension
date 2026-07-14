create table public.voucher_campaigns (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique check (code_hash ~ '^[a-f0-9]{64}$'),
  label text not null check (char_length(label) between 3 and 100),
  plan_id uuid not null references public.plans(id) on delete restrict,
  grant_days integer not null check (grant_days between 1 and 3650),
  maximum_redemptions integer check (maximum_redemptions is null or maximum_redemptions > 0),
  redemption_count integer not null default 0 check (redemption_count >= 0),
  enabled boolean not null default true,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (maximum_redemptions is null or redemption_count <= maximum_redemptions)
);

create table public.voucher_campaign_redemptions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.voucher_campaigns(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  entitlement_grant_id uuid not null references public.entitlement_grants(id) on delete restrict,
  redeemed_at timestamptz not null default now(),
  unique (campaign_id, user_id)
);

create trigger voucher_campaigns_set_updated_at before update on public.voucher_campaigns
for each row execute function public.set_updated_at();

alter table public.voucher_campaigns enable row level security;
alter table public.voucher_campaigns force row level security;
alter table public.voucher_campaign_redemptions enable row level security;
alter table public.voucher_campaign_redemptions force row level security;
revoke all on public.voucher_campaigns, public.voucher_campaign_redemptions from anon, authenticated;

create or replace function public.redeem_voucher(target_user_id uuid, voucher_hash text)
returns table(label text, access_expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  campaign public.voucher_campaigns%rowtype;
  selected public.vouchers%rowtype;
  ending timestamptz;
  created_grant_id uuid;
begin
  select * into campaign from public.voucher_campaigns
  where code_hash = voucher_hash and enabled and (expires_at is null or expires_at > now())
  for update;

  if campaign.id is not null then
    if campaign.maximum_redemptions is not null and campaign.redemption_count >= campaign.maximum_redemptions then
      raise exception 'voucher_unavailable';
    end if;
    if exists(select 1 from public.voucher_campaign_redemptions where campaign_id = campaign.id and user_id = target_user_id) then
      raise exception 'voucher_already_redeemed';
    end if;
    ending := now() + make_interval(days => campaign.grant_days);
    insert into public.entitlement_grants(user_id,plan_id,source,starts_at,expires_at)
    values(target_user_id,campaign.plan_id,'voucher',now(),ending) returning id into created_grant_id;
    insert into public.voucher_campaign_redemptions(campaign_id,user_id,entitlement_grant_id)
    values(campaign.id,target_user_id,created_grant_id);
    update public.voucher_campaigns set redemption_count = redemption_count + 1 where id = campaign.id;
    insert into public.audit_logs(actor_id,action,target_type,target_id,reason,metadata)
    values(target_user_id,'voucher.redeemed','voucher_campaign',campaign.id::text,'Self-service campaign redemption',jsonb_build_object('label',campaign.label));
    return query select campaign.label, ending;
    return;
  end if;

  select * into selected from public.vouchers
  where code_hash=voucher_hash and status='available' and (expires_at is null or expires_at > now())
  for update skip locked;
  if selected.id is null then raise exception 'voucher_unavailable'; end if;
  ending := case when selected.grant_days is null then null else now() + make_interval(days => selected.grant_days) end;
  update public.vouchers set status='used',redeemed_by=target_user_id,redeemed_at=now() where id=selected.id;
  insert into public.entitlement_grants(user_id,plan_id,source,starts_at,expires_at)
  values(target_user_id,selected.plan_id,'voucher',now(),ending);
  insert into public.audit_logs(actor_id,action,target_type,target_id,reason,metadata)
  values(target_user_id,'voucher.redeemed','voucher',selected.id::text,'Self-service voucher redemption',jsonb_build_object('label',selected.label));
  return query select selected.label, ending;
end $$;
revoke all on function public.redeem_voucher(uuid,text) from public,anon,authenticated;
grant execute on function public.redeem_voucher(uuid,text) to service_role;

insert into public.voucher_campaigns(code_hash,label,plan_id,grant_days,maximum_redemptions)
select encode(extensions.digest(convert_to(upper('30DIAS'),'UTF8'),'sha256'),'hex'), '30 dias de Full Access', id, 30, null
from public.plans where key = 'scale'
on conflict(code_hash) do update set label=excluded.label,plan_id=excluded.plan_id,grant_days=excluded.grant_days,enabled=true;
