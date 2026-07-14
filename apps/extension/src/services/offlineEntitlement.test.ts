import { describe, expect, it } from "vitest";
import { verifyOfflineEntitlement } from "./offlineEntitlement";

const installationId = "c44e3a25-5214-41df-98cc-965da9ce7d31";
const publicJwk = `{"key_ops":["verify"],"ext":true,"alg":"PS256","kty":"RSA","n":"xmQSJSdhD9b-g49dTc4fN8AK9qTSbou1DEvYg3yRfgHDtcsgHyxdf5FGYpnvX9XmJm9aTjcvSSITNxeYCpvoU7Zpl0sQXbmUCe652G3PDCLzUuKKeevYF7ntBsFguOWyDDsRqYR_zFfdWIX7R3rK2TGp--qjE4Nt1tEJnqheq5-GJ4_PDq4OnLPTfvMKNGRecU-7NOZqn7e7Utz2KHEIWIYta25n2Jbd6gLTA5OvUCudcJcFQUI5e6zZAOjweRpPIH6abYtbo1ec16f1nzB0vTo1L7GzM_zCna7XSYkwp8vXd5luKEEWTb6VvR_TC-MwfhxsRueWsOOCqq-z09gLjw","e":"AQAB"}`;
const signedToken = "eyJhbGciOiJQUzI1NiIsInR5cCI6IlFUUy1PRkZMSU5FIn0.eyJ2ZXJzaW9uIjoxLCJzdWJqZWN0IjoiYjZhOTllNDEtZGQyMi00OGU1LWEzMzItYzE0ZDU3ZWI3NzU5IiwiaW5zdGFsbGF0aW9uSWQiOiJjNDRlM2EyNS01MjE0LTQxZGYtOThjYy05NjVkYTljZTdkMzEiLCJwbGFuIjp7ImtleSI6InBybyIsIm5hbWUiOiJQcm8ifSwiZmVhdHVyZXMiOnsicmVjb3JkaW5nLmVuYWJsZWQiOnRydWV9LCJmZWF0dXJlRmxhZ3MiOnt9LCJhY2Nlc3MiOnsiYWN0aXZlIjp0cnVlLCJzb3VyY2UiOiJzdHJpcGUiLCJleHBpcmVzQXQiOm51bGx9LCJpc3N1ZWRBdCI6MTgwMDAwMDAwMCwiZXhwaXJlc0F0IjoxODAwMDAwMDYwLCJncmFjZVVudGlsIjoxODAwMDAzNjAwfQ.InUIOPtdcZ5B2WcxHXffDMgO4R8rwzEJqJMWxjpt-omHPL6ccg_c2tVBBD2gEo7zfLFChUHQniLXgrHkIhjRokv9KcEOLXw6s5VlyAGZGP3pPJynQ3byTkuQ8zf_Qj-QYVMrw1ZMFNNFj9rAPBPNjHWmHRLpw4hw8hiCV51MVUnELmu2fNCRGfmIv1AzMHB9n_fYrSXwOMkEi3C7A-8_7Trx6xik4tYdYFDuT-EfK-cqWuvFxp4Th3n2ExHA1L9Hyzu_LsOJH7bZJ5oHs497MicwL8Rl_MYmvIv1nfc17dVbUKIhD11vYAJ66OEyUtaC_8cQBmvB5sGw7P4yaT1F9g";

describe("offline entitlement signature", () => {
  it("accepts a known valid installation-bound token", async () => {
    const verified = await verifyOfflineEntitlement(signedToken, installationId, 1_800_000_000_000, publicJwk);
    expect(verified?.access.active).toBe(true);
    expect(verified?.features["recording.enabled"]).toBe(true);
  });

  it("rejects payload tampering", async () => {
    const parts = signedToken.split(".");
    parts[1] = `${parts[1]![0] === "a" ? "b" : "a"}${parts[1]!.slice(1)}`;
    expect(await verifyOfflineEntitlement(parts.join("."), installationId, 1_800_000_000_000, publicJwk)).toBeNull();
  });

  it("rejects a token after its grace period", async () => {
    expect(await verifyOfflineEntitlement(signedToken, installationId, 1_800_003_601_000, publicJwk)).toBeNull();
  });
});
