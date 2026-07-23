-- Gravador de Passos is included from the entry Smoke Test plan upward.
insert into public.features (key, value_type, description) values
  ('stepsRecorder.enabled', 'boolean', 'Gravador de Passos: numbered/Gherkin behavior capture and CSV export')
on conflict (key) do update set
  value_type = excluded.value_type,
  description = excluded.description;

insert into public.plan_features (plan_id, feature_id, value)
select p.id, f.id, v.enabled::jsonb
from (values
  ('smoke-test', 'true'),
  ('regression-runner', 'true'),
  ('root-cause-analyst', 'true'),
  ('release-manager', 'true')
) as v(plan_key, enabled)
join public.plans p on p.key = v.plan_key
join public.features f on f.key = 'stepsRecorder.enabled'
on conflict (plan_id, feature_id) do update set value = excluded.value;
