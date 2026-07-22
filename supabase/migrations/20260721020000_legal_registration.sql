-- Single-row (id is always `true`, same pattern as store_listing_status) tracker for the
-- QA Toolbar Sandbox INPI "Registro de Programa de Computador" process. The founder updates it
-- via the admin panel as the real-world process advances; nothing here is automated or inferred,
-- and the LP/extension only ever render what's actually stored -- never a claim ahead of reality.
create table if not exists public.legal_registration (
  id boolean primary key default true check (id),
  status text not null default 'preparation'
    check (status in ('preparation', 'payment_pending', 'protocolled', 'registered')),
  software_name text not null default 'QA Toolbar Sandbox',
  holder_name text not null default 'Matheus Alves Bonotto Santos',
  protocol_number text,
  protocol_date date,
  registration_number text,
  grant_date date,
  public_query_url text,
  public_notice text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  constraint legal_registration_protocolled_fields check (
    status <> 'protocolled' or (protocol_number is not null and protocol_date is not null)
  ),
  constraint legal_registration_registered_fields check (
    status <> 'registered' or (registration_number is not null and grant_date is not null)
  )
);
insert into public.legal_registration (id) values (true) on conflict (id) do nothing;

alter table public.legal_registration enable row level security;
-- Public read: this is exactly the information meant to be shown on the LP/extension. No
-- sensitive fields (CPF, GRU number, bank details, signed documents) live in this table at all,
-- so there is no separate "safe view" to maintain -- the whole row is safe by construction.
create policy "legal_registration is publicly readable" on public.legal_registration for select using (true);
create policy "founder manages legal_registration" on public.legal_registration for all
  using (public.is_founder()) with check (public.is_founder());

-- Reuses the existing audit_founder_table_mutation() trigger (same one store_listing_status
-- already has) so every status/protocol/registration change is logged to audit_logs for free,
-- instead of a bespoke history table.
drop trigger if exists trg_audit_founder_mutation on public.legal_registration;
create trigger trg_audit_founder_mutation after insert or update or delete on public.legal_registration
  for each row execute function public.audit_founder_table_mutation();
