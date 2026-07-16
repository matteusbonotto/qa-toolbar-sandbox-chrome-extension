import type { LocalWorkspace } from "@qts/domain";
import { urlMatchesAny } from "./workspace";

export interface ToolbarContext {
  clientName: string;
  clientImage: string;
  projectName: string;
  projectImage: string;
  productName: string;
  productImage: string;
  environmentName: string;
  environmentColor: string;
  domain: string;
}

export function resolveToolbarContext(workspace: LocalWorkspace, pageUrl: string): ToolbarContext | null {
  const activeProjects = workspace.projects.filter((project) => project.active);
  const preferred = activeProjects.find((project) => project.id === workspace.activeProjectId);
  const candidates = preferred ? [preferred, ...activeProjects.filter((project) => project.id !== preferred.id)] : activeProjects;
  for (const project of candidates) {
    const environment = workspace.environments
      .filter((item) => item.active && item.projectId === project.id)
      .find((item) => urlMatchesAny(pageUrl, item.urlPatterns));
    if (!environment) continue;
    const client = workspace.clients.find((item) => item.id === project.clientId && item.active);
    const product = workspace.products.find((item) => item.active && (item.projectIds.includes(project.id) || project.productIds.includes(item.id)));
    return {
      clientName: client?.shortName || client?.name || "QA",
      clientImage: client?.image || "",
      projectName: project.shortName || project.name,
      projectImage: project.image || "",
      productName: product?.shortName || product?.name || "",
      productImage: product?.image || "",
      environmentName: environment.shortName || environment.name,
      environmentColor: environment.color,
      domain: new URL(pageUrl).hostname,
    };
  }
  return null;
}
