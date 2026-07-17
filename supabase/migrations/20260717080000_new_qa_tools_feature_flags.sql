-- New QA productivity kit / Macro Studio / Key View tools shipped in v1.1.0-v1.1.2 were never
-- registered in the feature/plan_features matrix, so they were available to any active plan
-- regardless of tier. This adds real feature keys and a tiered distribution matching the LP.
insert into public.features (key, value_type, description) values
  ('characterCounter.enabled', 'boolean', 'Character/word/line/byte counter tool'),
  ('multiClick.enabled', 'boolean', 'Multiclick tool with visual selection and limits'),
  ('inputLab.enabled', 'boolean', 'Input Lab: tests input classes without submitting the form'),
  ('fakerFill.enabled', 'boolean', 'Faker Fill: local synthetic data autofill'),
  ('macroStudio.enabled', 'boolean', 'Macro Studio: record/replay, Vibe Code, Playwright export'),
  ('keyView.enabled', 'boolean', 'Key View: on-screen keystroke/typing/mouse visualizer')
on conflict (key) do nothing;

insert into public.plan_features (plan_id, feature_id, value)
select p.id, f.id, v.value::jsonb
from (values
  ('smoke-test', 'characterCounter.enabled', 'true'),
  ('smoke-test', 'multiClick.enabled', 'true'),
  ('smoke-test', 'inputLab.enabled', 'false'),
  ('smoke-test', 'fakerFill.enabled', 'false'),
  ('smoke-test', 'macroStudio.enabled', 'false'),
  ('smoke-test', 'keyView.enabled', 'false'),

  ('regression-runner', 'characterCounter.enabled', 'true'),
  ('regression-runner', 'multiClick.enabled', 'true'),
  ('regression-runner', 'inputLab.enabled', 'true'),
  ('regression-runner', 'fakerFill.enabled', 'true'),
  ('regression-runner', 'macroStudio.enabled', 'false'),
  ('regression-runner', 'keyView.enabled', 'false'),

  ('root-cause-analyst', 'characterCounter.enabled', 'true'),
  ('root-cause-analyst', 'multiClick.enabled', 'true'),
  ('root-cause-analyst', 'inputLab.enabled', 'true'),
  ('root-cause-analyst', 'fakerFill.enabled', 'true'),
  ('root-cause-analyst', 'macroStudio.enabled', 'true'),
  ('root-cause-analyst', 'keyView.enabled', 'false'),

  ('release-manager', 'characterCounter.enabled', 'true'),
  ('release-manager', 'multiClick.enabled', 'true'),
  ('release-manager', 'inputLab.enabled', 'true'),
  ('release-manager', 'fakerFill.enabled', 'true'),
  ('release-manager', 'macroStudio.enabled', 'true'),
  ('release-manager', 'keyView.enabled', 'true')
) as v(plan_key, feature_key, value)
join public.plans p on p.key = v.plan_key
join public.features f on f.key = v.feature_key
on conflict (plan_id, feature_id) do update set value = excluded.value;
