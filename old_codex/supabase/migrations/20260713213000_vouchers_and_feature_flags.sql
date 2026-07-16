alter table public.entitlement_grants drop constraint if exists entitlement_grants_source_check;
alter table public.entitlement_grants add constraint entitlement_grants_source_check
  check (source in ('subscription', 'license', 'founder', 'manual', 'trial', 'voucher'));

create table public.vouchers (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique check (code_hash ~ '^[a-f0-9]{64}$'),
  label text not null check (char_length(label) between 3 and 100),
  plan_id uuid not null references public.plans(id) on delete restrict,
  grant_days integer check (grant_days between 1 and 3650),
  status text not null default 'available' check (status in ('available', 'used', 'disabled')),
  expires_at timestamptz,
  redeemed_by uuid references auth.users(id) on delete set null,
  redeemed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'used') = (redeemed_at is not null)),
  check ((redeemed_at is null) = (redeemed_by is null))
);

create table public.feature_flags (
  key text primary key check (key ~ '^[a-z][a-zA-Z0-9._-]+$'),
  enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  description text not null default '',
  updated_at timestamptz not null default now()
);

create or replace function public.prepare_voucher_status()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = 'available' then
    new.redeemed_by := null;
    new.redeemed_at := null;
  end if;
  return new;
end $$;

create trigger vouchers_prepare_status before update on public.vouchers
for each row execute function public.prepare_voucher_status();
create trigger vouchers_set_updated_at before update on public.vouchers
for each row execute function public.set_updated_at();
create trigger feature_flags_set_updated_at before update on public.feature_flags
for each row execute function public.set_updated_at();

alter table public.vouchers enable row level security;
alter table public.vouchers force row level security;
alter table public.feature_flags enable row level security;
alter table public.feature_flags force row level security;
revoke all on public.vouchers, public.feature_flags from anon, authenticated;
revoke all on function public.prepare_voucher_status() from public,anon,authenticated;

insert into public.feature_flags (key, enabled, description) values
  ('themes.enabled', true, 'Permite escolher cor e modo visual'),
  ('onboarding.wizard.enabled', true, 'Ativa o onboarding guiado'),
  ('inspectors.enabled', true, 'Chave global dos inspectors'),
  ('recording.enabled', true, 'Chave global de gravação'),
  ('annotations.enabled', true, 'Chave global de anotações'),
  ('httpControls.enabled', true, 'Chave global dos controles HTTP')
on conflict (key) do update set description = excluded.description;

create or replace function public.provision_voucher(
  voucher_hash text,
  voucher_label text,
  voucher_grant_days integer,
  voucher_expires_at timestamptz default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare voucher_id uuid; scale_plan_id uuid;
begin
  if voucher_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid voucher hash'; end if;
  select id into scale_plan_id from public.plans where key = 'scale';
  insert into public.vouchers(code_hash,label,plan_id,grant_days,expires_at)
  values(voucher_hash,voucher_label,scale_plan_id,voucher_grant_days,voucher_expires_at)
  on conflict(code_hash) do update set label=excluded.label,grant_days=excluded.grant_days,expires_at=excluded.expires_at
  returning id into voucher_id;
  return voucher_id;
end $$;
revoke all on function public.provision_voucher(text,text,integer,timestamptz) from public,anon,authenticated;
grant execute on function public.provision_voucher(text,text,integer,timestamptz) to service_role;

create or replace function public.redeem_voucher(target_user_id uuid, voucher_hash text)
returns table(label text, access_expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare selected public.vouchers%rowtype; ending timestamptz;
begin
  select * into selected from public.vouchers
  where code_hash=voucher_hash and status='available' and (expires_at is null or expires_at > now())
  for update skip locked;
  if selected.id is null then raise exception 'voucher_unavailable'; end if;
  ending := case when selected.grant_days is null then null else now() + make_interval(days => selected.grant_days) end;
  update public.vouchers set status='used',redeemed_by=target_user_id,redeemed_at=now() where id=selected.id;
  insert into public.entitlement_grants(user_id,plan_id,source,starts_at,expires_at)
  values(target_user_id,selected.plan_id,'voucher',now(),ending);
  insert into public.audit_logs(actor_id,action,target_type,target_id,reason,metadata)
  values(target_user_id,'voucher.redeemed','voucher',selected.id::text,'Self-service voucher redemption',jsonb_build_object('label',selected.label));
  return query select selected.label, ending;
end $$;
revoke all on function public.redeem_voucher(uuid,text) from public,anon,authenticated;
grant execute on function public.redeem_voucher(uuid,text) to service_role;

create or replace function public.reset_voucher(voucher_hash text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.vouchers set status='available',redeemed_by=null,redeemed_at=null where code_hash=voucher_hash;
  return found;
end $$;
revoke all on function public.reset_voucher(text) from public,anon,authenticated;
grant execute on function public.reset_voucher(text) to service_role;
