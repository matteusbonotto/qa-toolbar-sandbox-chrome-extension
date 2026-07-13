import { createBillingApi } from "./runtimeConfig";

export type EntitlementCache = {
  plan: { key: string; name: string };
  features: Record<string, unknown>;
  trial: { active: boolean; endsAt: string | null; daysRemaining: number };
  referral: { code: string | null; qualified: number };
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
    checkedAt: status.checkedAt,
  };
  await browser.storage.local.set({ qtsEntitlementCache: cache });
  return cache;
}

export function featureEnabled(cache: EntitlementCache | null, key: string): boolean {
  return cache?.features[key] === true;
}
