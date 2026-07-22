import { adminClient } from "../_shared/auth.ts";
import { serve } from "../_shared/handler.ts";
import { jsonResponse, requirePost } from "../_shared/http.ts";

// Public (no auth): the extension's options page (offline-first, no Supabase client of its own,
// just plain fetch through background/auth.js's post() helper) needs this to show the same
// "Proteção Jurídica" status the LP already reads directly from the table via RLS. Only ever
// returns what's already safe to show publicly -- the whole legal_registration row.
serve(async (request) => {
  requirePost(request);
  const { data, error } = await adminClient()
    .from("legal_registration")
    .select("status,software_name,holder_name,protocol_number,protocol_date,registration_number,grant_date,public_query_url,public_notice,updated_at")
    .eq("id", true)
    .maybeSingle();
  if (error || !data) return jsonResponse(request, { available: false });
  return jsonResponse(request, {
    available: true,
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
  });
});
