const { getWorkspace, saveWorkspace, getSiteScope, saveSiteScope } = window.QTS_STORAGE;

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function switchTab(tabName) {
  document.querySelectorAll(".navItem").forEach((item) => item.classList.toggle("isActive", item.dataset.tab === tabName));
  document.querySelectorAll(".panel").forEach((panel) => panel.classList.toggle("isActive", panel.dataset.panel === tabName));
}

document.querySelectorAll(".navItem").forEach((item) => item.addEventListener("click", () => switchTab(item.dataset.tab)));

// ---------- Site scope ----------
async function loadScopeUi() {
  const scope = await getSiteScope();
  document.querySelectorAll('input[name="scopeMode"]').forEach((input) => { input.checked = input.value === scope.mode; });
  document.getElementById("scopePatterns").value = (scope.patterns || []).join("\n");
  document.getElementById("scopePatterns").disabled = scope.mode !== "custom";
}

document.querySelectorAll('input[name="scopeMode"]').forEach((input) => {
  input.addEventListener("change", () => {
    document.getElementById("scopePatterns").disabled = input.value !== "custom";
  });
});

document.getElementById("saveScope").addEventListener("click", async () => {
  const mode = document.querySelector('input[name="scopeMode"]:checked')?.value || "all";
  const patterns = document.getElementById("scopePatterns").value.split("\n").map((line) => line.trim()).filter(Boolean);
  await saveSiteScope({ mode, patterns });
  const hint = document.getElementById("scopeSavedHint");
  hint.textContent = "Salvo — recarregue as páginas abertas para aplicar.";
  window.setTimeout(() => { hint.textContent = ""; }, 3000);
});

// ---------- Workspace ----------
let workspace = null;

function renderList(listElementId, items, formatter) {
  const el = document.getElementById(listElementId);
  if (!items.length) {
    el.innerHTML = `<div class="listEmpty">Nada criado ainda.</div>`;
    return;
  }
  el.innerHTML = items.map((item) => `
    <div class="listRow" data-id="${escapeHtml(item.id)}">
      <div>${formatter(item)}</div>
      <button type="button" data-remove="${escapeHtml(item.id)}">Remover</button>
    </div>
  `).join("");
}

function renderSelect(selectId, items, placeholder) {
  const select = document.getElementById(selectId);
  const current = select.value;
  select.innerHTML = `<option value="" disabled ${!current ? "selected" : ""}>${placeholder}</option>` +
    items.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("");
  if (items.some((item) => item.id === current)) select.value = current;
}

function renderWorkspace() {
  document.getElementById("clientCount").textContent = String(workspace.clients.length);
  document.getElementById("projectCount").textContent = String(workspace.projects.length);
  document.getElementById("productCount").textContent = String(workspace.products.length);
  document.getElementById("environmentCount").textContent = String(workspace.environments.length);

  renderList("clientList", workspace.clients, (client) => `<b>${escapeHtml(client.name)}</b>`);
  renderList("projectList", workspace.projects, (project) => {
    const client = workspace.clients.find((c) => c.id === project.clientId);
    return `<b>${escapeHtml(project.name)}</b><small>${escapeHtml(client?.name || "—")}</small>`;
  });
  renderList("productList", workspace.products, (product) => {
    const project = workspace.projects.find((p) => p.id === product.projectId);
    return `<b>${escapeHtml(product.name)}</b><small>${escapeHtml(project?.name || "—")}</small>`;
  });
  renderList("environmentList", workspace.environments, (environment) => {
    const product = workspace.products.find((p) => p.id === environment.productId);
    return `<b style="color:${escapeHtml(environment.color)}">● ${escapeHtml(environment.name)}</b><small>${escapeHtml(product?.name || "—")} · ${escapeHtml((environment.urlPatterns || []).join(", "))}</small>`;
  });

  renderSelect("projectClient", workspace.clients, "Selecione o cliente");
  renderSelect("productProject", workspace.projects, "Selecione o projeto");
  renderSelect("environmentProduct", workspace.products, "Selecione o produto");
}

async function persistWorkspace() {
  workspace = await saveWorkspace(workspace);
  renderWorkspace();
}

document.addEventListener("click", async (event) => {
  const removeId = event.target?.dataset?.remove;
  if (!removeId) return;
  const row = event.target.closest(".listRow");
  const listId = row?.parentElement?.id;
  const collectionByList = { clientList: "clients", projectList: "projects", productList: "products", environmentList: "environments" };
  const collectionKey = collectionByList[listId];
  if (!collectionKey) return;
  workspace[collectionKey] = workspace[collectionKey].filter((item) => item.id !== removeId);
  await persistWorkspace();
});

document.getElementById("clientForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = document.getElementById("clientName").value.trim();
  if (!name) return;
  workspace.clients.push({ id: uid("client"), name });
  document.getElementById("clientName").value = "";
  await persistWorkspace();
});

document.getElementById("projectForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const clientId = document.getElementById("projectClient").value;
  const name = document.getElementById("projectName").value.trim();
  if (!clientId || !name) return;
  workspace.projects.push({ id: uid("project"), clientId, name });
  document.getElementById("projectName").value = "";
  await persistWorkspace();
});

document.getElementById("productForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const projectId = document.getElementById("productProject").value;
  const name = document.getElementById("productName").value.trim();
  if (!projectId || !name) return;
  workspace.products.push({ id: uid("product"), projectId, name });
  document.getElementById("productName").value = "";
  await persistWorkspace();
});

document.getElementById("environmentForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const productId = document.getElementById("environmentProduct").value;
  const name = document.getElementById("environmentName").value.trim();
  const color = document.getElementById("environmentColor").value;
  const urlPatterns = document.getElementById("environmentPatterns").value.split(",").map((value) => value.trim()).filter(Boolean);
  if (!productId || !name || !urlPatterns.length) return;
  const product = workspace.products.find((p) => p.id === productId);
  const project = workspace.projects.find((p) => p.id === product?.projectId);
  workspace.environments.push({ id: uid("env"), productId, projectId: project?.id ?? null, clientId: project?.clientId ?? null, name, color, urlPatterns });
  document.getElementById("environmentName").value = "";
  document.getElementById("environmentPatterns").value = "";
  await persistWorkspace();
});

// ---------- Import / export / reset ----------
document.getElementById("exportButton").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(workspace, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `qa-toolbar-workspace-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
});

document.getElementById("importButton").addEventListener("click", () => document.getElementById("importFile").click());

document.getElementById("importFile").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  const hint = document.getElementById("dataHint");
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.clients)) throw new Error("Formato inválido");
    workspace = { ...window.QTS_STORAGE.createEmptyWorkspace(), ...parsed };
    await persistWorkspace();
    hint.textContent = "Workspace importado com sucesso.";
  } catch (error) {
    hint.textContent = `Falha ao importar: ${error.message}`;
  }
  event.target.value = "";
});

document.getElementById("resetButton").addEventListener("click", async () => {
  if (!window.confirm("Isso apaga todo o workspace local (clientes, projetos, ambientes, contas). Continuar?")) return;
  workspace = window.QTS_STORAGE.createEmptyWorkspace();
  await persistWorkspace();
  document.getElementById("dataHint").textContent = "Workspace resetado.";
});

// ---------- Boot ----------
(async () => {
  await loadScopeUi();
  workspace = await getWorkspace();
  renderWorkspace();
})();
