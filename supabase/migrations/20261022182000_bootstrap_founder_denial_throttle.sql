begin;

-- bootstrap_founder() is callable by any authenticated user; each denied call inserted an audit row,
-- so audit_logs could be flooded at will (security audit 2026-10-22, low). Denials are now recorded
-- at most once per caller per hour. Same function otherwise.
create or replace function public.bootstrap_founder()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := auth.uid();
  caller_email text;
  caller_confirmed boolean;
  founder_role_id uuid;
begin
  if caller_id is null then
    raise exception 'not authenticated';
  end if;

  select email, (email_confirmed_at is not null) into caller_email, caller_confirmed
  from auth.users where id = caller_id;

  if lower(coalesce(caller_email, '')) <> 'matteusbonotto+admin@gmail.com' or coalesce(caller_confirmed, false) = false then
    -- At most one denial row per caller per hour: any signed-in user can call this, and an
    -- unthrottled insert per call let anyone flood audit_logs (security audit 2026-10-22).
    if not exists (
      select 1 from public.audit_logs
      where actor_id = caller_id and action = 'bootstrap_founder.denied' and created_at > now() - interval '1 hour'
    ) then
      insert into public.audit_logs (actor_id, action, target_type, target_id, reason, metadata)
      values (caller_id, 'bootstrap_founder.denied', 'user_roles', caller_id::text, 'email not authorized or unverified', jsonb_build_object('email', caller_email));
    end if;
    return false;
  end if;

  select id into founder_role_id from public.roles where key = 'founder';
  if founder_role_id is null then
    insert into public.roles (key, description, is_system) values ('founder', 'Founder — full administrative access', true)
    returning id into founder_role_id;
  end if;

  perform set_config('app.bootstrap_context', 'true', true);
  insert into public.user_roles (user_id, role_id, granted_by, reason)
  values (caller_id, founder_role_id, caller_id, 'bootstrap_founder: authorized founder email')
  on conflict (user_id, role_id) do nothing;

  insert into public.audit_logs (actor_id, action, target_type, target_id, reason, metadata)
  values (caller_id, 'bootstrap_founder.granted', 'user_roles', caller_id::text, 'authorized founder email', jsonb_build_object('email', caller_email));

  return true;
end;
$$;

commit;
