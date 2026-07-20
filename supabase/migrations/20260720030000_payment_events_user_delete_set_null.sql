-- LGPD account self-deletion (new account-delete edge function) calls
-- supabase.auth.admin.deleteUser(), which cascades through every FK referencing auth.users —
-- except payment_events.user_id, which has no ON DELETE clause (defaults to NO ACTION) and would
-- currently make deletion fail outright for any user with billing history. Financial/audit
-- records must be *kept* for fiscal/legal retention (LGPD Art. 16 permits this), just anonymized:
-- SET NULL instead of CASCADE, so the row survives with its provider_customer_id/amounts/dates
-- intact but no longer tied to the deleted person.
alter table public.payment_events drop constraint if exists payment_events_user_id_fkey;
alter table public.payment_events add constraint payment_events_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete set null;
