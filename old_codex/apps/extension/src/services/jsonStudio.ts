export function formatJson(value: unknown, compact = false): string { return JSON.stringify(value, null, compact ? 0 : 2); }
export function searchJson(value: unknown, query: string): string[] {
  const needle = query.trim().toLowerCase(); if (!needle) return [];
  const results: string[] = [];
  const visit = (entry: unknown, path: string, depth: number) => {
    if (depth > 12 || results.length >= 200) return;
    if (entry && typeof entry === "object") Object.entries(entry as Record<string, unknown>).forEach(([key, child]) => { const next = path ? `${path}.${key}` : key; if (key.toLowerCase().includes(needle) || String(child).toLowerCase().includes(needle)) results.push(next); visit(child, next, depth + 1); });
  };
  visit(value, "$", 0); return [...new Set(results)];
}
export function diffJson(left: unknown, right: unknown): { path: string; before: unknown; after: unknown }[] {
  const changes: { path: string; before: unknown; after: unknown }[] = [];
  const walk = (a: unknown, b: unknown, path: string, depth: number) => {
    if (depth > 12 || changes.length >= 500) return;
    if (Object.is(a, b)) return;
    if (a && b && typeof a === "object" && typeof b === "object") { const keys = new Set([...Object.keys(a), ...Object.keys(b)]); keys.forEach((key) => walk((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${path}.${key}`, depth + 1)); return; }
    changes.push({ path, before: a, after: b });
  };
  walk(left, right, "$", 0); return changes;
}

export function queryJsonPath(value: unknown, expression: string): unknown {
  const normalized = expression.trim();
  if (!normalized.startsWith("$") || /[^$.[\]\w-]/.test(normalized)) throw new Error("JSONPath suporta apenas propriedades e índices, por exemplo $.data.items[0].id");
  const segments = normalized.slice(1).replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  return segments.reduce<unknown>((current, segment) => current && typeof current === "object" ? (current as Record<string, unknown>)[segment] : undefined, value);
}

export function inferJsonSchema(value: unknown, depth = 0): Record<string, unknown> {
  if (depth > 12) return { description: "Depth truncated" };
  if (value === null) return { type: "null" };
  if (Array.isArray(value)) return { type: "array", items: value.length ? inferJsonSchema(value[0], depth + 1) : {} };
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 500);
    return { type: "object", properties: Object.fromEntries(entries.map(([key, entry]) => [key, inferJsonSchema(entry, depth + 1)])), required: entries.map(([key]) => key), additionalProperties: true };
  }
  return { type: typeof value === "number" && Number.isInteger(value) ? "integer" : typeof value };
}
