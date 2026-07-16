insert into public.plans (key, name, is_active)
values ('free', 'Free', true), ('pro', 'Pro', true)
on conflict (key) do nothing;

insert into public.features (key, value_type, description)
values
  ('projects.maximum', 'integer', 'Maximum number of local projects'),
  ('networkHistory.maximum', 'integer', 'Maximum local request records'),
  ('jsonDiff.enabled', 'boolean', 'JSON diff capability'),
  ('exportFull.enabled', 'boolean', 'Full export capability')
on conflict (key) do nothing;

insert into public.plan_features (plan_id, feature_id, value)
select p.id, f.id, defaults.value
from (values
  ('free', 'projects.maximum', '2'::jsonb),
  ('free', 'networkHistory.maximum', '200'::jsonb),
  ('free', 'jsonDiff.enabled', 'false'::jsonb),
  ('free', 'exportFull.enabled', 'false'::jsonb),
  ('pro', 'projects.maximum', '50'::jsonb),
  ('pro', 'networkHistory.maximum', '10000'::jsonb),
  ('pro', 'jsonDiff.enabled', 'true'::jsonb),
  ('pro', 'exportFull.enabled', 'true'::jsonb)
) as defaults(plan_key, feature_key, value)
join public.plans p on p.key = defaults.plan_key
join public.features f on f.key = defaults.feature_key
on conflict (plan_id, feature_id) do update set value = excluded.value;
