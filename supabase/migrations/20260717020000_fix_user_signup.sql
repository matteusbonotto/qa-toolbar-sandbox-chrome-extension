-- Keep hosted Auth signup independent from extension schemas in search_path.
-- The first version resolved pgcrypto.gen_random_bytes() at trigger runtime;
-- hosted projects keep that extension outside public, which made user creation
-- fail closed with "Database error creating new user".
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, trial_started_at, trial_ends_at, affiliate_code)
  values (new.id, now(), now() + interval '30 days', 'QTS-' || upper(substr(replace(new.id::text, '-', ''), 1, 8)))
  on conflict (id) do nothing;
  insert into public.referral_profiles (user_id, referral_code)
  select new.id, affiliate_code from public.profiles where id = new.id
  on conflict (user_id) do nothing;
  return new;
end;
$$;
