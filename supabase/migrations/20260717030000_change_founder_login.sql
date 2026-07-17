begin;

-- A founder allowlist change must also remove any previously granted founder
-- role. Otherwise changing only bootstrap_founder() would leave old accounts
-- authorized indefinitely.
with revoked as (
  delete from public.user_roles ur
  using public.roles r, auth.users u
  where ur.role_id = r.id
    and ur.user_id = u.id
    and r.key = 'founder'
    and lower(coalesce(u.email, '')) <> 'matteusbonotto+admin@gmail.com'
  returning ur.user_id
)
insert into public.audit_logs (actor_id, action, target_type, target_id, reason)
select null, 'founder.role_revoked', 'user_roles', user_id::text, 'founder allowlist changed'
from revoked;

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

  if lower(coalesce(caller_email, '')) <> 'matteusbonotto+admin@gmail.com'
    or coalesce(caller_confirmed, false) = false then
    insert into public.audit_logs (actor_id, action, target_type, target_id, reason, metadata)
    values (caller_id, 'bootstrap_founder.denied', 'user_roles', caller_id::text,
      'email not authorized or unverified', jsonb_build_object('email', caller_email));
    return false;
  end if;

  select id into founder_role_id from public.roles where key = 'founder';
  if founder_role_id is null then
    insert into public.roles (key, description, is_system)
    values ('founder', 'Founder — full administrative access', true)
    returning id into founder_role_id;
  end if;

  perform set_config('app.bootstrap_context', 'true', true);
  insert into public.user_roles (user_id, role_id, granted_by, reason)
  values (caller_id, founder_role_id, caller_id, 'bootstrap_founder: authorized founder email')
  on conflict (user_id, role_id) do nothing;

  insert into public.audit_logs (actor_id, action, target_type, target_id, reason, metadata)
  values (caller_id, 'bootstrap_founder.granted', 'user_roles', caller_id::text,
    'authorized founder email', jsonb_build_object('email', caller_email));

  return true;
end;
$$;

commit;
