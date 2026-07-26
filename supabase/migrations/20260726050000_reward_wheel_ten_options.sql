-- Founder rule: the wheel exposes exactly ten prizes. Every plan prize grants exactly eight days.
-- Existing historical benefits remain valid; only the current prize catalog is normalized.

alter table public.reward_prizes drop constraint if exists reward_prizes_discount_percent_check;
alter table public.reward_prizes add constraint reward_prizes_discount_percent_check
  check (discount_percent is null or discount_percent between 5 and 15);

alter table public.reward_prizes drop constraint if exists reward_prizes_grant_days_check;
alter table public.reward_prizes add constraint reward_prizes_grant_days_check
  check (grant_days is null or grant_days = 8) not valid;

alter table public.reward_benefits drop constraint if exists reward_benefits_discount_percent_check;
alter table public.reward_benefits add constraint reward_benefits_discount_percent_check
  check (discount_percent is null or discount_percent between 5 and 15);

alter table public.reward_benefits drop constraint if exists reward_benefits_grant_days_check;
alter table public.reward_benefits add constraint reward_benefits_grant_days_check
  check (grant_days is null or grant_days in (8, 10, 15));

with program as (
  select id from public.reward_programs where key = 'qa-rewards-2026'
), plan_ids as (
  select key, id from public.plans
  where key in ('smoke-test', 'regression-runner', 'root-cause-analyst', 'release-manager')
), prizes(key, pt, es, en, kind, discount, plan_key, days, weight, ord) as (
  values
    ('discount-5',  '5% na próxima cobrança',  '5% en el próximo cobro',  '5% off the next charge',  'discount_percent', 5,  null::text, null::integer, 22, 1),
    ('discount-7',  '7% na próxima cobrança',  '7% en el próximo cobro',  '7% off the next charge',  'discount_percent', 7,  null, null, 15, 2),
    ('discount-8',  '8% na próxima cobrança',  '8% en el próximo cobro',  '8% off the next charge',  'discount_percent', 8,  null, null, 12, 3),
    ('discount-10', '10% na próxima cobrança', '10% en el próximo cobro', '10% off the next charge', 'discount_percent', 10, null, null, 10, 4),
    ('discount-12', '12% na próxima cobrança', '12% en el próximo cobro', '12% off the next charge', 'discount_percent', 12, null, null, 7,  5),
    ('discount-15', '15% na próxima cobrança', '15% en el próximo cobro', '15% off the next charge', 'discount_percent', 15, null, null, 4,  6),
    ('smoke-8d',    '8 dias de Smoke Test', '8 días de Smoke Test', '8 days of Smoke Test', 'plan_days', null, 'smoke-test', 8, 12, 7),
    ('regression-8d','8 dias de Regression Runner', '8 días de Regression Runner', '8 days of Regression Runner', 'plan_days', null, 'regression-runner', 8, 9, 8),
    ('root-10d',    '8 dias de Root Cause Analyst', '8 días de Root Cause Analyst', '8 days of Root Cause Analyst', 'plan_days', null, 'root-cause-analyst', 8, 6, 9),
    ('full-15d',    '8 dias de Release Manager', '8 días de Release Manager', '8 days of Release Manager', 'plan_days', null, 'release-manager', 8, 3, 10)
)
insert into public.reward_prizes(
  program_id, key, label_pt, label_es, label_en, kind, discount_percent,
  plan_id, grant_days, weight, minimum_lifetime_points, display_order, enabled, updated_at
)
select program.id, prizes.key, prizes.pt, prizes.es, prizes.en, prizes.kind, prizes.discount,
  plan_ids.id, prizes.days, prizes.weight, 0, prizes.ord, true, now()
from program
cross join prizes
left join plan_ids on plan_ids.key = prizes.plan_key
on conflict (program_id, key) do update set
  label_pt = excluded.label_pt,
  label_es = excluded.label_es,
  label_en = excluded.label_en,
  kind = excluded.kind,
  discount_percent = excluded.discount_percent,
  plan_id = excluded.plan_id,
  grant_days = excluded.grant_days,
  weight = excluded.weight,
  minimum_lifetime_points = 0,
  display_order = excluded.display_order,
  enabled = true,
  updated_at = now();

update public.reward_prizes
set enabled = false, updated_at = now()
where program_id = (select id from public.reward_programs where key = 'qa-rewards-2026')
  and key not in (
    'discount-5', 'discount-7', 'discount-8', 'discount-10', 'discount-12', 'discount-15',
    'smoke-8d', 'regression-8d', 'root-10d', 'full-15d'
  );

alter table public.reward_prizes validate constraint reward_prizes_grant_days_check;
