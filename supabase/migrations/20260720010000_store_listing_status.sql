-- Tracks whether the Chrome Web Store listing is caught up with the latest extension package,
-- so the LP can show a "pending Google review" notice instead of silently implying the Store
-- listing is current. Single-row table (id is always `true`) — the founder updates it by hand
-- via the Supabase dashboard's Table Editor whenever they check the real Chrome Web Store
-- Developer Dashboard; nothing here is automated, since that would need new CI secrets with
-- write access to this project, which is out of scope for this change.
create table if not exists public.store_listing_status (
  id boolean primary key default true check (id),
  chrome_web_store_version text,
  status text not null default 'pending_review' check (status in ('pending_review', 'live', 'rejected')),
  updated_at timestamptz not null default now()
);
insert into public.store_listing_status (id) values (true) on conflict (id) do nothing;

alter table public.store_listing_status enable row level security;
create policy "store_listing_status is publicly readable" on public.store_listing_status for select using (true);
create policy "founder manages store_listing_status" on public.store_listing_status for all using (public.is_founder()) with check (public.is_founder());

drop trigger if exists trg_audit_founder_mutation on public.store_listing_status;
create trigger trg_audit_founder_mutation after insert or update or delete on public.store_listing_status for each row execute function public.audit_founder_table_mutation();
