-- Final production gate: fail closed unless the complete catalog is present.
do $$
declare v_program_id uuid; prize_count integer; top_tier_weight integer;
begin
  select rp.id into v_program_id from public.reward_programs rp where rp.key='qa-rewards-2026' and rp.points_per_spin=100 and rp.max_spins_per_user_per_day=10;
  if v_program_id is null then raise exception 'qa_rewards_program_invalid'; end if;
  select count(*),coalesce(sum(weight),0) into prize_count,top_tier_weight from public.reward_prizes
    where reward_prizes.program_id=v_program_id and enabled and minimum_lifetime_points<=700;
  if prize_count<>5 or top_tier_weight<>100 then raise exception 'qa_rewards_catalog_invalid'; end if;
  if exists(select 1 from public.reward_prizes where reward_prizes.program_id=v_program_id and
    ((kind='discount_percent' and discount_percent not in (5,10,15)) or (kind='plan_days' and grant_days not in (10,15)))) then
    raise exception 'qa_rewards_prize_limits_invalid';
  end if;
  update public.reward_programs set enabled=true,updated_at=now() where id=v_program_id;
  insert into public.audit_logs(actor_id,action,target_type,target_id,reason,metadata)
  values(null,'rewards.program_activated','reward_program',v_program_id::text,'Production catalog validated by release gate',jsonb_build_object('prizes',prize_count,'topTierWeight',top_tier_weight));
end $$;
