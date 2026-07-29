export interface EntitlementCandidate {
  source: string;
  expiresAt: string | null;
  createdAt: string;
  plan: { id: string; key: string; name: string } | null;
  features: Record<string, boolean | number | string>;
  unrestricted?: boolean;
}

function featureScore(features: Record<string, boolean | number | string>): number {
  return Object.values(features).reduce<number>((score, value) => {
    if (value === true) return score + 1_000;
    if (typeof value === "number" && Number.isFinite(value)) return score + 100 + Math.max(0, Math.min(value, 99));
    if (typeof value === "string" && value.trim()) return score + 100;
    return score;
  }, 0);
}

function expiryScore(expiresAt: string | null): number {
  if (expiresAt === null) return Number.MAX_SAFE_INTEGER;
  const timestamp = Date.parse(expiresAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function selectBestEntitlement(candidates: EntitlementCandidate[]): EntitlementCandidate | null {
  return [...candidates].sort((left, right) => {
    if (Boolean(left.unrestricted) !== Boolean(right.unrestricted)) return left.unrestricted ? -1 : 1;
    const capabilityDifference = featureScore(right.features) - featureScore(left.features);
    if (capabilityDifference) return capabilityDifference;
    const expiryDifference = expiryScore(right.expiresAt) - expiryScore(left.expiresAt);
    if (expiryDifference) return expiryDifference;
    return Date.parse(right.createdAt) - Date.parse(left.createdAt);
  })[0] ?? null;
}
