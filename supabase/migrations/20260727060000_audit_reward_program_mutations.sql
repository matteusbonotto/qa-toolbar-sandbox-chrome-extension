-- reward_programs/reward_prizes are edited directly by the founder through PostgREST
-- (pause the wheel, change prize weights/limits, adjust probability) exactly like
-- plans/feature_flags/vouchers, which already carry trg_audit_founder_mutation. These two
-- tables were created after that trigger loop ran and were never added to it, so a
-- payout-affecting change (e.g. pausing the wheel or reweighting a prize) leaves no trace
-- in audit_logs, contradicting the "every founder mutation is audited" invariant.
-- Idempotent: safe to re-run (drop-then-create per table, same pattern as the original loop).
do $$
declare table_name text;
begin
  foreach table_name in array array['reward_programs','reward_prizes'] loop
    execute format('drop trigger if exists trg_audit_founder_mutation on public.%I', table_name);
    execute format('create trigger trg_audit_founder_mutation after insert or update or delete on public.%I for each row execute function public.audit_founder_table_mutation()', table_name);
  end loop;
end;
$$;
