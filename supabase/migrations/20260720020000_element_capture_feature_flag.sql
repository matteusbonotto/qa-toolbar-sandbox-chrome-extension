-- New "Capturar Elementos" tool (exports a CSV of every interactive element on the page —
-- CSS selector, XPath, tag/type/name — for the automation team). Gated at the same tier as
-- Macro Studio: off for Smoke Test/Regression Runner, on for Root Cause Analyst/Release Manager.
insert into public.features (key, value_type, description) values
  ('elementCapture.enabled', 'boolean', 'Capturar Elementos: exports a CSV of interactive elements with CSS selector/XPath for automation')
on conflict (key) do nothing;

insert into public.plan_features (plan_id, feature_id, value)
select p.id, f.id, v.value::jsonb
from (values
  ('smoke-test', 'elementCapture.enabled', 'false'),
  ('regression-runner', 'elementCapture.enabled', 'false'),
  ('root-cause-analyst', 'elementCapture.enabled', 'true'),
  ('release-manager', 'elementCapture.enabled', 'true')
) as v(plan_key, feature_key, value)
join public.plans p on p.key = v.plan_key
join public.features f on f.key = v.feature_key
on conflict (plan_id, feature_id) do update set value = excluded.value;
