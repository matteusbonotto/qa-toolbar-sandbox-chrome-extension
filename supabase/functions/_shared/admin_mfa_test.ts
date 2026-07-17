import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  authenticationMethodTimestamp,
  isRecentAuthentication,
  secureAdminToken,
  sha256Hex,
} from "./admin_mfa.ts";

Deno.test("authentication method extraction is fail-closed", () => {
  assertEquals(authenticationMethodTimestamp({}, "password"), null);
  assertEquals(authenticationMethodTimestamp({ amr: [{ method: "otp", timestamp: 12 }] }, "password"), null);
  assertEquals(authenticationMethodTimestamp({ amr: [null, { method: "password", timestamp: 10 }, { method: "password", timestamp: 20 }] }, "password"), 20);
});

Deno.test("recent authentication rejects stale and future timestamps", () => {
  const now = 1_000_000;
  assert(isRecentAuthentication(999, 300, now));
  assert(!isRecentAuthentication(600, 300, now));
  assert(!isRecentAuthentication(1_100, 300, now));
});

Deno.test("admin bearer proof is random-looking and stored as a hash", () => {
  const first = secureAdminToken();
  const second = secureAdminToken();
  assert(/^[A-Za-z0-9_-]{43}$/.test(first));
  assert(first !== second);
  assert(/^[a-f0-9]{64}$/.test(sha256Hex(first)));
});
