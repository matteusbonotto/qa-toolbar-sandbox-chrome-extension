// One-time local helper: turns a Google Cloud OAuth "Desktop app" client into a long-lived
// refresh token for the Chrome Web Store Publish API. Run this once per Google account that
// owns the Store listing; the resulting refresh token is what scripts/publish-chrome-webstore.mjs
// (and the CI workflow) use afterwards, so nobody has to open the Store dashboard by hand again.
//
// Prerequisites (one-time, done by a human in the Google Cloud Console — see
// docs/DEPLOY_CHROME_WEBSTORE.md for the exact clicks):
//   1. A Google Cloud project with the "Chrome Web Store API" enabled.
//   2. An OAuth 2.0 Client ID of type "Desktop app" (NOT "Web application").
//   3. CHROME_WEBSTORE_CLIENT_ID / CHROME_WEBSTORE_CLIENT_SECRET from that client, available as
//      environment variables (export them in your shell, or pass --env-file path/to/file).
//
// This script never writes the client secret or the refresh token to disk — it only prints the
// refresh token once, for you to copy into your own secret storage (local .env.edge.local,
// GitHub Actions secret, etc.). Nothing here is uploaded or published; it only requests the
// "chromewebstore" OAuth scope so publish-chrome-webstore.mjs can act on your behalf later.
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

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

const clientId = env.CHROME_WEBSTORE_CLIENT_ID;
const clientSecret = env.CHROME_WEBSTORE_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  throw new Error(
    "CHROME_WEBSTORE_CLIENT_ID e CHROME_WEBSTORE_CLIENT_SECRET são obrigatórios (env var ou --env-file). " +
      "Veja docs/DEPLOY_CHROME_WEBSTORE.md para criar o OAuth Client 'Desktop app' uma única vez.",
  );
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

console.log("Abra esta URL no navegador logado com a conta Google DONA da extensão na Store:");
console.log("");
console.log(authUrl.toString());
console.log("");
console.log(`Aguardando autorização em ${redirectUri} ...`);

const code = await new Promise((resolvePromise, rejectPromise) => {
  const server = createServer((request, response) => {
    const url = new URL(request.url, redirectUri);
    if (url.pathname !== "/oauth/callback") {
      response.writeHead(404).end();
      return;
    }
    const error = url.searchParams.get("error");
    const authorizationCode = url.searchParams.get("code");
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(
      error
        ? "<h1>Autorização negada.</h1><p>Pode fechar esta aba e conferir o terminal.</p>"
        : "<h1>Autorizado.</h1><p>Pode fechar esta aba e voltar ao terminal.</p>",
    );
    server.close();
    if (error) rejectPromise(new Error(`Google retornou erro: ${error}`));
    else if (!authorizationCode) rejectPromise(new Error("Callback sem parâmetro 'code'."));
    else resolvePromise(authorizationCode);
  });
  server.listen(port, "127.0.0.1");
});

const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  }),
});
const tokenBody = await tokenResponse.json();
if (!tokenResponse.ok) throw new Error(`Troca de token falhou: ${tokenBody.error_description ?? tokenBody.error ?? tokenResponse.status}`);
if (!tokenBody.refresh_token) {
  throw new Error(
    "Google não retornou refresh_token (normalmente acontece se essa conta já autorizou este client antes). " +
      "Revogue o acesso em https://myaccount.google.com/permissions e rode este script de novo.",
  );
}

console.log("");
console.log("Refresh token obtido. Guarde como CHROME_WEBSTORE_REFRESH_TOKEN (nunca commite este valor):");
console.log("");
console.log(tokenBody.refresh_token);
console.log("");
console.log("Próximo passo: salvar CLIENT_ID/CLIENT_SECRET/REFRESH_TOKEN no seu .env.edge.local local");
console.log("e/ou como GitHub Actions secrets, depois rodar `npm run release:chrome:upload`.");
