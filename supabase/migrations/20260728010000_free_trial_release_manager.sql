create or replace function public.activate_free_trial(target_user_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  trial_plan_id uuid;
  trial_end timestamptz;
begin
  select id into trial_plan_id
  from public.plans
  where key = 'release-manager' and is_active;

  select trial_ends_at into trial_end
  from public.profiles
  where id = target_user_id
  for update;

  if trial_plan_id is null or trial_end is null or trial_end <= now() then
    raise exception 'free_trial_unavailable';
  end if;

  if exists (
    select 1
    from public.entitlement_grants
    where user_id = target_user_id
      and revoked_at is null
      and starts_at <= now()
      and (expires_at is null or expires_at > now())
      and source <> 'trial'
  ) then
    raise exception 'active_entitlement_exists';
  end if;

  insert into public.entitlement_grants (user_id, plan_id, source, source_reference, expires_at)
  values (target_user_id, trial_plan_id, 'trial', 'initial-free-trial', trial_end)
  on conflict (user_id, source, source_reference) where source_reference is not null
  do update set plan_id = excluded.plan_id, revoked_at = null, expires_at = excluded.expires_at;

  return trial_end;
end;
$$;

revoke all on function public.activate_free_trial(uuid) from public, anon, authenticated;
grant execute on function public.activate_free_trial(uuid) to service_role;
