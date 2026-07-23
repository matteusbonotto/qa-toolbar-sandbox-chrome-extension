// Builds a visually distinct test extension that can live beside production in Chrome.
// It never changes apps/extension in place and refuses to use the production backend.
import { createWriteStream } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { ZipArchive } from "archiver";

const root = resolve(import.meta.dirname, "..");
const sourceDir = resolve(root, "apps/extension");
const artifactsDir = resolve(root, "artifacts");
const outputDir = resolve(artifactsDir, "extension-test");
const productionBackend = "https://xhusvkylbouwtpcevgri.supabase.co/functions/v1";
const testManifestKey = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAsXVhjoTGRVA4XRsf0rTZptllsKFVLMnLWonibuhhKnHWMgmeIgwdYInBVUQY73ntb8rJq3gmTHStxZhdXNzitZaa5p4TYevYKrWFJMCFqQHmZB6eoG32q8nuVyff9LX0pJj9VHuKabvBgTkI5CdYfuuF/u2kTPbWkPb/WfAEgsxVXe3Ymiap3P7JgNLwEu7QI2MZ4O21A2kPTM7I+jJqe2rqsb7FvOKOp7d9GZETAsauMXzUbZcF1mFfpaAM6JaX5URCmnQM+ESfdVUJdPn3VgJmn4t8UGvG95RyyKqL7V12MVihZVl+hx8tnxP/3Hi4Djc34kTnOfGYhCxs+lE/gQIDAQAB";
const backendArg = process.argv.find((value) => value.startsWith("--backend-url="))?.slice(14);
const backendUrl = String(backendArg || process.env.QTS_TEST_FUNCTIONS_BASE_URL || "http://127.0.0.1:54321/functions/v1").replace(/\/+$/, "");

let parsedBackendUrl;
try {
  parsedBackendUrl = new URL(backendUrl);
} catch {
  parsedBackendUrl = null;
}
const isLocalBackend = parsedBackendUrl
  && parsedBackendUrl.protocol === "http:"
  && ["127.0.0.1", "localhost"].includes(parsedBackendUrl.hostname)
  && /^\/functions\/v1\/?$/.test(parsedBackendUrl.pathname);
const isSeparateSupabaseBackend = parsedBackendUrl
  && parsedBackendUrl.protocol === "https:"
  && /^[a-z0-9]+\.supabase\.co$/i.test(parsedBackendUrl.hostname)
  && /^\/functions\/v1\/?$/.test(parsedBackendUrl.pathname);
const isProductionBackend = parsedBackendUrl
  && parsedBackendUrl.protocol === "https:"
  && parsedBackendUrl.hostname === "xhusvkylbouwtpcevgri.supabase.co"
  && /^\/functions\/v1\/?$/.test(parsedBackendUrl.pathname);

if (!(isLocalBackend || isSeparateSupabaseBackend)) {
  throw new Error("Backend de teste inválido. Use Supabase local ou um projeto Supabase separado.");
}
if (isProductionBackend) throw new Error("SEGURANÇA: o pacote TESTE não pode usar o backend de produção.");
if (relative(artifactsDir, outputDir).startsWith("..")) throw new Error("Diretório de teste fora de artifacts/.");

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
await cp(sourceDir, outputDir, { recursive: true });

const manifestPath = resolve(outputDir, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
manifest.name = "QA Toolbar Sandbox [TESTE]";
manifest.description = `[AMBIENTE DE TESTE — NÃO PUBLICAR] ${manifest.description}`;
manifest.version_name = `${manifest.version}-teste`;
manifest.action.default_title = "QA Toolbar Sandbox — TESTE";
manifest.key = testManifestKey; // stable test-only ID: dppfhjpccijidcpbmmcdlbhoknkdjoll
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

const authPath = resolve(outputDir, "src/background/auth.js");
const authSource = await readFile(authPath, "utf8");
if (!authSource.includes(productionBackend)) throw new Error("Não foi possível localizar o backend de produção no auth.js.");
await writeFile(authPath, authSource.replace(productionBackend, backendUrl), "utf8");

const outputArg = process.argv.find((value) => value.startsWith("--output="))?.slice(9);
const zipPath = resolve(root, outputArg || `artifacts/qa-toolbar-sandbox-TESTE-v${manifest.version}.zip`);
await mkdir(dirname(zipPath), { recursive: true });
const output = createWriteStream(zipPath);
const archive = new ZipArchive({ zlib: { level: 9 } });
const done = new Promise((resolveDone, rejectDone) => { output.on("close", resolveDone); archive.on("error", rejectDone); });
archive.pipe(output);
archive.file(manifestPath, { name: "manifest.json" });
archive.directory(resolve(outputDir, "icons"), "icons");
archive.directory(resolve(outputDir, "src"), "src");
await archive.finalize();
await done;

console.log("PACOTE DE TESTE criado — ele não será enviado à Chrome Web Store.");
console.log(`Backend isolado: ${backendUrl}`);
console.log(`Pasta para Carregar sem compactação: ${outputDir}`);
console.log(`ZIP de teste: ${zipPath}`);
