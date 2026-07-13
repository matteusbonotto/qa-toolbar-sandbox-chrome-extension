const headers = {
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
  "content-type": "text/html; charset=utf-8",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

Deno.serve(() => new Response(`<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body><main><h1>Checkout canceled</h1><p>No charge was confirmed. You can return to QA Toolbar Sandbox.</p></main></body></html>`, { headers }));
