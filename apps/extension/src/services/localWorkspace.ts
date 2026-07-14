import { localWorkspaceSchema, redactValue, type LocalWorkspace } from "@qts/domain";

export type ImportMode = "merge" | "replace";
export type ResetScope = "layout" | "toolbar" | "theme" | "project" | "permissions" | "convertio" | "all";
export type WorkspaceExport = { schemaVersion: 2; applicationVersion: string; exportType: "safe" | "complete"; createdAt: string; locale: string; checksum: string; data: unknown };

export function emptyWorkspace(): LocalWorkspace {
  return { schemaVersion: 2, applicationVersion: "0.1.6", locale: "pt-BR", activeProjectId: null, clients: [], projects: [], products: [], environments: [], accounts: [], paymentMethods: [], apis: [], inspectors: [], accountTypes: [], resources: [], preferences: { theme: "red", colorMode: "system", pinnedTools: [], language: "pt-BR" } };
}

export async function exportWorkspace(workspace: LocalWorkspace, type: "safe" | "complete" = "safe"): Promise<WorkspaceExport> {
  const parsed = localWorkspaceSchema.parse(workspace);
  const data = type === "safe" ? redactValue({ ...parsed,
    accounts: parsed.accounts.map((account) => ({ ...account, password: "[REDACTED]" })),
    paymentMethods: parsed.paymentMethods.map((method) => ({ ...method, number: "[REDACTED]", cvv: "[REDACTED]" })),
  }) : parsed;
  return { schemaVersion: 2, applicationVersion: parsed.applicationVersion, exportType: type, createdAt: new Date().toISOString(), locale: parsed.locale, checksum: await checksum(data), data };
}

export async function previewImport(candidate: unknown): Promise<{ workspace: LocalWorkspace; checksumValid: boolean; counts: Record<string, number> }> {
  if (!candidate || typeof candidate !== "object") throw new Error("Arquivo de importação inválido.");
  const envelope = candidate as Partial<WorkspaceExport>;
  if (envelope.schemaVersion !== 2 || !envelope.data) throw new Error("Versão de importação não suportada.");
  const workspace = localWorkspaceSchema.parse(envelope.data);
  const checksumValid = typeof envelope.checksum === "string" && envelope.checksum === await checksum(envelope.data);
  if (!checksumValid) throw new Error("Checksum inválido; o arquivo pode ter sido alterado ou corrompido.");
  return { workspace, checksumValid, counts: { clients: workspace.clients.length, projects: workspace.projects.length, products: workspace.products.length, environments: workspace.environments.length, accounts: workspace.accounts.length, accountTypes: workspace.accountTypes.length, paymentMethods: workspace.paymentMethods.length, apis: workspace.apis.length, inspectors: workspace.inspectors.length, resources: workspace.resources.length } };
}

export function applyImport(current: LocalWorkspace, incoming: LocalWorkspace, mode: ImportMode): { workspace: LocalWorkspace; rollback: LocalWorkspace } {
  const rollback = structuredClone(localWorkspaceSchema.parse(current));
  if (mode === "replace") return { workspace: structuredClone(incoming), rollback };
  const merge = <T extends { id: string }>(left: T[], right: T[]) => [...new Map([...left, ...right].map((item) => [item.id, item])).values()];
  return { workspace: localWorkspaceSchema.parse({ ...current, clients: merge(current.clients, incoming.clients), projects: merge(current.projects, incoming.projects), products: merge(current.products, incoming.products), environments: merge(current.environments, incoming.environments), accounts: merge(current.accounts, incoming.accounts), paymentMethods: merge(current.paymentMethods, incoming.paymentMethods), apis: merge(current.apis, incoming.apis), inspectors: merge(current.inspectors, incoming.inspectors), accountTypes: merge(current.accountTypes, incoming.accountTypes), resources: merge(current.resources, incoming.resources), preferences: { ...current.preferences, ...incoming.preferences } }), rollback };
}

export function resetWorkspace(workspace: LocalWorkspace, scope: ResetScope): LocalWorkspace {
  if (scope === "all") return emptyWorkspace();
  if (scope === "project") return { ...workspace, activeProjectId: null, clients: [], projects: [], products: [], environments: [], accounts: [], paymentMethods: [], apis: [], inspectors: [], accountTypes: [], resources: [] };
  if (scope === "theme") return { ...workspace, preferences: { ...workspace.preferences, theme: "red", colorMode: "system" } };
  if (scope === "toolbar" || scope === "layout") return { ...workspace, preferences: { ...workspace.preferences, pinnedTools: [] } };
  return structuredClone(workspace);
}

async function checksum(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(stableStringify(value));
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
  return JSON.stringify(value);
}
