begin;

-- "Limpar cache e cookies do site": clears the tested site's cache/cookies/storage (scoped to
-- that origin only, via chrome.browsingData.remove) without touching the extension's own
-- chrome.storage.local data (accounts, macros, workspace, settings). Basic QA housekeeping, same
-- tier as Gravador de Passos: available from the entry Smoke Test plan upward.
insert into public.features (key, value_type, description) values
  ('clearSiteData.enabled', 'boolean', 'Limpar cache e cookies do site: clears the tested site''s cache/cookies/storage, scoped to that origin only')
on conflict (key) do nothing;

insert into public.plan_features (plan_id, feature_id, value)
select p.id, f.id, v.value::jsonb
from (values
  ('smoke-test', 'clearSiteData.enabled', 'true'),
  ('regression-runner', 'clearSiteData.enabled', 'true'),
  ('root-cause-analyst', 'clearSiteData.enabled', 'true'),
  ('release-manager', 'clearSiteData.enabled', 'true')
) as v(plan_key, feature_key, value)
join public.plans p on p.key = v.plan_key
join public.features f on f.key = v.feature_key
on conflict (plan_id, feature_id) do update set value = excluded.value;

commit;
