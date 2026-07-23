-- The points program fully replaces the legacy automatic 30-day referral grant.
-- Removing the callable routine prevents a future worker or manual script from
-- accidentally restoring the economically unsafe behavior.
drop function if exists public.reward_referral(uuid);

insert into public.audit_logs(actor_id,action,target_type,target_id,reason)
values(null,'rewards.legacy_function_retired','database_function','public.reward_referral(uuid)','Replaced by first-payment points and the bounded reward wheel');
