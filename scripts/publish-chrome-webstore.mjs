// Uploads a packaged .zip to the existing Chrome Web Store item via the official Chrome Web
// Store Publish API — the automated equivalent of dragging the zip into the developer dashboard.
// By default it only uploads a new draft version (Google still reviews it before anything goes
// live). Pass --publish to also call the publish endpoint after a successful upload.
//
// Never creates a new Store item: the target extension ID is fixed (the real one, already
// published) unless explicitly overridden with --extension-id, so this can't accidentally
// duplicate the listing.
//
// Requires CHROME_WEBSTORE_CLIENT_ID, CHROME_WEBSTORE_CLIENT_SECRET and
// CHROME_WEBSTORE_REFRESH_TOKEN (see scripts/chrome-webstore-oauth-setup.mjs and
// docs/DEPLOY_CHROME_WEBSTORE.md for how to obtain them once).
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_EXTENSION_ID = "ddaapjklnfjhjigeglgmjmadjnmdodfe";

function readEnvFile(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const at = line.indexOf("=");
        const key = line.slice(0, at).trim();
        const rawValue = line.slice(at + 1).trim();
        const value = /^(['"]).*\1$/.test(rawValue) ? rawValue.slice(1, -1) : rawValue;
        return [key, value];
      }),
  );
}

function argValue(flag) {
  const prefix = `--${flag}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

const envArgIndex = process.argv.indexOf("--env-file");
const fileEnv = envArgIndex >= 0 ? readEnvFile(resolve(process.argv[envArgIndex + 1])) : {};
function secretEnvValue(key) {
  return fileEnv[key] ?? process.env[key];
}

// The three secrets are only ever read through secretEnvValue and are never logged below.
const clientId = secretEnvValue("CHROME_WEBSTORE_CLIENT_ID");
const clientSecret = secretEnvValue("CHROME_WEBSTORE_CLIENT_SECRET");
const refreshToken = secretEnvValue("CHROME_WEBSTORE_REFRESH_TOKEN");

// extensionId is not a secret (it's the public Chrome Web Store listing ID) and is
// deliberately sourced independently of secretEnvValue/fileEnv above.
const extensionId = argValue("extension-id") ?? process.env.CHROME_WEBSTORE_EXTENSION_ID ?? DEFAULT_EXTENSION_ID;
const zipPath = argValue("zip");
const shouldPublish = process.argv.includes("--publish");
const publishTarget = argValue("target") ?? "default";

if (!clientId || !clientSecret || !refreshToken) {
  throw new Error(
    "CHROME_WEBSTORE_CLIENT_ID, CHROME_WEBSTORE_CLIENT_SECRET e CHROME_WEBSTORE_REFRESH_TOKEN são " +
      "obrigatórios (env var, --env-file, ou GitHub Actions secret). Rode " +
      "scripts/chrome-webstore-oauth-setup.mjs uma vez para gerar o refresh token — veja " +
      "docs/DEPLOY_CHROME_WEBSTORE.md.",
  );
}
if (!zipPath) throw new Error("Passe --zip=<caminho do .zip empacotado> (ex.: gerado por scripts/package-extension.mjs).");
const resolvedZipPath = resolve(zipPath);
if (!existsSync(resolvedZipPath)) throw new Error(`Arquivo não encontrado: ${resolvedZipPath}`);

const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  }),
});
const tokenBody = await tokenResponse.json();
if (!tokenResponse.ok) throw new Error(`Falha ao renovar access token: ${tokenBody.error_description ?? tokenBody.error ?? tokenResponse.status}`);
const accessToken = tokenBody.access_token;

const authHeaders = {
  Authorization: `Bearer ${accessToken}`,
  "x-goog-api-version": "2",
};

console.log(`Enviando ${resolvedZipPath} para a Chrome Web Store (item já publicado, ID fixo salvo no repositório)...`);
const zipBytes = readFileSync(resolvedZipPath);
const uploadResponse = await fetch(`https://www.googleapis.com/upload/chromewebstore/v1.1/items/${extensionId}`, {
  method: "PUT",
  headers: authHeaders,
  body: zipBytes,
});
const uploadBody = await uploadResponse.json();
if (!uploadResponse.ok || uploadBody.uploadState !== "SUCCESS") {
  const details = uploadBody.itemError?.map((item) => `${item.error_detail ?? item.error_code}`).join("; ");
  throw new Error(`Upload falhou (uploadState=${uploadBody.uploadState ?? "?"}): ${details ?? JSON.stringify(uploadBody)}`);
}
console.log("Upload aceito. O item fica como rascunho até você publicar (ou até o workflow com --publish rodar).");

if (!shouldPublish) {
  console.log("Nenhuma publicação feita (rode com --publish quando quiser enviar para revisão da Store).");
  process.exit(0);
}

console.log(`Enviando para revisão da Store (target=${publishTarget})...`);
const publishResponse = await fetch(
  `https://www.googleapis.com/chromewebstore/v1.1/items/${extensionId}/publish?publishTarget=${publishTarget}`,
  { method: "POST", headers: { ...authHeaders, "content-length": "0" } },
);
const publishBody = await publishResponse.json();
if (!publishResponse.ok || !publishBody.status?.includes("OK")) {
  throw new Error(`Publicação falhou: ${JSON.stringify(publishBody)}`);
}
console.log(`Enviado para revisão da Store: ${JSON.stringify(publishBody.status)}`);
console.log("A Google ainda revisa manualmente antes de ficar visível para os usuários — isso não pula a revisão.");
