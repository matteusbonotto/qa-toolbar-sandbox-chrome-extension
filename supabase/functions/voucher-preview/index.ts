import { createHash } from "node:crypto";
import { adminClient, clientRateSubject, enforceRateLimit } from "../_shared/auth.ts";
import { serve } from "../_shared/handler.ts";
import { jsonResponse, readJson, requirePost } from "../_shared/http.ts";
import { allowedEmailDomainsPayload } from "../_shared/vouchers.ts";

interface PlanRelation {
  key: string;
  name: string;
}

interface PreviewRow {
  kind: string;
  label: string;
  grant_days: number | null;
  discount_percent_off: number | null;
  discount_amount_off_minor: number | null;
  allowed_email_domains: string[] | null;
  plans: PlanRelation | PlanRelation[] | null;
}

function relation(value: PlanRelation | PlanRelation[] | null): PlanRelation | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function previewPayload(row: PreviewRow) {
  const plan = relation(row.plans);
  return {
    valid: true,
    kind: row.kind,
    label: row.label,
    plan: plan ? { key: plan.key, name: plan.name } : null,
    grantDays: row.grant_days,
    discountPercentOff: row.discount_percent_off,
    discountAmountOffMinor: row.discount_amount_off_minor,
    // null = any e-mail. Otherwise only a confirmed e-mail whose domain is exactly one of these may
    // redeem (enforced in the RPC; shown here so the Landing can warn before login). Public on
    // purpose: the domain is the eligibility rule itself, not a secret.
    allowedEmailDomains: allowedEmailDomainsPayload(row.allowed_email_domains),
  };
}

// Public (no auth): the landing page needs to preview a voucher's benefit before a visitor even
// has an account. Never leaks code_hash/ids, and always answers 200 (valid:true/false) so the
// front end can tell "bad code" apart from "network error" -- never 404/409 here.
serve(async (request) => {
  requirePost(request);
  const input = await readJson(request);
  const code = typeof input === "object" && input !== null && "code" in input
    ? String((input as { code: unknown }).code).trim().toUpperCase()
    : "";
  if (!/^[A-Z0-9-]{6,64}$/.test(code)) return jsonResponse(request, { valid: false, reason: "voucher_unavailable" });

  const voucherHash = createHash("sha256").update(code).digest("hex");
  await enforceRateLimit(voucherHash, "voucher-preview-code", 20, 3_600);
  // Per client instead of one global bucket: a single attacker could exhaust the old global 300/h and
  // take the preview down for every visitor (security audit 2026-10-22), and per client is also the
  // useful brake against guessing codes.
  await enforceRateLimit(await clientRateSubject(request), "voucher-preview-client", 60, 3_600);

  const admin = adminClient();
  const now = new Date().toISOString();

  const { data: campaign } = await admin.from("voucher_campaigns")
    .select("kind,label,grant_days,discount_percent_off,discount_amount_off_minor,allowed_email_domains,maximum_redemptions,redemption_count,plans(key,name)")
    .eq("code_hash", voucherHash).eq("enabled", true)
    .or(`expires_at.is.null,expires_at.gt.${now}`).maybeSingle();
  const exhausted = campaign?.maximum_redemptions != null && campaign.redemption_count >= campaign.maximum_redemptions;
  if (campaign && !exhausted) return jsonResponse(request, previewPayload(campaign as unknown as PreviewRow));

  const { data: voucher } = await admin.from("vouchers")
    .select("kind,label,grant_days,discount_percent_off,discount_amount_off_minor,allowed_email_domains,plans(key,name)")
    .eq("code_hash", voucherHash).eq("status", "available")
    .or(`expires_at.is.null,expires_at.gt.${now}`).maybeSingle();
  if (voucher) return jsonResponse(request, previewPayload(voucher as unknown as PreviewRow));

  return jsonResponse(request, { valid: false, reason: "voucher_unavailable" });
});
