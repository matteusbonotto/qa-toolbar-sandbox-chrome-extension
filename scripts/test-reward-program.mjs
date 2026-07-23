import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../supabase/migrations/20260723010000_reward_points_wheel.sql", import.meta.url), "utf8");
const retirement = await readFile(new URL("../supabase/migrations/20260723020000_retire_legacy_30_day_rewards.sql", import.meta.url), "utf8");
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
assert.match(checkout, /reserve_best_reward_discount/);
assert.match(checkout, /reward-coupon:/);
assert.doesNotMatch(landing, /ganharem? 30 dias|earn 30|consigue 30|\+30 dias/i);
assert.match(landing, /não geram pontos/);

const prizes = [
  { key: "discount-5", weight: 45, minimum: 0 },
  { key: "discount-10", weight: 25, minimum: 300 },
  { key: "discount-15", weight: 10, minimum: 700 },
  { key: "root-10d", weight: 15, minimum: 100 },
  { key: "full-15d", weight: 5, minimum: 700 },
];
for (const lifetime of [100, 300, 700]) {
  const eligible = prizes.filter((prize) => prize.minimum <= lifetime);
  assert.ok(eligible.length >= 2);
  assert.ok(eligible.reduce((sum, prize) => sum + prize.weight, 0) > 0);
  if (lifetime < 700) assert.ok(!eligible.some((prize) => prize.key === "full-15d"));
}
console.log("Reward points, progression, anti-abuse and checkout invariants passed.");
