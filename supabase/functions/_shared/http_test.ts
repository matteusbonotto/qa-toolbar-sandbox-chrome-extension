import { assertEquals } from "jsr:@std/assert@1.0.16";
import { allowedOrigin, ApiError, preflight, readJson, readJsonObject } from "./http.ts";

Deno.test("CORS echoes only configured web and extension origins", () => {
  Deno.env.set("ALLOWED_ORIGINS", "https://example.test");
  Deno.env.set("ALLOWED_EXTENSION_IDS", "ddaapjklnfjhjigeglgmjmadjnmdodfe");
  assertEquals(allowedOrigin("https://example.test"), "https://example.test");
  assertEquals(
    allowedOrigin("chrome-extension://ddaapjklnfjhjigeglgmjmadjnmdodfe"),
    "chrome-extension://ddaapjklnfjhjigeglgmjmadjnmdodfe",
  );
  assertEquals(allowedOrigin("https://attacker.invalid"), null);
});

Deno.test("preflight accepts an allowlisted origin and rejects an unknown origin", () => {
  Deno.env.set("ALLOWED_ORIGINS", "https://example.test");
  const accepted = preflight(new Request("https://function.test", {
    method: "OPTIONS", headers: { origin: "https://example.test" },
  }));
  assertEquals(accepted?.status, 204);
  assertEquals(accepted?.headers.get("access-control-allow-origin"), "https://example.test");
  const denied = preflight(new Request("https://function.test", {
    method: "OPTIONS", headers: { origin: "https://attacker.invalid" },
  }));
  assertEquals(denied?.status, 403);
  assertEquals(denied?.headers.has("access-control-allow-origin"), false);
});

Deno.test("JSON reader enforces content type and parses bounded bodies", async () => {
  const request = new Request("https://function.test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ok: true }),
  });
  assertEquals(await readJson(request), { ok: true });
});

Deno.test("JSON object reader rejects null, arrays and primitives with 400 instead of a 500 TypeError", async () => {
  for (const body of ["null", "[]", "123", "\"text\"", "true"]) {
    const request = new Request("https://function.test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    const error = await readJsonObject(request).then(() => null, (caught) => caught);
    assertEquals(error instanceof ApiError ? [error.status, error.code] : error, [400, "invalid_request"]);
  }
  const ok = new Request("https://function.test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "verify" }),
  });
  assertEquals(await readJsonObject(ok), { action: "verify" });
});
