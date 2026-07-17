begin;

create or replace function public.admin_list_users()
returns table (id uuid, email text, display_name text, trial_ends_at timestamptz, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_founder() then
    raise exception 'forbidden';
  end if;
  return query
    select u.id, u.email::text, p.display_name, p.trial_ends_at, p.created_at
    from auth.users u
    join public.profiles p on p.id = u.id
    order by p.created_at desc;
end;
$$;

commit;
