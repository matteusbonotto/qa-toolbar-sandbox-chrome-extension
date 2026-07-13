import { z } from "zod";

export const monthlyPlanCatalog = {
  pro: {
    displayPrice: "R$ 29,90",
    priceKey: "pro_monthly",
  },
  scale: {
    displayPrice: "R$ 59,90",
    priceKey: "scale_monthly",
  },
} as const;

export type MonthlyPriceKey = (typeof monthlyPlanCatalog)[keyof typeof monthlyPlanCatalog]["priceKey"];

export const environmentSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(48),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  riskLevel: z.enum(["low", "medium", "high", "critical"]),
  urlPatterns: z.array(z.string().trim().min(1).max(500)).max(30),
});

export const projectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  accentColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  environments: z.array(environmentSchema).max(20),
});

export type Environment = z.infer<typeof environmentSchema>;
export type Project = z.infer<typeof projectSchema>;

export const workspaceSetupSchema = z.object({
  projectName: z.string().trim().min(2).max(80),
  domain: z.string().trim().regex(/^(localhost|(?:[a-z0-9-]+\.)*[a-z0-9-]+)$/i),
  domains: z.array(z.string().trim().regex(/^(localhost|(?:[a-z0-9-]+\.)*[a-z0-9-]+)$/i)).min(1).max(20),
  environmentName: z.string().trim().min(1).max(48),
});

export const workspaceImportSchema = z.object({
  kind: z.literal("qts-workspace"),
  version: z.literal(1),
  activeProjectId: z.string().uuid(),
  setup: workspaceSetupSchema,
  projects: z.array(projectSchema).min(1).max(20),
}).strict().superRefine((value, context) => {
  if (!value.projects.some((project) => project.id === value.activeProjectId)) {
    context.addIssue({ code: "custom", path: ["activeProjectId"], message: "Active project was not found" });
  }
});

export type WorkspaceImport = z.infer<typeof workspaceImportSchema>;

const secretKeyPattern = /password|passwd|token|authorization|cookie|secret|api[-_]?key|access[-_]?token|refresh[-_]?token|card[-_]?number|cvv|cvc|credential/i;

export function redactValue(value: unknown, key = "", seen = new WeakSet<object>()): unknown {
  if (secretKeyPattern.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((entry) => redactValue(entry, key, seen));
  if (value && typeof value === "object") {
    if (seen.has(value)) return "[CIRCULAR]";
    seen.add(value);
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redactValue(entryValue, entryKey, seen)]),
    );
  }
  return value;
}

export interface MatchResult {
  environment: Environment | null;
  pattern: string | null;
}

export function matchEnvironment(url: string, environments: Environment[]): MatchResult {
  const candidate = new URL(url);
  for (const environment of environments) {
    for (const pattern of environment.urlPatterns) {
      const normalizedPattern = pattern.trim();
      if (!normalizedPattern) continue;
      const matches = normalizedPattern.startsWith("regex:")
        ? safeRegexTest(normalizedPattern.slice(6), candidate.href)
        : candidate.hostname === normalizedPattern || candidate.hostname.endsWith(`.${normalizedPattern}`);
      if (matches) return { environment, pattern: normalizedPattern };
    }
  }
  return { environment: null, pattern: null };
}

function safeRegexTest(source: string, value: string): boolean {
  if (source.length > 200 || /(\([^)]*[+*][^)]*\))[+*]/.test(source)) return false;
  try {
    return new RegExp(source, "i").test(value.slice(0, 2_000));
  } catch {
    return false;
  }
}
