import { describe, expect, it } from "vitest";
import {
  ACCESS_CHANGED_STORAGE_KEY,
  PENDING_INTENT_STORAGE_KEY,
  PENDING_INTENT_TTL_MS,
  attachEmailToPendingIntent,
  claimPendingIntent,
  clearPendingIntent,
  clearPendingIntentIfOwned,
  detectAuthRedirect,
  loadPendingIntent,
  notifyAccessChanged,
  savePendingIntent,
} from "./pendingPlanIntent";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
}

function throwingStorage() {
  return {
    getItem: () => { throw new Error("SecurityError"); },
    setItem: () => { throw new Error("QuotaExceededError"); },
    removeItem: () => { throw new Error("SecurityError"); },
  };
}

const NOW = Date.UTC(2026, 9, 28, 12, 0, 0);
const baseIntent = { planId: "regression-runner" as const, billingCycle: "yearly" as const, voucherCode: "BANKEIRO-2026" };

describe("pending plan intent", () => {
  it("saves and loads the plan, cycle and voucher", () => {
    const storage = memoryStorage();
    expect(savePendingIntent(baseIntent, storage, NOW)).toBe(true);
    expect(loadPendingIntent(storage, NOW + 1_000)).toEqual({ ...baseIntent, email: null, savedAt: NOW });
  });

  it("keeps a plan without voucher (free plan or plain checkout)", () => {
    const storage = memoryStorage();
    savePendingIntent({ planId: "smoke-test", billingCycle: "monthly", voucherCode: null }, storage, NOW);
    expect(loadPendingIntent(storage, NOW)?.voucherCode).toBeNull();
  });

  it("treats intents older than 24h as expired", () => {
    const storage = memoryStorage();
    savePendingIntent(baseIntent, storage, NOW);
    expect(loadPendingIntent(storage, NOW + PENDING_INTENT_TTL_MS)).not.toBeNull();
    expect(loadPendingIntent(storage, NOW + PENDING_INTENT_TTL_MS + 1)).toBeNull();
  });

  it("claims exactly once and removes the record", () => {
    const storage = memoryStorage();
    savePendingIntent(baseIntent, storage, NOW);
    const first = claimPendingIntent(storage, NOW + 5_000);
    expect(first.intent?.voucherCode).toBe("BANKEIRO-2026");
    expect(first.expired).toBeNull();
    expect(storage.data.has(PENDING_INTENT_STORAGE_KEY)).toBe(false);
    expect(claimPendingIntent(storage, NOW + 6_000)).toEqual({ intent: null, expired: null });
  });

  it("reports an expired intent on claim so the UI can prefill the code, and still removes it", () => {
    const storage = memoryStorage();
    savePendingIntent(baseIntent, storage, NOW);
    const result = claimPendingIntent(storage, NOW + PENDING_INTENT_TTL_MS + 60_000);
    expect(result.intent).toBeNull();
    expect(result.expired?.voucherCode).toBe("BANKEIRO-2026");
    expect(storage.data.has(PENDING_INTENT_STORAGE_KEY)).toBe(false);
  });

  it("treats a savedAt far in the future as expired", () => {
    const storage = memoryStorage();
    savePendingIntent(baseIntent, storage, NOW + 10 * 60_000);
    expect(loadPendingIntent(storage, NOW)).toBeNull();
    expect(claimPendingIntent(storage, NOW).intent).toBeNull();
  });

  it("clears the intent", () => {
    const storage = memoryStorage();
    savePendingIntent(baseIntent, storage, NOW);
    clearPendingIntent(storage);
    expect(loadPendingIntent(storage, NOW)).toBeNull();
  });

  it("only removes the record this tab saved (same savedAt)", () => {
    const storage = memoryStorage();
    savePendingIntent(baseIntent, storage, NOW);
    attachEmailToPendingIntent("qa@mblabs.com.br", storage);
    // Another tab / page load that never saved this record closing its modal.
    clearPendingIntentIfOwned(NOW - 1, storage);
    expect(loadPendingIntent(storage, NOW)?.email).toBe("qa@mblabs.com.br");
    clearPendingIntentIfOwned(NOW, storage);
    expect(loadPendingIntent(storage, NOW)).toBeNull();
    expect(() => clearPendingIntentIfOwned(NOW, throwingStorage())).not.toThrow();
  });

  it("attaches the sign-up e-mail without resetting the timestamp", () => {
    const storage = memoryStorage();
    savePendingIntent(baseIntent, storage, NOW);
    attachEmailToPendingIntent("  Fulano@MBLabs.com.br ", storage);
    expect(loadPendingIntent(storage, NOW)).toMatchObject({ email: "fulano@mblabs.com.br", savedAt: NOW });
  });

  it("drops corrupt, tampered or unknown-plan records instead of resuming them", () => {
    const corrupt = memoryStorage({ [PENDING_INTENT_STORAGE_KEY]: "{not json" });
    expect(claimPendingIntent(corrupt, NOW)).toEqual({ intent: null, expired: null });
    expect(corrupt.data.has(PENDING_INTENT_STORAGE_KEY)).toBe(false);

    const unknownPlan = memoryStorage({
      [PENDING_INTENT_STORAGE_KEY]: JSON.stringify({ ...baseIntent, planId: "enterprise", savedAt: NOW }),
    });
    expect(loadPendingIntent(unknownPlan, NOW)).toBeNull();

    const badCycle = memoryStorage({
      [PENDING_INTENT_STORAGE_KEY]: JSON.stringify({ ...baseIntent, billingCycle: "weekly", savedAt: NOW }),
    });
    expect(loadPendingIntent(badCycle, NOW)).toBeNull();

    const badVoucher = memoryStorage({
      [PENDING_INTENT_STORAGE_KEY]: JSON.stringify({ ...baseIntent, voucherCode: "<script>", savedAt: NOW }),
    });
    expect(loadPendingIntent(badVoucher, NOW)?.voucherCode).toBeNull();
  });

  it("never throws when storage is unavailable", () => {
    const storage = throwingStorage();
    expect(savePendingIntent(baseIntent, storage, NOW)).toBe(false);
    expect(loadPendingIntent(storage, NOW)).toBeNull();
    expect(claimPendingIntent(storage, NOW)).toEqual({ intent: null, expired: null });
    expect(() => clearPendingIntent(storage)).not.toThrow();
    expect(() => attachEmailToPendingIntent("a@b.com", storage)).not.toThrow();
    expect(() => notifyAccessChanged(storage, NOW)).not.toThrow();
    expect(savePendingIntent(baseIntent, null, NOW)).toBe(false);
    expect(claimPendingIntent(null, NOW)).toEqual({ intent: null, expired: null });
  });

  it("broadcasts access changes through a storage key other tabs listen to", () => {
    const storage = memoryStorage();
    notifyAccessChanged(storage, NOW);
    expect(storage.data.get(ACCESS_CHANGED_STORAGE_KEY)).toBe(String(NOW));
  });
});

describe("detectAuthRedirect", () => {
  it("recognizes a sign-up confirmation or magic link (implicit flow hash)", () => {
    expect(detectAuthRedirect("#access_token=abc&refresh_token=def&type=signup", "")).toBe("signup");
    expect(detectAuthRedirect("#access_token=abc&type=magiclink", "")).toBe("signed-in");
  });

  it("recognizes the PKCE code and token_hash variants", () => {
    expect(detectAuthRedirect("", "?code=123")).toBe("signed-in");
    expect(detectAuthRedirect("", "?token_hash=abc&type=email")).toBe("signed-in");
    expect(detectAuthRedirect("", "?token_hash=abc&type=signup")).toBe("signup");
  });

  it("recognizes an expired or used link", () => {
    expect(detectAuthRedirect("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid", "")).toBe("error");
  });

  it("ignores password recovery and ordinary visits", () => {
    expect(detectAuthRedirect("#access_token=abc&type=recovery", "")).toBe("none");
    expect(detectAuthRedirect("#planos", "")).toBe("none");
    expect(detectAuthRedirect("", "?checkout=success")).toBe("none");
  });
});
