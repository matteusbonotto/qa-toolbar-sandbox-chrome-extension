// Hostile inputs used by edge-functions.security.test.mjs. Every string here is sent as a JSON
// string value (never concatenated into a URL or a header), so the suite tests how the functions
// treat the VALUE, which is the attack surface a real client controls.

export const SQL_INJECTION = [
  "' OR '1'='1",
  "' OR 1=1 --",
  "\" OR \"\"=\"",
  "'; DROP TABLE public.mt_rooms; --",
  "1; SELECT pg_sleep(5); --",
  "' UNION SELECT id, email FROM auth.users --",
  "admin'--",
  "') OR ('a'='a",
  "%27%20OR%201%3D1--",
  "$$; select 1; $$",
  "1' AND (SELECT COUNT(*) FROM public.profiles) > 0 AND '1'='1",
  "x' OR exists(select 1 from public.user_roles) or 'x",
  // PostgREST filter grammar: a value smuggled into .or()/.eq() would look like this.
  "abc,id.neq.00000000-0000-0000-0000-000000000000",
  "*)(or=(id.not.is.null",
];

export const TRAVERSAL_AND_MARKUP = [
  "../../../../etc/passwd",
  "..\\..\\windows\\win.ini",
  "<script>alert(1)</script>",
  "<img src=x onerror=alert(1)>",
  "javascript:alert(1)",
  "{{7*7}}${7*7}",
];

export const UNICODE_AND_CONTROL = [
  "\u0000",
  "abc\u0000def",
  "\u0007\u0008\u001b[31m",
  "‮evil‬",
  "﻿bom",
  "\uD800",
  "\u{1F4A3}\u{1F4A3}\u{1F4A3}",
  "é́́́",
  "\r\nSet-Cookie: injected=1",
  " ".repeat(64),
];

export const OVERSIZED_STRING = "A".repeat(20_000);

export const ALL_HOSTILE_STRINGS = [...SQL_INJECTION, ...TRAVERSAL_AND_MARKUP, ...UNICODE_AND_CONTROL];

// Non-object JSON roots: every function must answer 4xx (or its documented 200) and never 500.
export const NON_OBJECT_JSON_BODIES = ["null", "[]", "123", "\"text\"", "true", "[{\"action\":\"create\"}]"];

export const INVALID_JSON_BODIES = ["{", "{\"a\":", "{'single':'quotes'}", "\u0000", "{\"a\":1}}"];

// Prototype pollution: JSON.parse creates an OWN property named __proto__, so a server that later
// merges or does `key in input` must still not treat these as real fields.
export function prototypePollutionBodies(base = {}) {
  return [
    `{"__proto__": {"polluted": "yes", "action": "end", "roomId": "00000000-0000-4000-8000-000000000000", "isHost": true}${tail(base)}}`,
    `{"constructor": {"prototype": {"polluted": "yes", "admin": true}}${tail(base)}}`,
    `{"__proto__": null${tail(base)}}`,
  ];
}

function tail(base) {
  const entries = Object.entries(base);
  return entries.length ? `, ${JSON.stringify(base).slice(1, -1)}` : "";
}

// Strings that must never appear in a response body: stack traces, SQL/PostgREST errors, runtime
// internals, secrets.
export const LEAK_PATTERNS = [
  ["stack trace", /\bat\s+[\w$.<>]+\s+\((?:file|https?|node|ext):/i],
  ["source position", /\.(?:ts|mjs|js):\d+:\d+/],
  ["file url", /file:\/\//i],
  ["SQL error", /\b(?:syntax error at or near|SQLSTATE|unterminated quoted string|invalid input syntax for|violates (?:row-level security|foreign key|check|unique) constraint|duplicate key value|relation "[^"]+" does not exist|column "[^"]+" does not exist)\b/i],
  ["PostgREST error", /\b(?:PGRST\d{3}|PostgrestError|pg_catalog|pg_sleep)\b/],
  ["runtime internals", /\b(?:TypeError|ReferenceError|RangeError|SyntaxError: Unexpected|Deno\.[a-z]+|node:internal)\b/],
  ["secret material", /\b(?:service_role|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|sb_secret_[A-Za-z0-9_-]+|sk_(?:live|test)_[A-Za-z0-9]+|whsec_[A-Za-z0-9]+|BEGIN [A-Z ]*PRIVATE KEY|ACCESS_TOKEN_PRIVATE_KEY_JWK|KEEP_ALIVE_SECRET)\b/],
  ["polluted prototype", /"polluted"\s*:/],
];
