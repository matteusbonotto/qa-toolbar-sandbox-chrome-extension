import { assertEquals } from "jsr:@std/assert@1.0.16";
import { allowedOrigin, preflight, readJson } from "./http.ts";

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
