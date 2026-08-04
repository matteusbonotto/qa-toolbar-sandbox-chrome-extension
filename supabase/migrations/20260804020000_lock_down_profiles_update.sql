-- SECURITY FIX: "user updates own profile" (20260717010000_bootstrap.sql:874) let any
-- authenticated user PATCH their own public.profiles row directly via PostgREST/supabase-js
-- (anon/publishable key + their own session), including trial_started_at/trial_ends_at.
-- activate_free_trial() (20260728010000_free_trial_release_manager.sql) blindly trusts
-- profiles.trial_ends_at to grant the paid "release-manager" plan and is re-invoked on every
-- sign-in, so a user could set trial_ends_at to a far-future date and keep indefinite free
-- paid access. No legitimate caller ever updates profiles as the row owner — handle_new_user()
-- (service_role, trigger) sets it once at signup, and neither apps/landing nor apps/admin issue
-- a client-side profiles update — so this policy had no real use and is simply removed instead
-- of narrowed.
drop policy if exists "user updates own profile" on public.profiles;
create policy "founder updates profiles" on public.profiles for update using (public.is_founder()) with check (public.is_founder());
