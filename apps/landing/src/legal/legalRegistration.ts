import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

export type LegalRegistrationStatus = "preparation" | "payment_pending" | "protocolled" | "registered";

export interface LegalRegistrationRecord {
  status: LegalRegistrationStatus;
  softwareName: string;
  holderName: string;
  protocolNumber: string | null;
  protocolDate: string | null;
  registrationNumber: string | null;
  grantDate: string | null;
  publicQueryUrl: string | null;
  publicNotice: string | null;
  updatedAt: string;
}

export interface LegalStatusCopy {
  title: string;
  body: string;
  disclaimer?: string;
}

// Per-locale template strings (t.legal.status.<status>) with {software}/{holder}/{process}/
// {number}/{date} placeholders -- the actual wording lives in i18n/translations.ts, this just
// fills them in from the live record. Never invents a status or a number that isn't stored.
export function resolveLegalStatusCopy(
  record: LegalRegistrationRecord,
  templates: Record<LegalRegistrationStatus, { title: string; body: string; disclaimer?: string }>,
  formatDate: (iso: string | null) => string,
): LegalStatusCopy {
  const template = templates[record.status];
  const fill = (text: string) =>
    text
      .replace("{software}", record.softwareName)
      .replace("{holder}", record.holderName)
      .replace("{process}", record.protocolNumber ?? "")
      .replace("{number}", record.registrationNumber ?? "")
      .replace("{date}", record.status === "registered" ? formatDate(record.grantDate) : formatDate(record.protocolDate));
  return {
    title: template.title,
    body: fill(template.body),
    ...(template.disclaimer ? { disclaimer: template.disclaimer } : {}),
  };
}

export async function loadLegalRegistration(): Promise<LegalRegistrationRecord | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  const { data, error } = await supabase
    .from("legal_registration")
    .select("status,software_name,holder_name,protocol_number,protocol_date,registration_number,grant_date,public_query_url,public_notice,updated_at")
    .eq("id", true)
    .maybeSingle();
  if (error || !data) return null;
  return {
    status: data.status,
    softwareName: data.software_name,
    holderName: data.holder_name,
    protocolNumber: data.protocol_number,
    protocolDate: data.protocol_date,
    registrationNumber: data.registration_number,
    grantDate: data.grant_date,
    publicQueryUrl: data.public_query_url,
    publicNotice: data.public_notice,
    updatedAt: data.updated_at,
  };
}
