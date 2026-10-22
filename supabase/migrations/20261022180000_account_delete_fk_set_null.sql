begin;

-- LGPD self-service deletion (account-delete) failed for any user with history: these columns
-- reference auth.users without an ON DELETE rule, so deleteUser hit a foreign key violation AFTER the
-- Stripe subscription had already been cancelled (security audit 2026-10-22, M5). They only record
-- who did something; the history row stays and the actor becomes NULL. The constraint name is looked
-- up instead of assumed, so this works whatever name an older bootstrap gave it.
do $$
declare
  target record;
  constraint_name text;
begin
  for target in
    select * from (values
      ('audit_logs', 'actor_id'),
      ('vouchers', 'redeemed_by'),
      ('user_roles', 'granted_by'),
      ('engagement_campaign_submissions', 'reviewed_by'),
      ('legal_registration', 'updated_by')
    ) as t(table_name, column_name)
  loop
    select c.conname into constraint_name
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.contype = 'f'
      and c.conrelid = format('public.%I', target.table_name)::regclass
      and c.confrelid = 'auth.users'::regclass
      and a.attname = target.column_name;
    if constraint_name is not null then
      execute format('alter table public.%I drop constraint %I', target.table_name, constraint_name);
    end if;
    execute format(
      'alter table public.%I add constraint %I foreign key (%I) references auth.users(id) on delete set null',
      target.table_name, target.table_name || '_' || target.column_name || '_fkey', target.column_name
    );
  end loop;
end;
$$;

commit;
