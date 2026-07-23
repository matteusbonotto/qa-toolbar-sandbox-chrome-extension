alter table public.referral_profiles add column if not exists enabled boolean not null default true, add column if not exists internal_notes text;

create or replace function public.register_referral(target_user_id uuid, referral_code_input text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare referrer_id uuid;
begin
  select user_id into referrer_id from public.referral_profiles where referral_code=upper(trim(referral_code_input)) and enabled;
  if referrer_id is null or referrer_id=target_user_id then return false; end if;
  if exists(select 1 from public.referrals where referred_user_id=target_user_id) then return false; end if;
  insert into public.referrals(referrer_user_id,referred_user_id,status) values(referrer_id,target_user_id,'pending');
  insert into public.audit_logs(actor_id,action,target_type,target_id,reason) values(target_user_id,'referral.registered','referral',referrer_id::text,'Self-service referral registration');
  return true;
end; $$;

create or replace function public.manage_affiliate_profile(target_user_id uuid, is_enabled boolean, notes text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.role()<>'service_role' and not public.is_founder() then raise exception 'forbidden'; end if;
  update public.referral_profiles set enabled=is_enabled,internal_notes=nullif(left(trim(notes),1000),''),updated_at=now() where user_id=target_user_id;
  if not found then raise exception 'affiliate_not_found'; end if;
  insert into public.audit_logs(actor_id,action,target_type,target_id,reason,metadata) values(auth.uid(),case when is_enabled then 'affiliate.enabled' else 'affiliate.disabled' end,'referral_profile',target_user_id::text,nullif(left(trim(notes),1000),''),jsonb_build_object('enabled',is_enabled));
end; $$;
revoke all on function public.manage_affiliate_profile(uuid,boolean,text) from public,anon;
grant execute on function public.manage_affiliate_profile(uuid,boolean,text) to authenticated,service_role;
