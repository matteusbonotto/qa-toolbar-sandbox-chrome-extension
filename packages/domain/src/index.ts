import { z } from "zod";
export * from "./i18n";

export const themeCatalog = [
  { key: "red", name: "Vermelho", accent: "#ef3340", meaning: "energia e ação" },
  { key: "green", name: "Verde", accent: "#16a46f", meaning: "confiança e progresso" },
  { key: "blue", name: "Azul", accent: "#2878ff", meaning: "clareza e precisão" },
  { key: "white", name: "Branco", accent: "#d8dee9", meaning: "foco e simplicidade" },
  { key: "black", name: "Preto", accent: "#8b93a7", meaning: "controle e sofisticação" },
  { key: "pink", name: "Rosa", accent: "#ec4899", meaning: "criatividade e acolhimento" },
  { key: "orange", name: "Laranja", accent: "#f97316", meaning: "ritmo e descoberta" },
] as const;

export type ThemeKey = (typeof themeCatalog)[number]["key"];
export type ColorMode = "light" | "dark";

export function isThemeKey(value: unknown): value is ThemeKey {
  return themeCatalog.some((theme) => theme.key === value);
}

export const planCatalog = {
  pro: {
    monthly: { displayPrice: "R$ 29,90", priceKey: "pro_monthly" },
    yearly: { displayPrice: "R$ 23,92", billedPrice: "R$ 287,04", priceKey: "pro_yearly", discountPercent: 20 },
  },
  scale: {
    monthly: { displayPrice: "R$ 59,90", priceKey: "scale_monthly" },
    yearly: { displayPrice: "R$ 44,93", billedPrice: "R$ 539,04", priceKey: "scale_yearly", discountPercent: 25 },
  },
} as const;

export type BillingCycle = "monthly" | "yearly";
export type PriceKey = (typeof planCatalog)[keyof typeof planCatalog][BillingCycle]["priceKey"];
export const monthlyPlanCatalog = {
  pro: planCatalog.pro.monthly,
  scale: planCatalog.scale.monthly,
} as const;
export type MonthlyPriceKey = (typeof monthlyPlanCatalog)[keyof typeof monthlyPlanCatalog]["priceKey"];

function isHexColor(value: string): boolean {
  if (value.length !== 7 || value.charCodeAt(0) !== 35) return false;
  for (let index = 1; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    const digit = code >= 48 && code <= 57;
    const lower = code >= 97 && code <= 102;
    const upper = code >= 65 && code <= 70;
    if (!digit && !lower && !upper) return false;
  }
  return true;
}

export const environmentSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(48),
  color: z.string().refine(isHexColor, "Invalid hex color"),
  riskLevel: z.enum(["low", "medium", "high", "critical"]),
  urlPatterns: z.array(z.string().trim().min(1).max(500)).max(30),
});

export const projectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  accentColor: z.string().refine(isHexColor, "Invalid hex color"),
  environments: z.array(environmentSchema).max(20),
});

export type Environment = z.infer<typeof environmentSchema>;
export type Project = z.infer<typeof projectSchema>;

const entityBaseSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  shortName: z.string().trim().max(32).default(""),
  description: z.string().trim().max(1000).default(""),
  image: z.string().max(700_000).default(""),
  images: z.array(z.object({ id: z.string().uuid(), name: z.string().max(100), description: z.string().max(500).default(""), mimeType: z.enum(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]), source: z.enum(["local", "url"]), value: z.string().max(700_000), preview: z.string().max(700_000).default(""), order: z.number().int().nonnegative(), primary: z.boolean() })).max(20).default([]),
  color: z.string().refine(isHexColor, "Invalid hex color").default("#64748b"),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
  active: z.boolean().default(true),
  order: z.number().int().nonnegative().default(0),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const clientSchema = entityBaseSchema.extend({ notes: z.string().max(5000).default("") });
export const productSchema = entityBaseSchema.extend({ clientId: z.string().uuid(), projectIds: z.array(z.string().uuid()).max(100).default([]), code: z.string().max(40).default(""), kind: z.enum(["country", "bank", "brand", "tenant", "region", "application", "channel", "unit", "other"]).default("other") });
export const qaProjectSchema = entityBaseSchema.extend({ clientId: z.string().uuid(), productIds: z.array(z.string().uuid()).max(100).default([]) });
export const qaEnvironmentSchema = entityBaseSchema.extend({
  projectId: z.string().uuid(), color: z.string().regex(/^#[0-9a-f]{6}$/i),
  riskLevel: z.enum(["low", "medium", "high", "critical"]), urlPatterns: z.array(z.string().min(1).max(500)).max(100),
});
export const testAccountSchema = entityBaseSchema.extend({
  typeId: z.string().uuid().nullable().default(null), email: z.string().email().or(z.literal("")), username: z.string().max(200).default(""),
  password: z.string().max(1000).default(""), inboxUrl: z.string().url().or(z.literal("")), environmentIds: z.array(z.string().uuid()).max(100),
  attributes: z.record(z.string().max(80), z.string().max(2000)).default({}), sensitive: z.boolean().default(true),
});
export const sandboxPaymentMethodSchema = entityBaseSchema.extend({
  provider: z.string().max(80), brand: z.string().max(80), number: z.string().max(40), holder: z.string().max(120),
  cvv: z.string().max(12), expiration: z.string().max(20), scenario: z.string().max(120), environmentIds: z.array(z.string().uuid()).max(100),
});
export const apiDefinitionSchema = entityBaseSchema.extend({ baseUrl: z.string().url(), environmentIds: z.array(z.string().uuid()).max(100), headers: z.record(z.string(), z.string()).default({}) });
export const inspectorDefinitionSchema = entityBaseSchema.extend({ apiId: z.string().uuid().nullable(), pathPattern: z.string().min(1).max(500), enabled: z.boolean().default(true) });
export const accountTypeSchema = entityBaseSchema.extend({ attributeNames: z.array(z.string().max(80)).max(50).default([]) });
export const resourceDefinitionSchema = entityBaseSchema.extend({ projectId: z.string().uuid(), kind: z.string().max(80), url: z.string().url().or(z.literal("")), content: z.string().max(100_000).default("") });

export const localWorkspaceSchema = z.object({
  schemaVersion: z.literal(2), applicationVersion: z.string().min(1), locale: z.enum(["pt-BR", "en", "es"]),
  activeProjectId: z.string().uuid().nullable(), clients: z.array(clientSchema).max(500), projects: z.array(qaProjectSchema).max(1000),
  products: z.array(productSchema).max(1000), environments: z.array(qaEnvironmentSchema).max(2000), accounts: z.array(testAccountSchema).max(5000),
  paymentMethods: z.array(sandboxPaymentMethodSchema).max(1000), apis: z.array(apiDefinitionSchema).max(1000), inspectors: z.array(inspectorDefinitionSchema).max(2000),
  accountTypes: z.array(accountTypeSchema).max(500).default([]), resources: z.array(resourceDefinitionSchema).max(2000).default([]),
  preferences: z.object({ theme: z.string(), colorMode: z.enum(["light", "dark", "system"]), pinnedTools: z.array(z.string()).max(30), language: z.enum(["pt-BR", "en", "es"]) }),
}).strict();
export type LocalWorkspace = z.infer<typeof localWorkspaceSchema>;

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
