-- Sustainable referral/community rewards: auditable points and a server-side wheel.
create extension if not exists pgcrypto;

create table if not exists public.reward_programs (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z][a-z0-9_-]{1,63}$'),
  name text not null,
  points_per_spin integer not null default 100 check (points_per_spin between 1 and 100000),
  enabled boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  max_spins_per_user_per_day integer not null default 10 check (max_spins_per_user_per_day between 1 and 100),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.reward_wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  available_points integer not null default 0,
  pending_points integer not null default 0 check (pending_points >= 0),
  lifetime_points integer not null default 0 check (lifetime_points >= 0),
  spent_points integer not null default 0 check (spent_points >= 0),
  debt_points integer not null default 0 check (debt_points >= 0),
  version bigint not null default 0, updated_at timestamptz not null default now()
);

create table if not exists public.reward_point_entries (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  event_kind text not null check (event_kind in ('referral_paid','community_social','product_feedback','spin_debit','reversal','admin_adjustment')),
  points integer not null check (points <> 0), status text not null default 'available' check (status in ('pending','available','reversed')),
  source_type text not null, source_reference text not null, reverses_entry_id uuid references public.reward_point_entries(id),
  reason text, metadata jsonb not null default '{}'::jsonb, available_at timestamptz, created_at timestamptz not null default now(),
  unique(event_kind, source_type, source_reference)
);
create unique index if not exists idx_reward_point_one_reversal on public.reward_point_entries(reverses_entry_id) where reverses_entry_id is not null;
create index if not exists idx_reward_point_user_created on public.reward_point_entries(user_id,created_at desc);

create table if not exists public.reward_prizes (
  id uuid primary key default gen_random_uuid(), program_id uuid not null references public.reward_programs(id) on delete cascade,
  key text not null, label_pt text not null, label_es text not null, label_en text not null,
  kind text not null check (kind in ('discount_percent','plan_days')),
  discount_percent integer check (discount_percent in (5,10,15)), plan_id uuid references public.plans(id),
  grant_days integer check (grant_days in (10,15)), weight integer not null check (weight > 0),
  minimum_lifetime_points integer not null default 0 check (minimum_lifetime_points >= 0),
  maximum_global_awards integer check (maximum_global_awards is null or maximum_global_awards > 0),
  awarded_count integer not null default 0 check (awarded_count >= 0), enabled boolean not null default true,
  display_order integer not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(program_id,key),
  check ((kind='discount_percent' and discount_percent is not null and plan_id is null and grant_days is null)
    or (kind='plan_days' and discount_percent is null and plan_id is not null and grant_days is not null))
);

create table if not exists public.reward_spins (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  program_id uuid not null references public.reward_programs(id), request_id uuid not null,
  points_spent integer not null check (points_spent > 0), prize_id uuid not null references public.reward_prizes(id),
  prize_snapshot jsonb not null, random_digest text not null, eligible_weight_total integer not null check (eligible_weight_total > 0),
  created_at timestamptz not null default now(), unique(user_id,request_id)
);
create index if not exists idx_reward_spins_user_created on public.reward_spins(user_id,created_at desc);

create table if not exists public.reward_benefits (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  spin_id uuid not null unique references public.reward_spins(id), kind text not null check (kind in ('discount_percent','plan_days')),
  discount_percent integer check (discount_percent in (5,10,15)), plan_id uuid references public.plans(id), grant_days integer check (grant_days in (10,15)),
  status text not null check (status in ('available','reserved','applied','consumed','expired','revoked','superseded')),
  reserved_request_id uuid, reserved_until timestamptz, checkout_session_id text, entitlement_grant_id uuid references public.entitlement_grants(id),
  expires_at timestamptz not null, applied_at timestamptz, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(),
  check ((kind='discount_percent' and discount_percent is not null and plan_id is null and grant_days is null)
    or (kind='plan_days' and discount_percent is null and plan_id is not null and grant_days is not null))
);
create unique index if not exists idx_reward_benefit_reserved_request on public.reward_benefits(reserved_request_id) where reserved_request_id is not null;
create index if not exists idx_reward_benefit_user_status on public.reward_benefits(user_id,status,expires_at);
create unique index if not exists idx_campaign_approved_social_url_once on public.engagement_campaign_submissions(lower(social_post_url)) where status='approved';
create unique index if not exists idx_campaign_approved_linkedin_url_once on public.engagement_campaign_submissions(lower(linkedin_post_url)) where status='approved';

insert into public.reward_programs(key,name,points_per_spin,enabled,max_spins_per_user_per_day)
values('qa-rewards-2026','QA Rewards',100,false,10) on conflict(key) do nothing;

with program as (select id from public.reward_programs where key='qa-rewards-2026'), plan_ids as (
  select key,id from public.plans where key in ('root-cause-analyst','release-manager')
)
insert into public.reward_prizes(program_id,key,label_pt,label_es,label_en,kind,discount_percent,plan_id,grant_days,weight,minimum_lifetime_points,display_order)
select program.id,v.key,v.pt,v.es,v.en,v.kind,v.discount,(select id from plan_ids where key=v.plan_key),v.days,v.weight,v.minimum,v.ord
from program cross join (values
 ('discount-5','5% na próxima cobrança','5% en el próximo cobro','5% off the next charge','discount_percent',5,null::text,null::integer,45,0,1),
 ('discount-10','10% na próxima cobrança','10% en el próximo cobro','10% off the next charge','discount_percent',10,null,null,25,300,2),
 ('discount-15','15% na próxima cobrança','15% en el próximo cobro','15% off the next charge','discount_percent',15,null,null,10,700,3),
 ('root-10d','10 dias de Root Cause Analyst','10 días de Root Cause Analyst','10 days of Root Cause Analyst','plan_days',null,'root-cause-analyst',10,15,100,4),
 ('full-15d','15 dias de Release Manager','15 días de Release Manager','15 days of Release Manager','plan_days',null,'release-manager',15,5,700,5)
) as v(key,pt,es,en,kind,discount,plan_key,days,weight,minimum,ord) on conflict(program_id,key) do nothing;

create or replace function public.credit_reward_points(target_user_id uuid,event_kind_input text,points_input integer,source_type_input text,source_reference_input text,metadata_input jsonb default '{}'::jsonb)
returns table(entry_id uuid,available_points integer,created boolean) language plpgsql security definer set search_path=public,pg_temp as $$
declare existing_id uuid; new_id uuid; balance integer;
begin
  if auth.role()<>'service_role' and not public.is_founder() then raise exception 'forbidden'; end if;
  if points_input <= 0 or event_kind_input not in ('referral_paid','community_social','product_feedback','admin_adjustment') then raise exception 'invalid_reward_credit'; end if;
  select id into existing_id from public.reward_point_entries where event_kind=event_kind_input and source_type=source_type_input and source_reference=source_reference_input;
  if existing_id is not null then select w.available_points into balance from public.reward_wallets w where w.user_id=target_user_id; return query select existing_id,coalesce(balance,0),false; return; end if;
  insert into public.reward_wallets(user_id) values(target_user_id) on conflict(user_id) do nothing;
  perform 1 from public.reward_wallets where user_id=target_user_id for update;
  insert into public.reward_point_entries(user_id,event_kind,points,status,source_type,source_reference,metadata,available_at)
  values(target_user_id,event_kind_input,points_input,'available',source_type_input,left(source_reference_input,200),coalesce(metadata_input,'{}'::jsonb),now()) returning id into new_id;
  update public.reward_wallets set available_points=available_points+points_input,lifetime_points=lifetime_points+points_input,version=version+1,updated_at=now() where user_id=target_user_id returning reward_wallets.available_points into balance;
  insert into public.audit_logs(actor_id,action,target_type,target_id,metadata) values(auth.uid(),'rewards.points_credited','reward_point_entry',new_id::text,jsonb_build_object('userId',target_user_id,'points',points_input,'kind',event_kind_input));
  return query select new_id,balance,true;
end; $$;
revoke all on function public.credit_reward_points(uuid,text,integer,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.credit_reward_points(uuid,text,integer,text,text,jsonb) to service_role;

create or replace function public.qualify_paid_referral(referred_user_id_input uuid,stripe_invoice_id_input text,amount_minor_input bigint)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare row public.referrals%rowtype;
begin
  if auth.role()<>'service_role' then raise exception 'forbidden'; end if;
  if amount_minor_input<=0 or nullif(trim(stripe_invoice_id_input),'') is null then return false; end if;
  select r.* into row from public.referrals r join public.referral_profiles p on p.user_id=r.referrer_user_id and p.enabled
    where r.referred_user_id=referred_user_id_input and r.status='pending' for update of r skip locked;
  if row.id is null then return false; end if;
  perform public.credit_reward_points(row.referrer_user_id,'referral_paid',100,'referral',row.id::text,jsonb_build_object('invoiceId',stripe_invoice_id_input,'amountMinor',amount_minor_input));
  update public.referrals set status='qualified',qualified_at=now(),reward_type=null,reward_reference='points:100' where id=row.id;
  update public.referral_profiles set qualified_referrals=qualified_referrals+1,updated_at=now() where user_id=row.referrer_user_id;
  return true;
end; $$;
revoke all on function public.qualify_paid_referral(uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.qualify_paid_referral(uuid,text,bigint) to service_role;

create or replace function public.reverse_referral_points(referred_user_id_input uuid,provider_reference_input text,reason_input text)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare original public.reward_point_entries%rowtype; balance integer; deducted integer; shortage integer;
begin
  if auth.role()<>'service_role' then raise exception 'forbidden'; end if;
  select e.* into original from public.reward_point_entries e join public.referrals r on r.id::text=e.source_reference
    where r.referred_user_id=referred_user_id_input and e.event_kind='referral_paid' and e.status='available' for update of e;
  if original.id is null or exists(select 1 from public.reward_point_entries where reverses_entry_id=original.id) then return false; end if;
  perform 1 from public.reward_wallets where user_id=original.user_id for update;
  select available_points into balance from public.reward_wallets where user_id=original.user_id;
  deducted:=least(balance,original.points); shortage:=original.points-deducted;
  update public.reward_point_entries set status='reversed' where id=original.id;
  insert into public.reward_point_entries(user_id,event_kind,points,status,source_type,source_reference,reverses_entry_id,reason,available_at)
  values(original.user_id,'reversal',-original.points,'available','stripe',left(provider_reference_input,200),original.id,left(reason_input,500),now());
  update public.reward_wallets set available_points=available_points-deducted,debt_points=debt_points+shortage,version=version+1,updated_at=now() where user_id=original.user_id;
  update public.referrals set status='rejected',reward_reference='reversed:'||left(provider_reference_input,120) where id::text=original.source_reference;
  return true;
end; $$;
revoke all on function public.reverse_referral_points(uuid,text,text) from public,anon,authenticated;
grant execute on function public.reverse_referral_points(uuid,text,text) to service_role;

create or replace function public.spin_reward_wheel(request_id_input uuid,target_user_id_input uuid default null)
returns table(spin_id uuid,prize_key text,prize_label_pt text,prize_label_es text,prize_label_en text,benefit_id uuid,remaining_points integer)
language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=case when auth.role()='service_role' then target_user_id_input else auth.uid() end; program public.reward_programs%rowtype; wallet public.reward_wallets%rowtype; chosen public.reward_prizes%rowtype; chosen_id uuid;
  existing public.reward_spins%rowtype; random_bytes bytea; random_number bigint; target_weight integer; total_weight integer; new_spin uuid:=gen_random_uuid(); new_benefit uuid; grant_id uuid; promo_days integer;
begin
  if uid is null then raise exception 'authentication_required'; end if;
  select * into existing from public.reward_spins where user_id=uid and request_id=request_id_input;
  if existing.id is not null then
    select p.* into chosen from public.reward_prizes p where p.id=existing.prize_id;
    select b.id into new_benefit from public.reward_benefits b where b.spin_id=existing.id;
    return query select existing.id,chosen.key,chosen.label_pt,chosen.label_es,chosen.label_en,new_benefit,(select available_points from public.reward_wallets where user_id=uid); return;
  end if;
  select * into program from public.reward_programs where enabled and (starts_at is null or starts_at<=now()) and (ends_at is null or ends_at>now()) order by created_at desc limit 1;
  if program.id is null then raise exception 'reward_program_unavailable'; end if;
  insert into public.reward_wallets(user_id) values(uid) on conflict(user_id) do nothing;
  select * into wallet from public.reward_wallets where user_id=uid for update;
  if wallet.debt_points>0 then raise exception 'reward_debt_outstanding'; end if;
  if wallet.available_points<program.points_per_spin then raise exception 'insufficient_reward_points'; end if;
  if (select count(*) from public.reward_spins where user_id=uid and created_at>=date_trunc('day',now()))>=program.max_spins_per_user_per_day then raise exception 'daily_spin_limit'; end if;
  select coalesce(sum(grant_days),0) into promo_days from public.reward_benefits where user_id=uid and kind='plan_days' and status in ('applied','consumed') and created_at>=now()-interval '90 days';
  select sum(weight) into total_weight from public.reward_prizes where program_id=program.id and enabled and minimum_lifetime_points<=wallet.lifetime_points
    and (maximum_global_awards is null or awarded_count<maximum_global_awards) and (kind<>'plan_days' or promo_days+grant_days<=30);
  if coalesce(total_weight,0)<=0 then raise exception 'no_eligible_reward_prizes'; end if;
  random_bytes:=gen_random_bytes(4); random_number:=(('x'||encode(random_bytes,'hex'))::bit(32)::bigint); target_weight:=(random_number % total_weight)+1;
  select p.id into chosen_id from (select rp.id,sum(weight) over(order by display_order,id) cumulative from public.reward_prizes rp
    where program_id=program.id and enabled and minimum_lifetime_points<=wallet.lifetime_points
      and (maximum_global_awards is null or awarded_count<maximum_global_awards) and (kind<>'plan_days' or promo_days+grant_days<=30)) p
    where p.cumulative>=target_weight order by p.cumulative limit 1;
  select * into chosen from public.reward_prizes where id=chosen_id for update;
  update public.reward_wallets set available_points=available_points-program.points_per_spin,spent_points=spent_points+program.points_per_spin,version=version+1,updated_at=now() where user_id=uid;
  insert into public.reward_point_entries(user_id,event_kind,points,status,source_type,source_reference,metadata,available_at)
    values(uid,'spin_debit',-program.points_per_spin,'available','reward_spin',new_spin::text,jsonb_build_object('requestId',request_id_input),now());
  insert into public.reward_spins(id,user_id,program_id,request_id,points_spent,prize_id,prize_snapshot,random_digest,eligible_weight_total)
    values(new_spin,uid,program.id,request_id_input,program.points_per_spin,chosen.id,jsonb_build_object('key',chosen.key,'kind',chosen.kind,'discountPercent',chosen.discount_percent,'planId',chosen.plan_id,'grantDays',chosen.grant_days,'weight',chosen.weight),encode(digest(random_bytes||convert_to(new_spin::text,'utf8'),'sha256'),'hex'),total_weight);
  if chosen.kind='plan_days' then
    insert into public.entitlement_grants(user_id,plan_id,source,source_reference,starts_at,expires_at)
      values(uid,chosen.plan_id,'manual','reward-spin:'||new_spin::text,now(),now()+make_interval(days=>chosen.grant_days)) returning id into grant_id;
    insert into public.reward_benefits(user_id,spin_id,kind,plan_id,grant_days,status,entitlement_grant_id,expires_at,applied_at)
      values(uid,new_spin,'plan_days',chosen.plan_id,chosen.grant_days,'applied',grant_id,now()+make_interval(days=>chosen.grant_days),now()) returning id into new_benefit;
  else
    update public.reward_benefits set status='superseded' where user_id=uid and kind='discount_percent' and status='available' and discount_percent<=chosen.discount_percent;
    insert into public.reward_benefits(user_id,spin_id,kind,discount_percent,status,expires_at)
      values(uid,new_spin,'discount_percent',chosen.discount_percent,'available',now()+interval '60 days') returning id into new_benefit;
  end if;
  update public.reward_prizes set awarded_count=awarded_count+1,updated_at=now() where id=chosen.id;
  insert into public.audit_logs(actor_id,action,target_type,target_id,metadata) values(uid,'rewards.wheel_spun','reward_spin',new_spin::text,jsonb_build_object('prizeKey',chosen.key,'points',program.points_per_spin));
  return query select new_spin,chosen.key,chosen.label_pt,chosen.label_es,chosen.label_en,new_benefit,wallet.available_points-program.points_per_spin;
end; $$;
revoke all on function public.spin_reward_wheel(uuid,uuid) from public,anon;
grant execute on function public.spin_reward_wheel(uuid,uuid) to authenticated,service_role;

create or replace function public.mark_reward_discount_applied(target_user_id uuid,benefit_id_input uuid,stripe_coupon_id_input text,stripe_subscription_id_input text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if auth.role()<>'service_role' then raise exception 'forbidden'; end if;
  update public.reward_benefits set status='applied',checkout_session_id=left(stripe_subscription_id_input,255),applied_at=now(),reserved_request_id=null,reserved_until=null,
    metadata=jsonb_build_object('stripeCouponId',left(stripe_coupon_id_input,255))
  where id=benefit_id_input and user_id=target_user_id and kind='discount_percent' and status='available';
  if not found then raise exception 'reward_benefit_unavailable'; end if;
end; $$;
revoke all on function public.mark_reward_discount_applied(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.mark_reward_discount_applied(uuid,uuid,text,text) to service_role;

create or replace function public.reserve_best_reward_discount(target_user_id uuid,request_id_input uuid)
returns table(benefit_id uuid,percent_off integer) language plpgsql security definer set search_path=public,pg_temp as $$
declare selected public.reward_benefits%rowtype;
begin
  if auth.role()<>'service_role' then raise exception 'forbidden'; end if;
  update public.reward_benefits set status='available',reserved_request_id=null,reserved_until=null where user_id=target_user_id and status='reserved' and reserved_until<now();
  select * into selected from public.reward_benefits where user_id=target_user_id and kind='discount_percent' and status='available' and expires_at>now() order by discount_percent desc,created_at for update skip locked limit 1;
  if selected.id is null then return; end if;
  update public.reward_benefits set status='reserved',reserved_request_id=request_id_input,reserved_until=now()+interval '30 minutes' where id=selected.id;
  return query select selected.id,selected.discount_percent;
end; $$;
create or replace function public.release_reward_discount(request_id_input uuid) returns void language sql security definer set search_path=public,pg_temp as $$
  update public.reward_benefits set status='available',reserved_request_id=null,reserved_until=null where reserved_request_id=request_id_input and status='reserved';
$$;
create or replace function public.finalize_reward_discount(request_id_input uuid,checkout_session_id_input text) returns void language sql security definer set search_path=public,pg_temp as $$
  update public.reward_benefits set status='consumed',checkout_session_id=left(checkout_session_id_input,255),applied_at=now(),reserved_until=null where reserved_request_id=request_id_input and status='reserved';
$$;
revoke all on function public.reserve_best_reward_discount(uuid,uuid),public.release_reward_discount(uuid),public.finalize_reward_discount(uuid,text) from public,anon,authenticated;
grant execute on function public.reserve_best_reward_discount(uuid,uuid),public.release_reward_discount(uuid),public.finalize_reward_discount(uuid,text) to service_role;

drop function if exists public.review_engagement_campaign(uuid,boolean,text,jsonb);
create or replace function public.review_engagement_campaign(submission_id_input uuid,approve boolean,notes text default null,criteria jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare submission public.engagement_campaign_submissions%rowtype; all_met boolean; first_entry uuid;
begin
  if auth.role()<>'service_role' and not public.is_founder() then raise exception 'forbidden'; end if;
  select * into submission from public.engagement_campaign_submissions where id=submission_id_input for update;
  if submission.id is null then raise exception 'campaign_submission_not_found'; end if;
  if submission.status='approved' then select id into first_entry from public.reward_point_entries where source_type='campaign_submission' and source_reference=submission.id::text order by created_at limit 1; return first_entry; end if;
  all_met:=coalesce((criteria->>'socialPostPublic')::boolean,false) and coalesce((criteria->>'socialPostDescribesUse')::boolean,false)
    and coalesce((criteria->>'linkedinPostPublic')::boolean,false) and coalesce((criteria->>'linkedinPostDescribesUse')::boolean,false)
    and coalesce((criteria->>'campaignDisclosureVisible')::boolean,false) and coalesce((criteria->>'productFeedbackUseful')::boolean,false) and coalesce((criteria->>'identityConsistent')::boolean,false);
  if approve and not all_met then raise exception 'campaign_requirements_incomplete'; end if;
  if not approve then
    if nullif(trim(notes),'') is null then raise exception 'campaign_review_notes_required'; end if;
    update public.engagement_campaign_submissions set status='rejected',review_notes=left(trim(notes),1000),review_criteria=criteria,reviewed_at=now(),reviewed_by=auth.uid() where id=submission.id; return null;
  end if;
  select entry_id into first_entry from public.credit_reward_points(submission.user_id,'community_social',40,'campaign_submission',submission.id::text||':social',jsonb_build_object('criteria',criteria));
  perform public.credit_reward_points(submission.user_id,'product_feedback',20,'campaign_submission',submission.id::text||':feedback',jsonb_build_object('criteria',criteria));
  update public.engagement_campaign_submissions set status='approved',review_notes=coalesce(nullif(left(trim(notes),1000),''),'Requisitos comprovados; 60 pontos creditados.'),review_criteria=criteria,reviewed_at=now(),reviewed_by=auth.uid(),reward_grant_id=null where id=submission.id;
  insert into public.audit_logs(actor_id,action,target_type,target_id,metadata) values(auth.uid(),'campaign.points_approved','engagement_campaign_submission',submission.id::text,jsonb_build_object('points',60,'criteria',criteria));
  return first_entry;
end; $$;
revoke all on function public.review_engagement_campaign(uuid,boolean,text,jsonb) from public,anon;
grant execute on function public.review_engagement_campaign(uuid,boolean,text,jsonb) to authenticated,service_role;

alter table public.reward_programs enable row level security; alter table public.reward_wallets enable row level security;
alter table public.reward_point_entries enable row level security; alter table public.reward_prizes enable row level security;
alter table public.reward_spins enable row level security; alter table public.reward_benefits enable row level security;
create policy "public reads active reward program" on public.reward_programs for select using(enabled or public.is_founder());
create policy "public reads enabled reward prizes" on public.reward_prizes for select using(enabled or public.is_founder());
create policy "user reads own reward wallet" on public.reward_wallets for select using(auth.uid()=user_id or public.is_founder());
create policy "user reads own reward entries" on public.reward_point_entries for select using(auth.uid()=user_id or public.is_founder());
create policy "user reads own reward spins" on public.reward_spins for select using(auth.uid()=user_id or public.is_founder());
create policy "user reads own reward benefits" on public.reward_benefits for select using(auth.uid()=user_id or public.is_founder());
create policy "founder manages reward programs" on public.reward_programs for all using(public.is_founder()) with check(public.is_founder());
create policy "founder manages reward prizes" on public.reward_prizes for all using(public.is_founder()) with check(public.is_founder());

insert into public.audit_logs(actor_id,action,target_type,target_id,reason,metadata)
select null,'rewards.legacy_grant_preserved','entitlement_grant',id::text,'Previous 30-day benefit preserved; no new automatic grants',jsonb_build_object('sourceReference',source_reference)
from public.entitlement_grants where source='manual' and (source_reference like 'referral:%' or source_reference like 'campaign:%')
on conflict do nothing;
