// Creates (or resets the password of) the single founder admin account, using the
// Supabase Admin API directly — never through any public-facing page. There is deliberately
// no "create account" flow in apps/admin anymore: that used to be reachable by anyone who
// opened /admin/ (the target e-mail is shown in plain text on the login screen), which let
// an attacker race the real founder to claim/lock the account before it was ever provisioned.
// This script is the only supported way to provision or recover it.
//
// This script must be run by YOU, locally, with your own Supabase service-role key —
// Claude never receives or uses that key.
//
// Usage:
//   SUPABASE_URL=https://xxxx.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
//   ADMIN_ACCOUNT_PASSWORD='<the password you want to log in with>' \
//   node supabase/bootstrap-admin-account.mjs
//
// Safe to re-run: if the account already exists, this only updates its password (and makes
// sure the e-mail is marked confirmed) — it never creates a second account.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = process.env.ADMIN_ACCOUNT_PASSWORD;
const FOUNDER_EMAIL = "matteusbonotto+admin@gmail.com";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !PASSWORD) {
  console.error(
    "Missing env vars. Run as:\n" +
      "  SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=... ADMIN_ACCOUNT_PASSWORD='<password>' node supabase/bootstrap-admin-account.mjs",
  );
  process.exit(1);
}
if (PASSWORD.length < 8) {
  console.error("ADMIN_ACCOUNT_PASSWORD precisa ter pelo menos 8 caracteres.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function findExistingUser(email) {
  const perPage = 1000;
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const match = data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (match) return match;
    if (data.users.length < perPage) return null;
  }
  throw new Error("Too many users to page through — narrow the search.");
}

const existing = await findExistingUser(FOUNDER_EMAIL);

if (!existing) {
  const { data, error } = await supabase.auth.admin.createUser({
    email: FOUNDER_EMAIL,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  console.log(`Conta criada e confirmada para ${FOUNDER_EMAIL} (id ${data.user.id}).`);
} else {
  const { error } = await supabase.auth.admin.updateUserById(existing.id, {
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  console.log(`Conta já existia (id ${existing.id}) — senha redefinida e e-mail confirmado.`);
}

console.log("Agora entre em /admin/ com essa senha; o segundo fator (código por e-mail) continua exigido normalmente.");
