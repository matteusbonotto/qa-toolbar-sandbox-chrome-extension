begin;

-- The reward wheel never worked in production (stress/security audit 2026-10-22, confirmed read-only
-- against the live database): spin_reward_wheel runs with search_path = public, pg_temp, but called
-- gen_random_bytes/digest unqualified while pgcrypto lives in the `extensions` schema, so every spin
-- raised "function gen_random_bytes does not exist" and rewards-spin answered 500. Same body, with
-- the pgcrypto calls schema-qualified (schema.sql already uses extensions.digest elsewhere).
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
  random_bytes:=extensions.gen_random_bytes(4); random_number:=(('x'||encode(random_bytes,'hex'))::bit(32)::bigint); target_weight:=(random_number % total_weight)+1;
  select p.id into chosen_id from (select rp.id,sum(weight) over(order by display_order,id) cumulative from public.reward_prizes rp
    where program_id=program.id and enabled and minimum_lifetime_points<=wallet.lifetime_points
      and (maximum_global_awards is null or awarded_count<maximum_global_awards) and (kind<>'plan_days' or promo_days+grant_days<=30)) p
    where p.cumulative>=target_weight order by p.cumulative limit 1;
  select * into chosen from public.reward_prizes where id=chosen_id for update;
  update public.reward_wallets set available_points=available_points-program.points_per_spin,spent_points=spent_points+program.points_per_spin,version=version+1,updated_at=now() where user_id=uid;
  insert into public.reward_point_entries(user_id,event_kind,points,status,source_type,source_reference,metadata,available_at)
    values(uid,'spin_debit',-program.points_per_spin,'available','reward_spin',new_spin::text,jsonb_build_object('requestId',request_id_input),now());
  insert into public.reward_spins(id,user_id,program_id,request_id,points_spent,prize_id,prize_snapshot,random_digest,eligible_weight_total)
    values(new_spin,uid,program.id,request_id_input,program.points_per_spin,chosen.id,jsonb_build_object('key',chosen.key,'kind',chosen.kind,'discountPercent',chosen.discount_percent,'planId',chosen.plan_id,'grantDays',chosen.grant_days,'weight',chosen.weight),encode(extensions.digest(random_bytes||convert_to(new_spin::text,'utf8'),'sha256'),'hex'),total_weight);
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

commit;
