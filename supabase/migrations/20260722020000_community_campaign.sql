-- Initial affiliate/community campaign. Public posts are reviewed manually; Chrome Web Store
-- reviews are deliberately excluded from rewarded objectives to avoid incentivized reviews.
create table if not exists public.engagement_campaign_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign_key text not null check (campaign_key ~ '^[a-z0-9-]{3,80}$'),
  social_post_url text not null check (char_length(social_post_url) between 10 and 2048),
  linkedin_post_url text not null check (char_length(linkedin_post_url) between 10 and 2048),
  product_feedback text not null check (char_length(product_feedback) between 40 and 4000),
  disclosure_confirmed boolean not null default false check (disclosure_confirmed),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  review_notes text,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  reward_grant_id uuid references public.entitlement_grants(id),
  unique (user_id, campaign_key)
);

create index if not exists idx_engagement_campaign_status on public.engagement_campaign_submissions(status, submitted_at);
alter table public.engagement_campaign_submissions enable row level security;
create policy "user reads own campaign submission" on public.engagement_campaign_submissions for select using (auth.uid() = user_id or public.is_founder());
create policy "user creates own campaign submission" on public.engagement_campaign_submissions for insert with check (auth.uid() = user_id and status = 'pending' and reward_grant_id is null);
create policy "user updates pending campaign submission" on public.engagement_campaign_submissions for update using (auth.uid() = user_id and status in ('pending','rejected') and reward_grant_id is null) with check (auth.uid() = user_id and status = 'pending' and reward_grant_id is null);
create policy "founder manages campaign submissions" on public.engagement_campaign_submissions for all using (public.is_founder()) with check (public.is_founder());

create or replace function public.review_engagement_campaign(submission_id_input uuid, approve boolean, notes text default null)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  submission public.engagement_campaign_submissions%rowtype;
  full_plan_id uuid;
  grant_id uuid;
begin
  if auth.role() <> 'service_role' and not public.is_founder() then raise exception 'forbidden'; end if;
  select * into submission from public.engagement_campaign_submissions where id = submission_id_input for update;
  if submission.id is null then raise exception 'campaign_submission_not_found'; end if;
  if submission.status = 'approved' then return submission.reward_grant_id; end if;
  if not approve then
    update public.engagement_campaign_submissions set status='rejected', review_notes=left(notes,1000), reviewed_at=now(), reviewed_by=auth.uid() where id=submission.id;
    return null;
  end if;
  select id into full_plan_id from public.plans where key='release-manager' and is_active;
  if full_plan_id is null then raise exception 'full_plan_missing'; end if;
  insert into public.entitlement_grants(user_id,plan_id,source,source_reference,expires_at)
  values(submission.user_id,full_plan_id,'manual','campaign:'||submission.id::text,now()+interval '30 days') returning id into grant_id;
  update public.engagement_campaign_submissions set status='approved',review_notes=left(notes,1000),reviewed_at=now(),reviewed_by=auth.uid(),reward_grant_id=grant_id where id=submission.id;
  insert into public.audit_logs(actor_id,action,target_type,target_id,reason,metadata) values(auth.uid(),'campaign.approved','engagement_campaign_submission',submission.id::text,'Initial community campaign',jsonb_build_object('rewardGrantId',grant_id,'days',30));
  return grant_id;
end;
$$;
revoke all on function public.review_engagement_campaign(uuid,boolean,text) from public,anon;
grant execute on function public.review_engagement_campaign(uuid,boolean,text) to authenticated,service_role;
