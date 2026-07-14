import { createBillingApi } from "./runtimeConfig";
import { verifyOfflineEntitlement } from "./offlineEntitlement";

export type EntitlementCache = {
  plan: { key: string; name: string };
  features: Record<string, unknown>;
  trial: { active: boolean; endsAt: string | null; daysRemaining: number };
  referral: { code: string | null; qualified: number };
  access: { active: boolean; source: string | null; expiresAt: string | null; daysRemaining: number | null; expiryWarning: boolean; installUrl: string };
  featureFlags: Record<string, { enabled: boolean; config: unknown }>;
  checkedAt: string;
};

export async function ensureInstallationId(): Promise<string> {
  const stored = await browser.storage.local.get("qtsInstallation");
  const installation = stored.qtsInstallation as { id?: string; installedAt?: string; schemaVersion?: number } | undefined;
  if (installation?.id) return installation.id;
  const id = crypto.randomUUID();
  await browser.storage.local.set({
    qtsInstallation: {
      id,
      installedAt: installation?.installedAt ?? new Date().toISOString(),
      schemaVersion: 2,
    },
  });
  return id;
}

export async function refreshEntitlements(accessToken: string): Promise<EntitlementCache> {
  const installationId = await ensureInstallationId();
  const billing = createBillingApi();
  await billing.registerInstallation(accessToken, installationId, "Chrome principal");
  const status = await billing.status(accessToken, installationId);
  const cache: EntitlementCache = {
    plan: status.plan,
    features: status.features,
    trial: status.trial,
    referral: status.referral,
    access: status.access ?? { active: false, source: null, expiresAt: null, daysRemaining: null, expiryWarning: false, installUrl: "https://chromewebstore.google.com/" },
    featureFlags: status.featureFlags ?? {},
    checkedAt: status.checkedAt,
  };
  await browser.storage.local.set({ qtsEntitlementCache: cache, ...(status.offlineToken ? { qtsOfflineEntitlementToken: status.offlineToken } : {}) });
  return cache;
}

export async function loadVerifiedCachedEntitlements(): Promise<EntitlementCache | null> {
  if (import.meta.env.MODE === "test") {
    const testStored = await browser.storage.local.get("qtsEntitlementCache");
    return (testStored.qtsEntitlementCache as EntitlementCache | undefined) ?? null;
  }
  const installationId = await ensureInstallationId();
  const stored = await browser.storage.local.get("qtsOfflineEntitlementToken");
  if (typeof stored.qtsOfflineEntitlementToken !== "string") return null;
  return verifyOfflineEntitlement(stored.qtsOfflineEntitlementToken, installationId);
}

export function featureEnabled(cache: EntitlementCache | null, key: string): boolean {
  if (cache?.featureFlags?.[key]?.enabled === false) return false;
  return cache?.features[key] === true;
}
