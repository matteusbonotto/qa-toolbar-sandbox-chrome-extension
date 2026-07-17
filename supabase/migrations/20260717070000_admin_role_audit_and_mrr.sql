begin;

insert into public.roles (key, description, is_system) values
  ('admin', 'Admin — operational role managed by the founder', true)
on conflict (key) do update set description = excluded.description, is_system = excluded.is_system;

create or replace function public.audit_founder_table_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  payload jsonb;
  target text;
begin
  if auth.uid() is null or not public.is_founder() then
    return coalesce(new, old);
  end if;
  payload := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  target := coalesce(payload->>'id', payload->>'user_id', payload->>'key', payload->>'plan_id');
  insert into public.audit_logs (actor_id, action, target_type, target_id, reason, metadata)
  values (auth.uid(), 'admin.' || tg_table_name || '.' || lower(tg_op), tg_table_name, target,
    nullif(payload->>'reason', ''), jsonb_build_object('operation', lower(tg_op)));
  return coalesce(new, old);
end;
$$;
revoke all on function public.audit_founder_table_mutation() from public, anon, authenticated;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'plans','features','plan_features','stripe_prices','subscriptions','checkout_sessions',
    'vouchers','voucher_campaigns','entitlement_grants','entitlement_overrides',
    'license_keys','license_activations','user_roles','app_versions','system_notices','feature_flags'
  ] loop
    execute format('drop trigger if exists trg_audit_founder_mutation on public.%I', table_name);
    execute format('create trigger trg_audit_founder_mutation after insert or update or delete on public.%I for each row execute function public.audit_founder_table_mutation()', table_name);
  end loop;
end;
$$;

commit;
