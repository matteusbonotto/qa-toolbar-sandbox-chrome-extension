-- credit_reward_points() already allows founder callers internally (`not public.is_founder()`
-- in its own body), but the original grant in 20260723010000_reward_points_wheel.sql only
-- covers service_role — so the founder's own authenticated session gets a Postgres permission
-- error before the function body ever runs, breaking the admin console's manual point-adjustment
-- action. The function stays security definer with its internal role check, so this grant can't
-- be used by a non-founder authenticated user.
grant execute on function public.credit_reward_points(uuid, text, integer, text, text, jsonb) to authenticated;
