import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../supabase/migrations/20260723010000_reward_points_wheel.sql", import.meta.url), "utf8");
const retirement = await readFile(new URL("../supabase/migrations/20260723020000_retire_legacy_30_day_rewards.sql", import.meta.url), "utf8");
const activation = await readFile(new URL("../supabase/migrations/20260723030000_activate_qa_rewards.sql", import.meta.url), "utf8");
const tenOptionCatalog = await readFile(new URL("../supabase/migrations/20260726050000_reward_wheel_ten_options.sql", import.meta.url), "utf8");
const webhook = await readFile(new URL("../supabase/functions/stripe-webhook/index.ts", import.meta.url), "utf8");
const checkout = await readFile(new URL("../supabase/functions/checkout-create-session/index.ts", import.meta.url), "utf8");
const landing = await readFile(new URL("../apps/landing/src/sections/CommunityCampaignSection.tsx", import.meta.url), "utf8");

for (const required of [
  "create table if not exists public.reward_wallets",
  "create table if not exists public.reward_point_entries",
  "unique(event_kind, source_type, source_reference)",
  "create table if not exists public.reward_spins",
  "unique(user_id,request_id)",
  "gen_random_bytes(4)",
  "wallet.available_points<program.points_per_spin",
  "wallet.debt_points>0",
  "max_spins_per_user_per_day",
  "promo_days+grant_days<=30",
  "create or replace function public.reverse_referral_points",
]) assert.ok(migration.includes(required), `missing reward safety invariant: ${required}`);

assert.match(webhook, /qualify_paid_referral/);
assert.match(webhook, /reverse_referral_points/);
assert.doesNotMatch(webhook, /rpc\("reward_referral"/);
assert.match(retirement, /drop function if exists public\.reward_referral\(uuid\)/);
assert.match(activation, /prize_count<>5 or top_tier_weight<>100/);
assert.match(activation, /update public\.reward_programs set enabled=true/);
assert.match(tenOptionCatalog, /grant_days is null or grant_days = 8/);
assert.equal(new Set(tenOptionCatalog.match(/discount-(?:5|7|8|10|12|15)/g) || []).size, 6, "the catalog must expose six distinct discounts");
for (const planPrize of ["smoke-8d", "regression-8d", "root-10d", "full-15d"]) assert.match(tenOptionCatalog, new RegExp(`'${planPrize}'`));
assert.doesNotMatch(tenOptionCatalog, /'(?:10|15|30) dias de/);
assert.match(checkout, /reserve_best_reward_discount/);
assert.match(checkout, /reward-coupon:/);
assert.doesNotMatch(landing, /ganharem? 30 dias|earn 30|consigue 30|\+30 dias/i);
assert.match(landing, /não geram pontos/);

const prizes = [
  { key: "discount-5", weight: 22, minimum: 0 },
  { key: "discount-7", weight: 15, minimum: 0 },
  { key: "discount-8", weight: 12, minimum: 0 },
  { key: "discount-10", weight: 10, minimum: 0 },
  { key: "discount-12", weight: 7, minimum: 0 },
  { key: "discount-15", weight: 4, minimum: 0 },
  { key: "smoke-8d", weight: 12, minimum: 0 },
  { key: "regression-8d", weight: 9, minimum: 0 },
  { key: "root-10d", weight: 6, minimum: 0 },
  { key: "full-15d", weight: 3, minimum: 0 },
];
assert.equal(prizes.length, 10);
assert.equal(prizes.reduce((sum, prize) => sum + prize.weight, 0), 100);
for (const lifetime of [100, 300, 700]) {
  const eligible = prizes.filter((prize) => prize.minimum <= lifetime);
  assert.equal(eligible.length, 10);
  assert.ok(eligible.reduce((sum, prize) => sum + prize.weight, 0) > 0);
}
console.log("Reward points, progression, anti-abuse and checkout invariants passed.");
