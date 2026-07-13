const headers = {
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
  "content-type": "text/html; charset=utf-8",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

Deno.serve(() => new Response(`<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body><main><h1>Payment received</h1><p>Return to QA Toolbar Sandbox. Your Pro access will update after secure webhook confirmation.</p></main></body></html>`, { headers }));
