// One-step local helper: turns a Google Cloud OAuth "Desktop app" client into a refresh token for
// the Chrome Web Store Publish API, proves it works against the real listing, and (with
// --set-github-secrets, the default of `npm run chrome-webstore:renew`) stores client id, secret
// and refresh token straight into the repository's GitHub Actions secrets through `gh`, so the
// token is never printed, copied or pasted by hand.
//
// Prerequisites (one-time, done by a human in the Google Cloud Console; see
// docs/DEPLOY_CHROME_WEBSTORE.md for the exact clicks):
//   1. A Google Cloud project with the "Chrome Web Store API" enabled.
//   2. An OAuth 2.0 Client ID of type "Desktop app" (NOT "Web application").
//   3. OAuth consent screen published "In production". In "Testing" Google revokes refresh tokens
//      after 7 days, which is exactly what broke the 2026-10-14 release (invalid_grant).
//
// Client id/secret come from CHROME_WEBSTORE_CLIENT_ID / CHROME_WEBSTORE_CLIENT_SECRET (env or
// --env-file); when missing, the script asks for them in the terminal.
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";

const EXTENSION_ID = process.env.CHROME_WEBSTORE_EXTENSION_ID || "ddaapjklnfjhjigeglgmjmadjnmdodfe";
const setGithubSecrets = process.argv.includes("--set-github-secrets");

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

const envArgIndex = process.argv.indexOf("--env-file");
const fileEnv = envArgIndex >= 0 ? readEnvFile(resolve(process.argv[envArgIndex + 1])) : {};
const env = { ...fileEnv, ...process.env };

// Copy-pasted documentation placeholders ("<seu client id>") produced a confusing Google error
// page instead of a clear message, so anything that is not a real value is asked for again.
const looksLikePlaceholder = (value) => !value || /[<>]/.test(value) || /seu|your/i.test(value);

async function ask(question) {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await prompt.question(question)).trim(); } finally { prompt.close(); }
}

let clientId = env.CHROME_WEBSTORE_CLIENT_ID;
let clientSecret = env.CHROME_WEBSTORE_CLIENT_SECRET;
if (looksLikePlaceholder(clientId)) clientId = await ask("Cole o Client ID (termina com .apps.googleusercontent.com): ");
if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(clientId)) throw new Error("Client ID inválido: ele termina com .apps.googleusercontent.com (Google Cloud > APIs e serviços > Credenciais).");
if (looksLikePlaceholder(clientSecret)) clientSecret = await ask("Cole o Client secret (começa com GOCSPX-): ");
if (looksLikePlaceholder(clientSecret) || clientSecret.length < 10) throw new Error("Client secret inválido.");

if (setGithubSecrets) {
  const gh = spawnSync("gh", ["auth", "status"], { encoding: "utf8", shell: process.platform === "win32" });
  if (gh.status !== 0) throw new Error("O GitHub CLI (gh) não está logado. Rode `gh auth login` e tente de novo.");
}

const port = 8721;
const redirectUri = `http://127.0.0.1:${port}/oauth/callback`;
const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.searchParams.set("client_id", clientId);
authUrl.searchParams.set("redirect_uri", redirectUri);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("access_type", "offline");
authUrl.searchParams.set("prompt", "consent");
authUrl.searchParams.set("scope", "https://www.googleapis.com/auth/chromewebstore");

const code = await new Promise((resolvePromise, rejectPromise) => {
  const server = createServer((request, response) => {
    const url = new URL(request.url, redirectUri);
    const error = url.searchParams.get("error");
    const authorizationCode = url.searchParams.get("code");
    // Browsers also request /favicon.ico or reopen the bare callback URL; those are not the
    // OAuth redirect, so keep waiting instead of failing the whole run (2026-10-14 failure).
    if (url.pathname !== "/oauth/callback" || (!error && !authorizationCode)) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(error
      ? "<h1>Autorização negada.</h1><p>Pode fechar esta aba e conferir o terminal.</p>"
      : "<h1>Autorizado.</h1><p>Pode fechar esta aba e voltar ao terminal.</p>");
    server.close();
    if (error) rejectPromise(new Error(`Google retornou erro: ${error}`));
    else resolvePromise(authorizationCode);
  });
  server.listen(port, "127.0.0.1", () => {
    console.log("\nAbrindo o navegador. Entre com a conta Google DONA da extensão na Chrome Web Store e clique em Permitir.");
    console.log("(Se aparecer \"O Google não verificou este app\", clique em Avançado > Acessar.)");
    console.log(`Se o navegador não abrir, copie esta URL:\n\n${authUrl}\n`);
    const opener = process.platform === "win32" ? ["cmd", ["/c", "start", "", authUrl.toString()]]
      : process.platform === "darwin" ? ["open", [authUrl.toString()]] : ["xdg-open", [authUrl.toString()]];
    spawn(opener[0], opener[1], { stdio: "ignore", detached: true }).on("error", () => {}).unref();
  });
});

const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri, grant_type: "authorization_code" }),
});
const tokenBody = await tokenResponse.json();
if (!tokenResponse.ok) throw new Error(`Troca de token falhou: ${tokenBody.error} ${tokenBody.error_description ?? ""} (confira se o Client secret é deste mesmo Client ID).`);
if (!tokenBody.refresh_token) {
  throw new Error(
    "Google não retornou refresh_token (acontece se essa conta já autorizou este client antes). " +
      "Revogue o acesso em https://myaccount.google.com/permissions e rode este script de novo.",
  );
}

// Proves the account really owns the listing before anything is saved.
const itemResponse = await fetch(`https://www.googleapis.com/chromewebstore/v1.1/items/${EXTENSION_ID}?projection=DRAFT`, {
  headers: { Authorization: `Bearer ${tokenBody.access_token}`, "x-goog-api-version": "2" },
});
const item = await itemResponse.json().catch(() => ({}));
if (!itemResponse.ok) {
  throw new Error(`Token gerado, mas a Chrome Web Store recusou a leitura do item ${EXTENSION_ID} (${itemResponse.status}). ` +
    "Use a conta Google dona da extensão no painel da Store.");
}
console.log(`\nConta confirmada como dona da extensão ${EXTENSION_ID} (estado do rascunho: ${item.uploadState ?? "?"}, versão: ${item.crxVersion ?? "?"}).`);

if (setGithubSecrets) {
  for (const [name, value] of [["CHROME_WEBSTORE_CLIENT_ID", clientId], ["CHROME_WEBSTORE_CLIENT_SECRET", clientSecret], ["CHROME_WEBSTORE_REFRESH_TOKEN", tokenBody.refresh_token]]) {
    // Value goes through stdin: it never appears in the terminal, shell history or process list.
    const result = spawnSync("gh", ["secret", "set", name], { input: value, encoding: "utf8", cwd: resolve(import.meta.dirname, ".."), shell: process.platform === "win32" });
    if (result.status !== 0) throw new Error(`Falha ao gravar o secret ${name}: ${result.stderr || result.stdout}`);
    console.log(`GitHub secret ${name} atualizado.`);
  }
  console.log("\nPronto. A publicação pela Action \"Build Chrome Web Store package\" já pode ser disparada.");
} else {
  console.log("\nRefresh token obtido. Guarde como CHROME_WEBSTORE_REFRESH_TOKEN (nunca commite este valor):\n");
  console.log(tokenBody.refresh_token);
  console.log("\nOu rode de novo com --set-github-secrets (npm run chrome-webstore:renew) para gravar direto no GitHub.");
}
