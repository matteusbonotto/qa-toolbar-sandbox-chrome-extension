-- Auditable review and a strictly one-time community reward per user.
alter table public.engagement_campaign_submissions
  add column if not exists review_criteria jsonb not null default '{}'::jsonb,
  add column if not exists resubmission_count integer not null default 0 check (resubmission_count >= 0);

create unique index if not exists idx_engagement_campaign_one_reward_per_user
  on public.engagement_campaign_submissions(user_id) where reward_grant_id is not null;

drop function if exists public.review_engagement_campaign(uuid,boolean,text);

create or replace function public.review_engagement_campaign(
  submission_id_input uuid, approve boolean, notes text default null, criteria jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare submission public.engagement_campaign_submissions%rowtype; full_plan_id uuid; grant_id uuid; all_met boolean;
begin
  if auth.role() <> 'service_role' and not public.is_founder() then raise exception 'forbidden'; end if;
  select * into submission from public.engagement_campaign_submissions where id=submission_id_input for update;
  if submission.id is null then raise exception 'campaign_submission_not_found'; end if;
  if submission.status='approved' then return submission.reward_grant_id; end if;
  all_met := coalesce((criteria->>'socialPostPublic')::boolean,false)
    and coalesce((criteria->>'socialPostDescribesUse')::boolean,false)
    and coalesce((criteria->>'linkedinPostPublic')::boolean,false)
    and coalesce((criteria->>'linkedinPostDescribesUse')::boolean,false)
    and coalesce((criteria->>'campaignDisclosureVisible')::boolean,false)
    and coalesce((criteria->>'productFeedbackUseful')::boolean,false)
    and coalesce((criteria->>'identityConsistent')::boolean,false);
  if approve and not all_met then raise exception 'campaign_requirements_incomplete'; end if;
  if approve and exists(select 1 from public.engagement_campaign_submissions where user_id=submission.user_id and reward_grant_id is not null and id<>submission.id) then
    raise exception 'campaign_reward_already_claimed';
  end if;
  if not approve then
    if nullif(trim(notes),'') is null then raise exception 'campaign_review_notes_required'; end if;
    update public.engagement_campaign_submissions set status='rejected',review_notes=left(trim(notes),1000),review_criteria=criteria,reviewed_at=now(),reviewed_by=auth.uid() where id=submission.id;
    insert into public.audit_logs(actor_id,action,target_type,target_id,reason,metadata) values(auth.uid(),'campaign.changes_requested','engagement_campaign_submission',submission.id::text,left(trim(notes),1000),jsonb_build_object('criteria',criteria));
    return null;
  end if;
  select id into full_plan_id from public.plans where key='release-manager' and is_active;
  if full_plan_id is null then raise exception 'full_plan_missing'; end if;
  insert into public.entitlement_grants(user_id,plan_id,source,source_reference,expires_at) values(submission.user_id,full_plan_id,'manual','campaign:'||submission.id::text,now()+interval '30 days') returning id into grant_id;
  update public.engagement_campaign_submissions set status='approved',review_notes=coalesce(nullif(left(trim(notes),1000),''),'Todos os requisitos foram comprovados.'),review_criteria=criteria,reviewed_at=now(),reviewed_by=auth.uid(),reward_grant_id=grant_id where id=submission.id;
  insert into public.audit_logs(actor_id,action,target_type,target_id,reason,metadata) values(auth.uid(),'campaign.approved','engagement_campaign_submission',submission.id::text,'Initial community campaign',jsonb_build_object('rewardGrantId',grant_id,'days',30,'criteria',criteria));
  return grant_id;
end; $$;

revoke all on function public.review_engagement_campaign(uuid,boolean,text,jsonb) from public,anon;
grant execute on function public.review_engagement_campaign(uuid,boolean,text,jsonb) to authenticated,service_role;
