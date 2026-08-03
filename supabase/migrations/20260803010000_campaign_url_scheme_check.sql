begin;

-- engagement_campaign_submissions.social_post_url/linkedin_post_url are submitted by any
-- authenticated end user (RLS only checks auth.uid() = user_id, not URL shape) and are rendered
-- as an <a href> in the founder's review screen (apps/admin/src/pages/CampaignsPage.tsx). Without
-- this, a user could submit a javascript: URI that runs in the admin origin when the founder
-- clicks it, with access to the founder's Supabase session/MFA token. The frontend now also
-- refuses to render non-http(s) links, but the constraint is the real guarantee, per this repo's
-- existing pattern of trusting Postgres constraints over app-level checks.
alter table public.engagement_campaign_submissions
  add constraint engagement_campaign_submissions_social_post_url_scheme check (social_post_url ~* '^https?://'),
  add constraint engagement_campaign_submissions_linkedin_post_url_scheme check (linkedin_post_url ~* '^https?://');

commit;
