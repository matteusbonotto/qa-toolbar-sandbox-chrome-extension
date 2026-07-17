const { getWorkspace, saveWorkspace, getSiteScope, saveSiteScope, normalizeWorkspace, normalizeUrlPatterns, onStorageChanged, STORAGE_KEYS } = window.QTS_STORAGE;

let workspace = null;
let accessState = null;
let currentLocale = "pt-BR";
let searchQuery = "";
const revealedAccountIds = new Set();

function t(message, replacements) {
  return window.QTS_OPTIONS_I18N.translateText(message, currentLocale, replacements);
}

const COLLECTION_UI = {
  clients: { listId: "clientList", prefix: "client" },
  projects: { listId: "projectList", prefix: "project" },
  products: { listId: "productList", prefix: "product" },
  environments: { listId: "environmentList", prefix: "environment" },
  testAccounts: { listId: "testAccountList", prefix: "testAccount" },
  paymentMethods: { listId: "paymentMethodList", prefix: "paymentMethod" },
  inspectors: { listId: "inspectorList", prefix: "inspector" },
  apis: { listId: "apiList", prefix: "api" },
  resources: { listId: "resourceList", prefix: "resource" },
};

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function runtimeMessage(message) {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, (response) => resolve(response ?? {})));
}

function switchTab(tabName) {
  if (tabName !== "account" && !accessState?.active) tabName = "account";
  document.querySelectorAll(".navItem").forEach((item) => item.classList.toggle("isActive", item.dataset.tab === tabName));
  document.querySelectorAll(".panel").forEach((panel) => panel.classList.toggle("isActive", panel.dataset.panel === tabName));
}

function showMessage(elementId, message, kind = "") {
  const element = document.getElementById(elementId);
  element.textContent = t(message);
  element.className = `formMessage${kind ? ` is${kind}` : ""}`;
}

async function loadLocale() {
  currentLocale = await window.QTS_I18N.getLocale();
  document.documentElement.lang = currentLocale;
  window.QTS_OPTIONS_I18N.apply(currentLocale);
  document.querySelectorAll("#langSwitch button").forEach((button) => button.classList.toggle("isActive", button.dataset.locale === currentLocale));
}

async function loadAccess(force = false) {
  accessState = await runtimeMessage({ type: "qts:get-access-state", force });
  const active = accessState?.active === true;
  document.querySelectorAll(".protectedNav").forEach((button) => { button.disabled = !active; });
  document.getElementById("signedOutState").hidden = active;
  document.getElementById("signedInState").hidden = !active;
  if (active) {
    document.getElementById("accountEmail").textContent = accessState.user?.email || "Conta autenticada";
    document.getElementById("accountPlan").textContent = accessState.plan?.name || "Acesso ativo";
  } else if (accessState?.authenticated && accessState?.reason === "access_required") {
    showMessage("authMessage", "Sua conta está autenticada, mas ainda não possui acesso ativo.", "Error");
  } else if (accessState?.reason === "access_unavailable") {
    showMessage("authMessage", "Não foi possível validar o acesso agora. Confira a conexão e tente novamente.", "Error");
  }
  if (!active) switchTab("account");
  return active;
}

document.querySelectorAll(".navItem").forEach((item) => item.addEventListener("click", () => switchTab(item.dataset.tab)));
document.querySelectorAll("#langSwitch button").forEach((button) => button.addEventListener("click", async () => {
  await window.QTS_I18N.setLocale(button.dataset.locale); await loadLocale(); renderWorkspace();
}));

document.getElementById("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  showMessage("authMessage", "Validando sua conta…");
  const response = await runtimeMessage({ type: "qts:auth-sign-in", email: document.getElementById("loginEmail").value.trim(), password: document.getElementById("loginPassword").value });
  document.getElementById("loginPassword").value = "";
  button.disabled = false;
  if (!response.ok) {
    const messages = { authentication_failed: "E-mail ou senha inválidos.", rate_limit_exceeded: "Muitas tentativas. Aguarde alguns minutos.", access_required: "Conta válida, mas sem acesso ativo." };
    showMessage("authMessage", messages[response.error] || "Não foi possível entrar. Confira os dados e tente novamente.", "Error");
    return;
  }
  accessState = response.access;
  await loadAccess();
  showMessage("authMessage", "Conta conectada e acesso validado.", "Success");
  switchTab("general");
});

document.getElementById("refreshAccess").addEventListener("click", async () => {
  showMessage("authMessage", "Atualizando acesso…");
  const active = await loadAccess(true);
  showMessage("authMessage", active ? "Acesso atualizado." : "O acesso não está ativo.", active ? "Success" : "Error");
});

document.getElementById("signOutButton").addEventListener("click", async () => {
  await runtimeMessage({ type: "qts:auth-sign-out" });
  accessState = null;
  await loadAccess();
  showMessage("authMessage", "Você saiu. Seus dados locais foram preservados.", "Success");
});

// Scope and toolbar preferences
async function loadScopeUi() {
  const scope = await getSiteScope();
  document.querySelectorAll('input[name="scopeMode"]').forEach((input) => { input.checked = input.value === scope.mode; });
  document.getElementById("scopePatterns").value = (scope.patterns || []).join("\n");
  document.getElementById("scopePatterns").disabled = scope.mode !== "custom";
}
document.querySelectorAll('input[name="scopeMode"]').forEach((input) => input.addEventListener("change", () => {
  document.getElementById("scopePatterns").disabled = input.value !== "custom";
}));
document.getElementById("saveScope").addEventListener("click", async () => {
  const mode = document.querySelector('input[name="scopeMode"]:checked')?.value || "environments";
  const patterns = normalizeUrlPatterns(document.getElementById("scopePatterns").value);
  if (mode === "custom" && !patterns.length) return showMessage("scopeSavedHint", "Adicione ao menos uma URL.", "Error");
  await saveSiteScope({ mode, patterns });
  document.getElementById("scopeSavedHint").textContent = t("Salvo.");
});

function loadPreferenceUi() {
  const preferences = workspace.preferences || {};
  document.getElementById("compactMode").checked = preferences.compactMode === true;
  document.getElementById("pushSiteContent").checked = preferences.pushSiteContent !== false;
  const keyView = preferences.keyView || {};
  document.getElementById("keyViewEnabled").checked = keyView.enabled === true;
  document.getElementById("keyViewTypingMode").checked = keyView.typingMode === true;
  document.getElementById("keyViewMouseEffects").checked = keyView.mouseEffects !== false;
  document.getElementById("keyViewTheme").value = keyView.theme === "light" ? "light" : "dark";
  document.getElementById("keyViewPosition").value = keyView.position || "bottom-center";
  const pinned = new Set(preferences.pinnedTools || []);
  document.querySelectorAll("[data-pinned]").forEach((checkbox) => { checkbox.checked = pinned.has(checkbox.dataset.pinned); });
  const enabledTools = new Set(preferences.enabledTools || window.QTS_STORAGE.DEFAULT_ENABLED_TOOLS);
  document.querySelectorAll("[data-tool]").forEach((checkbox) => { checkbox.checked = enabledTools.has(checkbox.dataset.tool); });
}
document.getElementById("savePreferences").addEventListener("click", async () => {
  workspace.preferences = {
    ...(workspace.preferences || {}),
    compactMode: document.getElementById("compactMode").checked,
    pushSiteContent: document.getElementById("pushSiteContent").checked,
    keyView: {
      enabled: document.getElementById("keyViewEnabled").checked,
      typingMode: document.getElementById("keyViewTypingMode").checked,
      mouseEffects: document.getElementById("keyViewMouseEffects").checked,
      theme: document.getElementById("keyViewTheme").value,
      position: document.getElementById("keyViewPosition").value,
    },
    pinnedTools: [...document.querySelectorAll("[data-pinned]:checked")].map((checkbox) => checkbox.dataset.pinned),
    enabledTools: [...document.querySelectorAll("[data-tool]:checked")].map((checkbox) => checkbox.dataset.tool),
  };
  await persistWorkspace();
  document.getElementById("preferencesSavedHint").textContent = t("Salvo — a barra já foi atualizada.");
});

function findById(collection, id) {
  return (workspace[collection] || []).find((item) => item.id === id);
}

function environmentDisplayName(environment) {
  const product = findById("products", environment.productId);
  return product ? `${product.name} · ${environment.name}` : environment.name;
}

function matchesSearch(item) {
  if (!searchQuery) return true;
  return JSON.stringify(item).toLowerCase().includes(searchQuery);
}

function rowActions(collection, item, { reveal = false } = {}) {
  return `<div class="rowActions">
    ${reveal ? `<button type="button" data-action="reveal" data-collection="${collection}" data-id="${escapeHtml(item.id)}" title="${escapeHtml(t("Mostrar/ocultar senha"))}">${escapeHtml(t(revealedAccountIds.has(item.id) ? "Ocultar" : "Ver"))}</button>` : ""}
    <button type="button" data-action="edit" data-collection="${collection}" data-id="${escapeHtml(item.id)}" title="${escapeHtml(t("Editar"))}">${escapeHtml(t("Editar"))}</button>
    <button type="button" data-action="duplicate" data-collection="${collection}" data-id="${escapeHtml(item.id)}" title="${escapeHtml(t("Duplicar"))}">${escapeHtml(t("Duplicar"))}</button>
    <button type="button" data-action="toggle" data-collection="${collection}" data-id="${escapeHtml(item.id)}" title="${escapeHtml(t("Ativar/desativar"))}">${escapeHtml(t(item.active === false ? "Ativar" : "Pausar"))}</button>
    <button type="button" data-action="remove" data-collection="${collection}" data-id="${escapeHtml(item.id)}" title="${escapeHtml(t("Excluir"))}">${escapeHtml(t("Excluir"))}</button>
  </div>`;
}

function renderRows(collection, formatter, options = {}) {
  const element = document.getElementById(COLLECTION_UI[collection].listId);
  const items = (workspace[collection] || []).filter(matchesSearch);
  if (!items.length) { element.innerHTML = `<div class="listEmpty">${escapeHtml(t(searchQuery ? "Nenhum resultado." : "Nada cadastrado ainda."))}</div>`; return; }
  element.innerHTML = items.map((item) => `<div class="listRow${item.active === false ? " isInactive" : ""}" data-id="${escapeHtml(item.id)}"><div>${formatter(item)}</div>${rowActions(collection, item, { reveal: options.reveal?.(item) })}</div>`).join("");
}

function renderSelect(selectId, items, placeholder) {
  const select = document.getElementById(selectId);
  const current = select.value;
  select.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>${items.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("")}`;
  if (items.some((item) => item.id === current)) select.value = current;
}

function renderWorkspace() {
  for (const [collection, countId] of Object.entries({ clients: "clientCount", projects: "projectCount", products: "productCount", environments: "environmentCount", testAccounts: "testAccountCount", paymentMethods: "paymentMethodCount", inspectors: "inspectorCount", apis: "apiCount", resources: "resourceCount" })) {
    document.getElementById(countId).textContent = String((workspace[collection] || []).length);
  }
  const badge = (entity) => window.QTS_AVATAR.buildEntityHtml(entity, { size: 22 });
  renderRows("clients", (item) => `<b>${badge(item)}</b>`);
  renderRows("projects", (item) => `<b>${badge(item)}</b><small>${escapeHtml(findById("clients", item.clientId)?.name || "—")}</small>`);
  renderRows("products", (item) => `<b>${badge(item)}</b><small>${escapeHtml(findById("projects", item.projectId)?.name || "—")}</small>`);
  renderRows("environments", (item) => `<b style="color:${escapeHtml(item.color)}">● ${escapeHtml(item.name)}</b><small>${escapeHtml(findById("products", item.productId)?.name || "—")} · ${escapeHtml((item.urlPatterns || []).join(", "))}</small>`);
  renderRows("testAccounts", (item) => {
    const password = item.password ? (revealedAccountIds.has(item.id) ? escapeHtml(item.password) : "••••••••") : "—";
    return `<b>${escapeHtml(item.label)}${item.accountType ? ` <span class="accountType">${escapeHtml(item.accountType)}</span>` : ""}</b><small>${escapeHtml(environmentDisplayName(findById("environments", item.environmentId) || {}))} · ${escapeHtml(item.username || "—")} · ${password}</small>`;
  }, { reveal: (item) => Boolean(item.password) });
  renderRows("paymentMethods", (item) => `<b>${escapeHtml(item.label)}</b><small>${escapeHtml(t(item.type || "other"))} · ${escapeHtml(t(item.value ? "valor protegido" : "sem valor"))} · ${escapeHtml(item.environmentId ? environmentDisplayName(findById("environments", item.environmentId) || {}) : t("Todos os ambientes"))} · ${escapeHtml(item.notes || "")}</small>`);
  renderRows("inspectors", (item) => `<b>${escapeHtml(item.label)}</b><small>${escapeHtml((item.patterns || []).join(", "))}</small>`);
  renderRows("apis", (item) => `<b>${escapeHtml(item.label)}</b><small>${escapeHtml(item.baseUrl || "—")} · ${escapeHtml(t(item.token ? "token local configurado" : "sem token"))}</small>`);
  renderRows("resources", (item) => `<b>${escapeHtml(item.label)}</b><small>${escapeHtml(item.url || "—")}</small>`);
  renderSelect("projectClient", workspace.clients, t("Selecione o cliente"));
  renderSelect("productProject", workspace.projects, t("Selecione o projeto"));
  renderSelect("environmentProduct", workspace.products, t("Selecione o produto"));
  renderSelect("testAccountEnvironment", workspace.environments.map((item) => ({ id: item.id, name: environmentDisplayName(item) })), t("Selecione o ambiente"));
  renderSelect("paymentMethodEnvironment", workspace.environments.map((item) => ({ id: item.id, name: environmentDisplayName(item) })), t("Todos os ambientes"));
  loadPreferenceUi();
  window.QTS_OPTIONS_I18N.apply(currentLocale);
}

async function persistWorkspace() {
  workspace = await saveWorkspace(workspace);
  renderWorkspace();
}

document.getElementById("workspaceSearch").addEventListener("input", (event) => { searchQuery = event.target.value.trim().toLowerCase(); renderWorkspace(); });

function appearance(prefix) {
  const logoUrl = document.getElementById(`${prefix}LogoUrl`).value.trim();
  const abbreviation = document.getElementById(`${prefix}Abbreviation`).value.trim().toUpperCase();
  return { ...(logoUrl ? { logoUrl } : {}), ...(abbreviation ? { abbreviation } : {}), showLabel: document.getElementById(`${prefix}ShowLabel`).checked, active: true };
}

function upsert(collection, item, editId) {
  if (editId) workspace[collection] = workspace[collection].map((existing) => existing.id === editId ? { ...existing, ...item, id: editId } : existing);
  else workspace[collection].push(item);
}

function clearEdit(prefix) {
  const form = document.getElementById(`${prefix}Form`);
  form.reset();
  document.getElementById(`${prefix}EditId`).value = "";
  form.querySelector(`[data-cancel="${prefix}"]`).hidden = true;
  const showLabel = document.getElementById(`${prefix}ShowLabel`); if (showLabel) showLabel.checked = true;
  if (prefix === "environment") document.getElementById("environmentColor").value = "#3a3a3a";
}
document.querySelectorAll(".cancelEdit").forEach((button) => button.addEventListener("click", () => clearEdit(button.dataset.cancel)));

document.getElementById("clientForm").addEventListener("submit", async (event) => { event.preventDefault(); const editId = document.getElementById("clientEditId").value; upsert("clients", { id: editId || uid("client"), name: document.getElementById("clientName").value.trim(), ...appearance("client") }, editId); clearEdit("client"); await persistWorkspace(); });
document.getElementById("projectForm").addEventListener("submit", async (event) => { event.preventDefault(); const editId = document.getElementById("projectEditId").value; upsert("projects", { id: editId || uid("project"), clientId: document.getElementById("projectClient").value, name: document.getElementById("projectName").value.trim(), ...appearance("project") }, editId); clearEdit("project"); await persistWorkspace(); });
document.getElementById("productForm").addEventListener("submit", async (event) => { event.preventDefault(); const editId = document.getElementById("productEditId").value; upsert("products", { id: editId || uid("product"), projectId: document.getElementById("productProject").value, name: document.getElementById("productName").value.trim(), ...appearance("product") }, editId); clearEdit("product"); await persistWorkspace(); });
document.getElementById("environmentForm").addEventListener("submit", async (event) => { event.preventDefault(); const editId = document.getElementById("environmentEditId").value; const productId = document.getElementById("environmentProduct").value; const product = findById("products", productId); const project = findById("projects", product?.projectId); upsert("environments", { id: editId || uid("env"), productId, projectId: project?.id, clientId: project?.clientId, name: document.getElementById("environmentName").value.trim(), color: document.getElementById("environmentColor").value, urlPatterns: normalizeUrlPatterns(document.getElementById("environmentPatterns").value), active: true }, editId); clearEdit("environment"); await persistWorkspace(); });

document.getElementById("testAccountForm").addEventListener("submit", async (event) => { event.preventDefault(); const editId = document.getElementById("testAccountEditId").value; const existing = findById("testAccounts", editId); const password = document.getElementById("testAccountPassword").value; upsert("testAccounts", { id: editId || uid("account"), environmentId: document.getElementById("testAccountEnvironment").value, label: document.getElementById("testAccountLabel").value.trim(), accountType: document.getElementById("testAccountType").value.trim(), username: document.getElementById("testAccountUsername").value.trim(), password: password || existing?.password || "", notes: document.getElementById("testAccountNotes").value.trim(), active: true }, editId); clearEdit("testAccount"); await persistWorkspace(); });
document.getElementById("paymentMethodForm").addEventListener("submit", async (event) => { event.preventDefault(); const editId = document.getElementById("paymentMethodEditId").value; const existing = findById("paymentMethods", editId); upsert("paymentMethods", { id: editId || uid("payment"), environmentId: document.getElementById("paymentMethodEnvironment").value || null, label: document.getElementById("paymentMethodLabel").value.trim(), type: document.getElementById("paymentMethodType").value, value: document.getElementById("paymentMethodValue").value.trim() || existing?.value || "", notes: document.getElementById("paymentMethodNotes").value.trim(), active: true }, editId); clearEdit("paymentMethod"); await persistWorkspace(); });
document.getElementById("inspectorForm").addEventListener("submit", async (event) => { event.preventDefault(); const editId = document.getElementById("inspectorEditId").value; upsert("inspectors", { id: editId || uid("inspector"), label: document.getElementById("inspectorLabel").value.trim(), patterns: document.getElementById("inspectorPatterns").value.split(/\n|,/).map((v) => v.trim()).filter(Boolean), active: true }, editId); clearEdit("inspector"); await persistWorkspace(); });
document.getElementById("apiForm").addEventListener("submit", async (event) => { event.preventDefault(); const editId = document.getElementById("apiEditId").value; const existing = findById("apis", editId); upsert("apis", { id: editId || uid("api"), label: document.getElementById("apiLabel").value.trim(), baseUrl: document.getElementById("apiBaseUrl").value.trim(), token: document.getElementById("apiToken").value || existing?.token || "", active: true }, editId); clearEdit("api"); await persistWorkspace(); });
document.getElementById("resourceForm").addEventListener("submit", async (event) => { event.preventDefault(); const editId = document.getElementById("resourceEditId").value; upsert("resources", { id: editId || uid("resource"), label: document.getElementById("resourceLabel").value.trim(), url: document.getElementById("resourceUrl").value.trim(), active: true }, editId); clearEdit("resource"); await persistWorkspace(); });

function editItem(collection, item) {
  const prefix = COLLECTION_UI[collection].prefix;
  document.getElementById(`${prefix}EditId`).value = item.id;
  document.querySelector(`[data-cancel="${prefix}"]`).hidden = false;
  const values = {
    clients: { clientName: item.name, clientLogoUrl: item.logoUrl, clientAbbreviation: item.abbreviation, clientShowLabel: item.showLabel !== false },
    projects: { projectClient: item.clientId, projectName: item.name, projectLogoUrl: item.logoUrl, projectAbbreviation: item.abbreviation, projectShowLabel: item.showLabel !== false },
    products: { productProject: item.projectId, productName: item.name, productLogoUrl: item.logoUrl, productAbbreviation: item.abbreviation, productShowLabel: item.showLabel !== false },
    environments: { environmentProduct: item.productId, environmentName: item.name, environmentColor: item.color, environmentPatterns: (item.urlPatterns || []).join("\n") },
    testAccounts: { testAccountEnvironment: item.environmentId, testAccountLabel: item.label, testAccountType: item.accountType, testAccountUsername: item.username, testAccountPassword: "", testAccountNotes: item.notes },
    paymentMethods: { paymentMethodEnvironment: item.environmentId || "", paymentMethodLabel: item.label, paymentMethodType: item.type, paymentMethodValue: "", paymentMethodNotes: item.notes },
    inspectors: { inspectorLabel: item.label, inspectorPatterns: (item.patterns || []).join("\n") },
    apis: { apiLabel: item.label, apiBaseUrl: item.baseUrl, apiToken: "" },
    resources: { resourceLabel: item.label, resourceUrl: item.url },
  }[collection];
  for (const [elementId, value] of Object.entries(values || {})) {
    const element = document.getElementById(elementId);
    if (element.type === "checkbox") element.checked = Boolean(value); else element.value = value ?? "";
  }
  document.getElementById(`${prefix}Form`).scrollIntoView({ behavior: "smooth", block: "center" });
}

function cascadeRemove(collection, removeId) {
  const removeSet = (key, predicate) => { workspace[key] = workspace[key].filter((item) => !predicate(item)); };
  if (collection === "clients") { const projectIds = new Set(workspace.projects.filter((item) => item.clientId === removeId).map((item) => item.id)); const productIds = new Set(workspace.products.filter((item) => projectIds.has(item.projectId)).map((item) => item.id)); const envIds = new Set(workspace.environments.filter((item) => productIds.has(item.productId)).map((item) => item.id)); removeSet("projects", (item) => projectIds.has(item.id)); removeSet("products", (item) => productIds.has(item.id)); removeSet("environments", (item) => envIds.has(item.id)); removeSet("testAccounts", (item) => envIds.has(item.environmentId)); removeSet("paymentMethods", (item) => envIds.has(item.environmentId)); }
  if (collection === "projects") { const productIds = new Set(workspace.products.filter((item) => item.projectId === removeId).map((item) => item.id)); const envIds = new Set(workspace.environments.filter((item) => productIds.has(item.productId)).map((item) => item.id)); removeSet("products", (item) => productIds.has(item.id)); removeSet("environments", (item) => envIds.has(item.id)); removeSet("testAccounts", (item) => envIds.has(item.environmentId)); removeSet("paymentMethods", (item) => envIds.has(item.environmentId)); }
  if (collection === "products") { const envIds = new Set(workspace.environments.filter((item) => item.productId === removeId).map((item) => item.id)); removeSet("environments", (item) => envIds.has(item.id)); removeSet("testAccounts", (item) => envIds.has(item.environmentId)); removeSet("paymentMethods", (item) => envIds.has(item.environmentId)); }
  if (collection === "environments") { removeSet("testAccounts", (item) => item.environmentId === removeId); removeSet("paymentMethods", (item) => item.environmentId === removeId); }
  removeSet(collection, (item) => item.id === removeId);
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action][data-collection][data-id]");
  if (!button) return;
  const { action, collection, id } = button.dataset;
  const item = findById(collection, id);
  if (!item) return;
  if (action === "reveal") { revealedAccountIds.has(id) ? revealedAccountIds.delete(id) : revealedAccountIds.add(id); renderWorkspace(); return; }
  if (action === "edit") { editItem(collection, item); return; }
  if (action === "duplicate") { workspace[collection].push({ ...structuredClone(item), id: uid(COLLECTION_UI[collection].prefix), name: item.name ? `${item.name} (${t("cópia")})` : undefined, label: item.label ? `${item.label} (${t("cópia")})` : undefined }); await persistWorkspace(); return; }
  if (action === "toggle") { item.active = item.active === false; await persistWorkspace(); return; }
  if (action === "remove") { if (!confirm(t("Excluir este item? Itens dependentes também serão removidos."))) return; cascadeRemove(collection, id); await persistWorkspace(); }
});

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

document.getElementById("exportButton").addEventListener("click", async () => {
  const exportable = structuredClone(workspace);
  exportable.testAccounts = exportable.testAccounts.map(({ password, ...item }) => item);
  exportable.paymentMethods = exportable.paymentMethods.map(({ value, ...item }) => item);
  exportable.apis = exportable.apis.map(({ token, ...item }) => item);
  const checksum = `sha256:${await sha256Hex(JSON.stringify(exportable))}`;
  const blob = new Blob([JSON.stringify({ format: "qts-workspace", version: 2, exportedAt: new Date().toISOString(), checksum, workspace: exportable }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `qa-toolbar-workspace-${new Date().toISOString().slice(0, 10)}.json`; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 5_000);
});
document.getElementById("importButton").addEventListener("click", () => document.getElementById("importFile").click());
document.getElementById("importFile").addEventListener("change", async (event) => {
  const file = event.target.files?.[0]; if (!file) return;
  const previousWorkspace = workspace;
  try {
    if (file.size > 2_000_000) throw new Error("arquivo acima de 2 MB");
    const parsed = JSON.parse(await file.text());
    const candidate = parsed?.format === "qts-workspace" ? parsed.workspace : parsed;
    if (!candidate || typeof candidate !== "object" || !Array.isArray(candidate.clients)) throw new Error("formato inválido");
    if (parsed?.format === "qts-workspace" && Number(parsed.version) >= 2) {
      if (!/^sha256:[a-f0-9]{64}$/i.test(String(parsed.checksum || ""))) throw new Error("checksum ausente ou inválido");
      const actualChecksum = `sha256:${await sha256Hex(JSON.stringify(candidate))}`;
      if (actualChecksum !== String(parsed.checksum).toLowerCase()) throw new Error("checksum não confere; o arquivo pode ter sido alterado");
    }
    workspace = normalizeWorkspace(candidate);
    await persistWorkspace();
    document.getElementById("dataHint").textContent = t("Importado: {clients} cliente(s), {environments} ambiente(s). URLs e vínculos foram normalizados.", { clients: workspace.clients.length, environments: workspace.environments.length });
  } catch (error) { workspace = previousWorkspace; renderWorkspace(); document.getElementById("dataHint").textContent = t("Falha ao importar: {error}. O workspace anterior foi preservado.", { error: t(error.message) }); }
  event.target.value = "";
});
document.getElementById("resetButton").addEventListener("click", async () => {
  if (!confirm(t("Apagar somente o workspace local? Sua conta e assinatura não serão removidas."))) return;
  workspace = window.QTS_STORAGE.createEmptyWorkspace(); await persistWorkspace(); document.getElementById("dataHint").textContent = t("Workspace local resetado.");
});

(async () => {
  await loadLocale();
  workspace = await getWorkspace();
  await loadScopeUi();
  renderWorkspace();
  await loadAccess(true);
  onStorageChanged(async (changes) => {
    if (!changes[STORAGE_KEYS.workspace]) return;
    workspace = await getWorkspace();
    renderWorkspace();
  });
})();
