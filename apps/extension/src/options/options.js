const { getWorkspace, saveWorkspace, getSiteScope, saveSiteScope, normalizeWorkspace, normalizeUrlPatterns, onStorageChanged, STORAGE_KEYS } = window.QTS_STORAGE;
const ICON = window.QTS_ICONS.svg;

let imageEditorTarget = null;
let imageEditorImage = null;

function drawImageEditorPreview() {
  const canvas = document.getElementById("imageEditorCanvas");
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#0c0e14";
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (!imageEditorImage?.naturalWidth) return;
  const zoom = Number(document.getElementById("imageEditorZoom").value) || 1;
  const baseScale = Math.max(canvas.width / imageEditorImage.naturalWidth, canvas.height / imageEditorImage.naturalHeight);
  const width = imageEditorImage.naturalWidth * baseScale * zoom;
  const height = imageEditorImage.naturalHeight * baseScale * zoom;
  const xRange = Math.max(0, (width - canvas.width) / 2);
  const yRange = Math.max(0, (height - canvas.height) / 2);
  const x = (canvas.width - width) / 2 + xRange * (Number(document.getElementById("imageEditorX").value) / 100);
  const y = (canvas.height - height) / 2 + yRange * (Number(document.getElementById("imageEditorY").value) / 100);
  context.drawImage(imageEditorImage, x, y, width, height);
}

function openImageEditor(target) {
  const source = target.value.trim();
  if (!source) return;
  const dialog = document.getElementById("imageEditorDialog");
  const hint = document.getElementById("imageEditorHint");
  imageEditorTarget = target;
  imageEditorImage = new Image();
  if (/^https?:/i.test(source)) imageEditorImage.crossOrigin = "anonymous";
  hint.textContent = t("Carregando imagem…");
  document.getElementById("imageEditorApply").disabled = true;
  imageEditorImage.onload = () => {
    hint.textContent = t("A prévia já representa o recorte final usado na barra.");
    document.getElementById("imageEditorApply").disabled = false;
    drawImageEditorPreview();
  };
  imageEditorImage.onerror = () => { hint.textContent = t("Não foi possível editar esta URL. Use upload ou uma imagem que permita acesso CORS."); };
  imageEditorImage.src = source;
  ["imageEditorZoom", "imageEditorX", "imageEditorY"].forEach((id) => { document.getElementById(id).value = id === "imageEditorZoom" ? "1" : "0"; });
  dialog.showModal();
}

// URL-vs-upload toggle for logo/image fields: both modes write into the same underlying
// [data-image-url] input, so every existing reader of that field's .value (appearance(), the
// test-account form) keeps working unchanged regardless of which mode produced the value.
function wireImageUpload(group) {
  const urlInput = group.querySelector("[data-image-url]");
  const fileInput = group.querySelector("[data-image-file]");
  const modeButtons = group.querySelectorAll("[data-image-mode]");
  const editButton = document.createElement("button");
  editButton.type = "button";
  editButton.className = "button imageEditButton";
  editButton.textContent = "Ajustar";
  editButton.disabled = !urlInput.value;
  group.appendChild(editButton);
  const setMode = (mode) => {
    group.dataset.mode = mode;
    modeButtons.forEach((button) => button.classList.toggle("isActive", button.dataset.imageMode === mode));
    if (mode === "file") fileInput.click();
  };
  modeButtons.forEach((button) => button.addEventListener("click", () => setMode(button.dataset.imageMode)));
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) { setMode("url"); return; }
    const reader = new FileReader();
    reader.onload = () => { urlInput.value = String(reader.result || ""); editButton.disabled = !urlInput.value; };
    reader.readAsDataURL(file);
  });
  urlInput.addEventListener("input", () => { editButton.disabled = !urlInput.value.trim(); });
  editButton.addEventListener("click", () => openImageEditor(urlInput));
}
document.querySelectorAll("[data-image-group]").forEach(wireImageUpload);

document.querySelectorAll("#imageEditorZoom,#imageEditorX,#imageEditorY").forEach((input) => input.addEventListener("input", drawImageEditorPreview));
document.getElementById("imageEditorReset").addEventListener("click", () => {
  document.getElementById("imageEditorZoom").value = "1";
  document.getElementById("imageEditorX").value = "0";
  document.getElementById("imageEditorY").value = "0";
  drawImageEditorPreview();
});
document.getElementById("imageEditorClose").addEventListener("click", () => document.getElementById("imageEditorDialog").close());
document.getElementById("imageEditorApply").addEventListener("click", () => {
  try {
    imageEditorTarget.value = document.getElementById("imageEditorCanvas").toDataURL("image/webp", 0.9);
    imageEditorTarget.dispatchEvent(new Event("input", { bubbles: true }));
    document.getElementById("imageEditorDialog").close();
  } catch {
    document.getElementById("imageEditorHint").textContent = t("O navegador bloqueou o recorte desta URL. Baixe a imagem e use Upload.");
  }
});

let workspace = null;
let accessState = null;
let currentLocale = "pt-BR";
let searchQuery = "";
let activeWorkspaceTab = "structure";
const revealedAccountIds = new Set();

function t(message, replacements) {
  return window.QTS_OPTIONS_I18N.translateText(message, currentLocale, replacements);
}

const COLLECTION_UI = {
  clients: { listId: "clientList", prefix: "client" },
  projects: { listId: "projectList", prefix: "project" },
  products: { listId: "productList", prefix: "product" },
  environments: { listId: "environmentList", prefix: "environment" },
  urlBindings: { listId: "urlRelationList", prefix: "urlRelation" },
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

const NAV_WORKSPACE_ROUTES = Object.freeze({ workspace: "structure", "test-data": "accounts", integrations: "integrations" });

function activateWorkspaceTab(tabName, { syncNavigation = false } = {}) {
  const target = document.querySelector(`[data-workspace-pane="${tabName}"]`) ? tabName : "structure";
  activeWorkspaceTab = target;
  document.querySelectorAll(".workspaceTab").forEach((item) => {
    const active = item.dataset.workspaceTab === target;
    item.classList.toggle("isActive", active);
    item.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll(".workspacePane").forEach((pane) => pane.classList.toggle("isActive", pane.dataset.workspacePane === target));
  if (syncNavigation) document.querySelectorAll(".navItem").forEach((item) => item.classList.toggle("isActive", item.dataset.tab === "workspace"));
}

function switchTab(tabName) {
  if (tabName !== "account" && !accessState?.active) tabName = "account";
  document.querySelectorAll(".navItem").forEach((item) => item.classList.toggle("isActive", item.dataset.tab === tabName));
  const workspaceRoute = NAV_WORKSPACE_ROUTES[tabName];
  const panelName = workspaceRoute ? "workspace" : tabName;
  document.querySelectorAll(".panel").forEach((panel) => panel.classList.toggle("isActive", panel.dataset.panel === panelName));
  if (workspaceRoute) activateWorkspaceTab(workspaceRoute);
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
  loadPreferenceUi(); // keeps the Key View plan-gate hint in sync with the freshest access state
  return active;
}

document.querySelectorAll(".navItem").forEach((item) => item.addEventListener("click", () => switchTab(item.dataset.tab)));
document.querySelectorAll(".workspaceTab").forEach((item) => item.addEventListener("click", () => activateWorkspaceTab(item.dataset.workspaceTab, { syncNavigation: true })));
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

document.getElementById("forgotPasswordButton").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const email = document.getElementById("loginEmail").value.trim();
  if (!email) {
    showMessage("authMessage", "Informe seu e-mail acima para receber o link de redefinição.", "Error");
    return;
  }
  button.disabled = true;
  showMessage("authMessage", "Enviando link de redefinição…");
  const response = await runtimeMessage({ type: "qts:auth-recover-password", email });
  button.disabled = false;
  showMessage(
    "authMessage",
    response.ok ? "Se essa conta existir, enviamos um link de redefinição de senha para o e-mail cadastrado." : "Não foi possível enviar o link agora. Tente novamente em instantes.",
    response.ok ? "Success" : "Error",
  );
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

function hasKeyViewPlanAccess() {
  return accessState?.features?.["keyView.enabled"] === true;
}

function loadPreferenceUi() {
  const preferences = workspace.preferences || {};
  document.getElementById("compactMode").checked = preferences.compactMode === true;
  const compactEntities = preferences.compactEntities || { project: preferences.compactMode === true, product: preferences.compactMode === true };
  document.querySelectorAll("[data-compact-entity]").forEach((checkbox) => { checkbox.checked = compactEntities[checkbox.dataset.compactEntity] === true; });
  document.getElementById("pushSiteContent").checked = preferences.pushSiteContent !== false;
  document.getElementById("soundEffects").checked = preferences.soundEffects !== false;
  document.getElementById("avatarShape").value = preferences.avatarShape === "round" ? "round" : "square";
  const keyView = preferences.keyView || {};
  document.getElementById("keyViewEnabled").checked = keyView.enabled === true;
  document.getElementById("keyViewTypingMode").checked = keyView.typingMode === true;
  document.getElementById("keyViewMouseEffects").checked = keyView.mouseEffects !== false;
  document.getElementById("keyViewTheme").value = keyView.theme === "light" ? "light" : "dark";
  document.getElementById("keyViewPosition").value = keyView.position || "bottom-center";
  document.getElementById("keyViewKeySize").value = keyView.keySize || "medium";
  document.getElementById("keyViewMouseSize").value = keyView.mouseSize || "medium";
  // Toggling these while the plan doesn't include Key View would save cleanly but never take
  // visible effect on the bar (hasPlanFeature() in toolbar.js gates it) — disabling here instead
  // of letting the user "turn it on" and then wondering why nothing happened.
  const keyViewGated = !hasKeyViewPlanAccess();
  ["keyViewEnabled", "keyViewTypingMode", "keyViewMouseEffects", "keyViewTheme", "keyViewPosition", "keyViewKeySize", "keyViewMouseSize"].forEach((id) => {
    document.getElementById(id).disabled = keyViewGated;
  });
  document.getElementById("keyViewPlanHint").hidden = !keyViewGated;
  const pinned = new Set(preferences.pinnedTools || []);
  document.querySelectorAll("[data-pinned]").forEach((checkbox) => { checkbox.checked = pinned.has(checkbox.dataset.pinned); });
  const enabledTools = new Set(preferences.enabledTools || window.QTS_STORAGE.DEFAULT_ENABLED_TOOLS);
  document.querySelectorAll("[data-tool]").forEach((checkbox) => { checkbox.checked = enabledTools.has(checkbox.dataset.tool); });
  const breadcrumbVisibility = preferences.breadcrumbVisibility || {};
  document.querySelectorAll("[data-breadcrumb]").forEach((checkbox) => { checkbox.checked = breadcrumbVisibility[checkbox.dataset.breadcrumb] !== false; });
  breadcrumbOrderDraft = normalizeBreadcrumbOrderDraft(preferences.breadcrumbOrder);
  renderBreadcrumbOrderList();
}

// Cliente/Projeto/Produto priority in the breadcrumb — a local draft array (not saved until
// "Salvar aparência") so drag/arrow reordering and the live preview stay instant without writing
// to the workspace on every rearrange. Environment is intentionally not reorderable — it's always
// the last, "current tier" segment (see buildBreadcrumb in toolbar.js).
let breadcrumbOrderDraft = ["client", "project", "product"];
let breadcrumbOrderDragKey = null;

function normalizeBreadcrumbOrderDraft(value) {
  const known = ["client", "project", "product"];
  const order = (Array.isArray(value) ? value : []).filter((key) => known.includes(key));
  for (const key of known) if (!order.includes(key)) order.push(key);
  return [...new Set(order)];
}

function renderBreadcrumbOrderList() {
  const labels = { client: t("Cliente"), project: t("Projeto"), product: t("Produto") };
  const list = document.getElementById("breadcrumbOrderList");
  list.innerHTML = breadcrumbOrderDraft.map((key, index) => `
    <li class="breadcrumbOrderItem" draggable="true" data-order-key="${key}">
      <span class="dragHandle">⠿</span><span>${escapeHtml(labels[key])}</span>
      <span class="orderArrows">
        <button type="button" data-order-move="up" data-order-key="${key}" ${index === 0 ? "disabled" : ""} title="${escapeHtml(t("Mover para cima"))}">↑</button>
        <button type="button" data-order-move="down" data-order-key="${key}" ${index === breadcrumbOrderDraft.length - 1 ? "disabled" : ""} title="${escapeHtml(t("Mover para baixo"))}">↓</button>
      </span>
    </li>`).join("");
  list.querySelectorAll("[data-order-move]").forEach((button) => button.addEventListener("click", () => {
    const key = button.dataset.orderKey;
    const from = breadcrumbOrderDraft.indexOf(key);
    const to = from + (button.dataset.orderMove === "up" ? -1 : 1);
    if (to < 0 || to >= breadcrumbOrderDraft.length) return;
    [breadcrumbOrderDraft[from], breadcrumbOrderDraft[to]] = [breadcrumbOrderDraft[to], breadcrumbOrderDraft[from]];
    renderBreadcrumbOrderList();
    renderBarPreview();
  }));
  list.querySelectorAll(".breadcrumbOrderItem").forEach((item) => {
    item.addEventListener("dragstart", () => { breadcrumbOrderDragKey = item.dataset.orderKey; item.classList.add("isDragging"); });
    item.addEventListener("dragend", () => { item.classList.remove("isDragging"); breadcrumbOrderDragKey = null; });
    item.addEventListener("dragover", (event) => event.preventDefault());
    item.addEventListener("drop", (event) => {
      event.preventDefault();
      const targetKey = item.dataset.orderKey;
      if (!breadcrumbOrderDragKey || breadcrumbOrderDragKey === targetKey) return;
      const from = breadcrumbOrderDraft.indexOf(breadcrumbOrderDragKey);
      const to = breadcrumbOrderDraft.indexOf(targetKey);
      breadcrumbOrderDraft.splice(from, 1);
      breadcrumbOrderDraft.splice(to, 0, breadcrumbOrderDragKey);
      renderBreadcrumbOrderList();
      renderBarPreview();
    });
  });
  renderBarPreview();
}

// Mock breadcrumb using sample names — reflects order/visibility/compact-mode instantly, without
// needing a real workspace/environment or waiting for "Salvar aparência".
function renderBarPreview() {
  const sample = { client: "Cliente", project: "Projeto", product: "Produto", environment: "QA" };
  const visibility = Object.fromEntries([...document.querySelectorAll("[data-breadcrumb]")].map((checkbox) => [checkbox.dataset.breadcrumb, checkbox.checked]));
  const compact = Object.fromEntries([...document.querySelectorAll("[data-compact-entity]")].map((checkbox) => [checkbox.dataset.compactEntity, checkbox.checked]));
  const crumb = (key, small) => `<span class="previewCrumb" style="font-size:${small ? "10px" : "12px"}">${compact[key] ? "" : escapeHtml(sample[key])}</span>`;
  const clientFirst = breadcrumbOrderDraft[0] === "client";
  document.getElementById("barPreviewClient").innerHTML = clientFirst && visibility.client !== false ? crumb("client", true) : "";
  const mainKeys = clientFirst ? breadcrumbOrderDraft.slice(1) : [...breadcrumbOrderDraft];
  const segments = mainKeys.filter((key) => visibility[key] !== false).map((key) => crumb(key, false));
  if (visibility.environment !== false) segments.push(`<span class="previewCrumb">${escapeHtml(sample.environment)}</span>`);
  document.getElementById("barPreviewMain").innerHTML = segments.join('<span class="previewSep">|</span>');
}
document.querySelectorAll("[data-breadcrumb],[data-compact-entity]").forEach((input) => input.addEventListener("change", renderBarPreview));

document.getElementById("savePreferences").addEventListener("click", async () => {
  const compactEntities = Object.fromEntries([...document.querySelectorAll("[data-compact-entity]")].map((checkbox) => [checkbox.dataset.compactEntity, checkbox.checked]));
  workspace.preferences = {
    ...(workspace.preferences || {}),
    compactMode: compactEntities.project === true && compactEntities.product === true,
    compactEntities,
    pushSiteContent: document.getElementById("pushSiteContent").checked,
    soundEffects: document.getElementById("soundEffects").checked,
    avatarShape: document.getElementById("avatarShape").value === "round" ? "round" : "square",
    keyView: {
      enabled: document.getElementById("keyViewEnabled").checked,
      typingMode: document.getElementById("keyViewTypingMode").checked,
      mouseEffects: document.getElementById("keyViewMouseEffects").checked,
      theme: document.getElementById("keyViewTheme").value,
      position: document.getElementById("keyViewPosition").value,
      keySize: document.getElementById("keyViewKeySize").value,
      mouseSize: document.getElementById("keyViewMouseSize").value,
    },
    pinnedTools: [...document.querySelectorAll("[data-pinned]:checked")].map((checkbox) => checkbox.dataset.pinned),
    enabledTools: [...document.querySelectorAll("[data-tool]:checked")].map((checkbox) => checkbox.dataset.tool),
    breadcrumbVisibility: Object.fromEntries([...document.querySelectorAll("[data-breadcrumb]")].map((checkbox) => [checkbox.dataset.breadcrumb, checkbox.checked])),
    breadcrumbOrder: [...breadcrumbOrderDraft],
  };
  await persistWorkspace();
  document.getElementById("preferencesSavedHint").textContent = t("Salvo — a barra já foi atualizada.");
});

function findById(collection, id) {
  return (workspace[collection] || []).find((item) => item.id === id);
}

function environmentDisplayName(environment) {
  return environment?.name || "";
}

// Which products/countries an environment is actually deployed to now lives on urlBindings
// (Environment is a reusable tier — see storage.js's normalizeUrlBindings) — this derives a
// short "AR, BO, PY" style summary for the environment list row and search.
function environmentBoundProductNames(environmentId) {
  const productIds = new Set((workspace.urlBindings || []).filter((binding) => binding.environmentIds.includes(environmentId)).map((binding) => binding.productId));
  return [...productIds].map((productId) => findById("products", productId)?.name).filter(Boolean);
}

function matchesSearch(item) {
  if (!searchQuery) return true;
  return JSON.stringify(item).toLowerCase().includes(searchQuery);
}

function rowActions(collection, item, { reveal = false } = {}) {
  const reorderable = ["clients", "projects", "products"].includes(collection) && (workspace[collection] || []).length > 1;
  return `<div class="rowActions">
    ${reveal ? `<button type="button" data-action="reveal" data-collection="${collection}" data-id="${escapeHtml(item.id)}" title="${escapeHtml(t("Mostrar/ocultar senha"))}">${escapeHtml(t(revealedAccountIds.has(item.id) ? "Ocultar" : "Ver"))}</button>` : ""}
    ${reorderable ? `<button type="button" data-action="move-up" data-collection="${collection}" data-id="${escapeHtml(item.id)}" title="${escapeHtml(t("Mover para cima"))}">↑</button><button type="button" data-action="move-down" data-collection="${collection}" data-id="${escapeHtml(item.id)}" title="${escapeHtml(t("Mover para baixo"))}">↓</button>` : ""}
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

let urlSelectedEnvironmentIds = new Set();

function renderUrlEnvironmentPicker() {
  const container = document.getElementById("urlEnvironmentPicker");
  const environments = workspace.environments || [];
  if (!environments.length) {
    container.innerHTML = `<div class="listEmpty">${escapeHtml(t("Crie um ambiente antes de associar URLs."))}</div>`;
    return;
  }
  if (environments.length <= 4) {
    container.innerHTML = `<div class="environmentToggles">${environments.map((environment) => {
      const selected = urlSelectedEnvironmentIds.has(environment.id);
      return `<button type="button" class="environmentToggle${selected ? " isSelected" : ""}" data-url-environment="${escapeHtml(environment.id)}" aria-pressed="${selected}"><span style="--environment-color:${escapeHtml(environment.color)}"></span>${escapeHtml(environmentDisplayName(environment))}</button>`;
    }).join("")}</div>`;
    container.querySelectorAll("[data-url-environment]").forEach((button) => button.addEventListener("click", () => {
      const id = button.dataset.urlEnvironment;
      urlSelectedEnvironmentIds.has(id) ? urlSelectedEnvironmentIds.delete(id) : urlSelectedEnvironmentIds.add(id);
      renderUrlEnvironmentPicker();
    }));
    return;
  }
  const selectedLabel = t("{count} ambiente(s) selecionado(s)", { count: urlSelectedEnvironmentIds.size });
  container.innerHTML = `<details class="environmentMultiSelect"><summary>${escapeHtml(selectedLabel)}</summary><div class="multiSelectPanel"><div class="multiSelectTools"><input type="search" data-environment-search placeholder="${escapeHtml(t("Buscar ambiente"))}" /><button type="button" data-clear-environments>${escapeHtml(t("Limpar seleção"))}</button></div><div class="multiSelectOptions">${environments.map((environment) => `<label data-environment-option="${escapeHtml(environmentDisplayName(environment).toLowerCase())}"><input type="checkbox" value="${escapeHtml(environment.id)}" ${urlSelectedEnvironmentIds.has(environment.id) ? "checked" : ""} /> <span style="--environment-color:${escapeHtml(environment.color)}"></span>${escapeHtml(environmentDisplayName(environment))}</label>`).join("")}</div></div></details>`;
  container.querySelectorAll('.multiSelectOptions input[type="checkbox"]').forEach((input) => input.addEventListener("change", () => {
    input.checked ? urlSelectedEnvironmentIds.add(input.value) : urlSelectedEnvironmentIds.delete(input.value);
    renderUrlEnvironmentPicker();
    container.querySelector("details")?.setAttribute("open", "");
  }));
  container.querySelector("[data-clear-environments]").addEventListener("click", () => { urlSelectedEnvironmentIds.clear(); renderUrlEnvironmentPicker(); });
  container.querySelector("[data-environment-search]").addEventListener("input", (event) => {
    const query = event.target.value.trim().toLowerCase();
    container.querySelectorAll("[data-environment-option]").forEach((option) => { option.hidden = !option.dataset.environmentOption.includes(query); });
  });
}

function renderWorkspace() {
  for (const [collection, countId] of Object.entries({ clients: "clientCount", projects: "projectCount", products: "productCount", environments: "environmentCount", urlBindings: "urlRelationCount", testAccounts: "testAccountCount", paymentMethods: "paymentMethodCount", inspectors: "inspectorCount", apis: "apiCount", resources: "resourceCount" })) {
    document.getElementById(countId).textContent = String((workspace[collection] || []).length);
  }
  const badge = (entity) => window.QTS_AVATAR.buildEntityHtml(entity, { size: 22 });
  renderRows("clients", (item) => `<b>${badge(item)}</b>`);
  renderRows("projects", (item) => `<b>${badge(item)}</b><small>${escapeHtml(findById("clients", item.clientId)?.name || "—")}</small>`);
  renderRows("products", (item) => `<b>${badge(item)}</b><small>${escapeHtml(findById("projects", item.projectId)?.name || "—")}</small>`);
  renderRows("environments", (item) => {
    const products = environmentBoundProductNames(item.id);
    return `<b style="color:${escapeHtml(item.color)}">● ${escapeHtml(item.name)}</b><small>${escapeHtml(products.length ? products.join(", ") : t("Nenhuma URL relacionada ainda"))}</small>`;
  });
  renderRows("urlBindings", (item) => {
    const product = findById("products", item.productId);
    const badges = item.environmentIds.map((environmentId) => findById("environments", environmentId)).filter(Boolean)
      .map((environment) => `<span class="relationBadge"><i style="--environment-color:${escapeHtml(environment.color)}"></i>${escapeHtml(environmentDisplayName(environment))}</span>`).join("");
    return `<b class="urlPattern">${escapeHtml(item.pattern)}</b><small>${escapeHtml(product?.name || "—")}</small><small class="relationBadges">${badges}</small>`;
  });
  renderUrlEnvironmentPicker();
  renderRows("testAccounts", (item) => {
    const password = item.password ? (revealedAccountIds.has(item.id) ? escapeHtml(item.password) : "••••••••") : "—";
    // The toolbar's own read-only drawer already renders this image (renderTestAccountsList in
    // toolbar.js) — this options-page list never did, so the same uploaded/URL icon that shows
    // up later was invisible here while managing the account.
    const typeImage = item.accountTypeImage ? `<img src="${escapeHtml(item.accountTypeImage)}" alt="" style="width:16px;height:16px;border-radius:4px;object-fit:cover;vertical-align:middle;margin-right:4px" />` : "";
    const productName = findById("products", item.productId)?.name;
    return `<b>${typeImage}${escapeHtml(item.label)}${item.accountType ? ` <span class="accountType">${escapeHtml(item.accountType)}</span>` : ""}</b><small>${escapeHtml(environmentDisplayName(findById("environments", item.environmentId) || {}))}${productName ? ` · ${escapeHtml(productName)}` : ""} · ${escapeHtml(item.username || "—")} · ${password}</small>`;
  }, { reveal: (item) => Boolean(item.password) });
  renderRows("paymentMethods", (item) => {
    const productName = findById("products", item.productId)?.name;
    const environmentLabel = item.environmentId ? environmentDisplayName(findById("environments", item.environmentId) || {}) : t("Todos os ambientes");
    return `<b>${escapeHtml(item.label)}</b><small>${escapeHtml(t(item.type || "other"))} · ${escapeHtml(t(item.value ? "valor protegido" : "sem valor"))} · ${escapeHtml(environmentLabel)}${productName ? ` · ${escapeHtml(productName)}` : ""} · ${escapeHtml(item.notes || "")}</small>`;
  });
  renderRows("inspectors", (item) => `<b>${escapeHtml(item.label)}</b><small>${escapeHtml((item.patterns || []).join(", "))}</small>`);
  renderRows("apis", (item) => `<b>${escapeHtml(item.label)}</b><small>${escapeHtml(item.baseUrl || "—")} · ${escapeHtml(t(item.token ? "token local configurado" : "sem token"))}</small>`);
  renderRows("resources", (item) => `<b>${escapeHtml(item.label)}</b><small>${escapeHtml(item.url || "—")}</small>`);
  renderSelect("projectClient", workspace.clients, t("Selecione o cliente"));
  renderSelect("productProject", workspace.projects, t("Selecione o projeto"));
  renderSelect("urlRelationProduct", workspace.products, t("Selecione o produto"));
  renderSelect("testAccountEnvironment", workspace.environments.map((item) => ({ id: item.id, name: environmentDisplayName(item) })), t("Selecione o ambiente"));
  renderSelect("testAccountProduct", workspace.products, t("Todos os produtos"));
  renderSelect("paymentMethodEnvironment", workspace.environments.map((item) => ({ id: item.id, name: environmentDisplayName(item) })), t("Todos os ambientes"));
  renderSelect("paymentMethodProduct", workspace.products, t("Todos os produtos"));
  loadPreferenceUi();
  renderWorkspaceWizard();
  activateWorkspaceTab(activeWorkspaceTab);
  window.QTS_OPTIONS_I18N.apply(currentLocale);
}

// First-access wizard: guides Client -> Project -> Product -> Environment using the SAME forms
// already in this panel (no parallel UI) — just a progress strip that tracks which step is next
// and auto-scrolls there the moment the previous one is saved, so creating the first environment
// reads as one guided flow instead of four unrelated, easy-to-miss cards.
let wizardLastActiveStep = -1;
function renderWorkspaceWizard() {
  const wizard = document.getElementById("workspaceWizard");
  const steps = [
    { label: t("Cliente"), done: workspace.clients.length > 0, targetId: "clientName", tab: "structure", composer: "clientComposer" },
    { label: t("Projeto"), done: workspace.projects.length > 0, targetId: "projectClient", tab: "structure", composer: "projectComposer" },
    { label: t("Produto"), done: workspace.products.length > 0, targetId: "productProject", tab: "structure", composer: "productComposer" },
    { label: t("Ambiente"), done: workspace.environments.length > 0, targetId: "environmentName", tab: "environments", composer: "environmentComposer" },
    { label: t("URL"), done: workspace.urlBindings.length > 0, targetId: "urlRelationProduct", tab: "urls", composer: "urlRelationComposer" },
  ];
  const activeIndex = steps.findIndex((step) => !step.done);
  if (activeIndex === -1) {
    wizard.hidden = true;
    wizardLastActiveStep = -1;
    return;
  }
  wizard.hidden = false;
  document.getElementById("wizardSteps").innerHTML = steps.map((step, index) => `
    <li class="${step.done ? "isDone" : index === activeIndex ? "isActive" : ""}" data-wizard-step="${index}">
      <span class="wizardStepNum">${step.done ? ICON("pass") : index + 1}</span>
      <span>${escapeHtml(step.label)}</span>
    </li>
  `).join("");
  const focusStep = (step) => {
    activateWorkspaceTab(step.tab, { syncNavigation: true });
    const composer = document.getElementById(step.composer);
    if (composer) composer.open = true;
    const target = document.getElementById(step.targetId);
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    target?.focus();
  };
  document.querySelectorAll("#wizardSteps [data-wizard-step]").forEach((item) => item.addEventListener("click", () => focusStep(steps[Number(item.dataset.wizardStep)])));
  if (activeIndex !== wizardLastActiveStep && accessState?.active && document.querySelector('[data-panel="workspace"]')?.classList.contains("isActive")) {
    wizardLastActiveStep = activeIndex;
    focusStep(steps[activeIndex]);
  }
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
  if (prefix === "environment") { document.getElementById("environmentColor").value = "#3a3a3a"; }
  if (prefix === "urlRelation") { urlSelectedEnvironmentIds = new Set(); renderUrlEnvironmentPicker(); }
  form.querySelectorAll("[data-image-group]").forEach((group) => {
    group.dataset.mode = "url";
    group.querySelectorAll("[data-image-mode]").forEach((button) => button.classList.toggle("isActive", button.dataset.imageMode === "url"));
    group.querySelector("[data-image-url]")?.dispatchEvent(new Event("input", { bubbles: true }));
  });
  if (prefix === "testAccount") { testAccountCustomFieldsDraft = []; renderCustomFieldsEditor(); }
  const composer = document.getElementById(`${prefix}Composer`);
  if (composer) composer.open = false;
}

// Test account custom fields: a small user-defined key/type/value schema (string/boolean/
// number) rather than a fixed capability list — the founder's explicit ask, since even the
// original reference tool only ever had a hardcoded set of capability checkboxes.
let testAccountCustomFieldsDraft = [];

function renderCustomFieldsEditor() {
  const container = document.getElementById("testAccountCustomFields");
  container.innerHTML = testAccountCustomFieldsDraft.map((field, index) => `
    <div class="customFieldRow" data-field-index="${index}">
      <input type="text" data-field-key placeholder="${escapeHtml(t("Nome do campo"))}" value="${escapeHtml(field.key)}" />
      <select data-field-type>
        <option value="string" ${field.type === "string" ? "selected" : ""}>${escapeHtml(t("Texto"))}</option>
        <option value="boolean" ${field.type === "boolean" ? "selected" : ""}>${escapeHtml(t("Sim/Não"))}</option>
        <option value="number" ${field.type === "number" ? "selected" : ""}>${escapeHtml(t("Número"))}</option>
      </select>
      <span class="customFieldValue">
        ${field.type === "boolean"
          ? `<label class="checkRow"><input type="checkbox" data-field-value ${field.value ? "checked" : ""} /> ${escapeHtml(t("Ativo"))}</label>`
          : `<input type="${field.type === "number" ? "number" : "text"}" data-field-value value="${escapeHtml(field.value)}" placeholder="${escapeHtml(t("Valor"))}" />`}
      </span>
      <button type="button" class="button danger" data-field-remove title="${escapeHtml(t("Excluir"))}">${ICON("fail")}</button>
    </div>
  `).join("");
  container.querySelectorAll("[data-field-index]").forEach((row) => {
    const index = Number(row.dataset.fieldIndex);
    row.querySelector("[data-field-key]").addEventListener("input", (event) => { testAccountCustomFieldsDraft[index].key = event.target.value; });
    row.querySelector("[data-field-type]").addEventListener("change", (event) => {
      testAccountCustomFieldsDraft[index].type = event.target.value;
      testAccountCustomFieldsDraft[index].value = event.target.value === "boolean" ? false : "";
      renderCustomFieldsEditor();
    });
    row.querySelector("[data-field-value]").addEventListener("input", (event) => {
      testAccountCustomFieldsDraft[index].value = event.target.type === "checkbox" ? event.target.checked : event.target.value;
    });
    row.querySelector("[data-field-remove]").addEventListener("click", () => { testAccountCustomFieldsDraft.splice(index, 1); renderCustomFieldsEditor(); });
  });
}
document.getElementById("testAccountAddField").addEventListener("click", () => {
  testAccountCustomFieldsDraft.push({ key: "", type: "string", value: "" });
  renderCustomFieldsEditor();
});
document.querySelectorAll(".cancelEdit").forEach((button) => button.addEventListener("click", () => clearEdit(button.dataset.cancel)));

document.getElementById("clientForm").addEventListener("submit", async (event) => { event.preventDefault(); const editId = document.getElementById("clientEditId").value; upsert("clients", { id: editId || uid("client"), name: document.getElementById("clientName").value.trim(), ...appearance("client") }, editId); clearEdit("client"); await persistWorkspace(); });
document.getElementById("projectForm").addEventListener("submit", async (event) => { event.preventDefault(); const editId = document.getElementById("projectEditId").value; upsert("projects", { id: editId || uid("project"), clientId: document.getElementById("projectClient").value, name: document.getElementById("projectName").value.trim(), ...appearance("project") }, editId); clearEdit("project"); await persistWorkspace(); });
document.getElementById("productForm").addEventListener("submit", async (event) => { event.preventDefault(); const editId = document.getElementById("productEditId").value; upsert("products", { id: editId || uid("product"), projectId: document.getElementById("productProject").value, name: document.getElementById("productName").value.trim(), ...appearance("product") }, editId); clearEdit("product"); await persistWorkspace(); });
document.getElementById("environmentForm").addEventListener("submit", async (event) => { event.preventDefault(); const editId = document.getElementById("environmentEditId").value; upsert("environments", { id: editId || uid("env"), name: document.getElementById("environmentName").value.trim(), color: document.getElementById("environmentColor").value, active: true }, editId); clearEdit("environment"); await persistWorkspace(); });

document.getElementById("testAccountForm").addEventListener("submit", async (event) => { event.preventDefault(); const editId = document.getElementById("testAccountEditId").value; const existing = findById("testAccounts", editId); const password = document.getElementById("testAccountPassword").value; upsert("testAccounts", { id: editId || uid("account"), environmentId: document.getElementById("testAccountEnvironment").value, productId: document.getElementById("testAccountProduct").value || null, label: document.getElementById("testAccountLabel").value.trim(), accountType: document.getElementById("testAccountType").value.trim(), accountTypeImage: document.getElementById("testAccountTypeImage").value.trim(), username: document.getElementById("testAccountUsername").value.trim(), password: password || existing?.password || "", notes: document.getElementById("testAccountNotes").value.trim(), customFields: testAccountCustomFieldsDraft, active: true }, editId); clearEdit("testAccount"); await persistWorkspace(); });
document.getElementById("paymentMethodForm").addEventListener("submit", async (event) => { event.preventDefault(); const editId = document.getElementById("paymentMethodEditId").value; const existing = findById("paymentMethods", editId); upsert("paymentMethods", { id: editId || uid("payment"), environmentId: document.getElementById("paymentMethodEnvironment").value || null, productId: document.getElementById("paymentMethodProduct").value || null, label: document.getElementById("paymentMethodLabel").value.trim(), type: document.getElementById("paymentMethodType").value, icon: document.getElementById("paymentMethodIcon").value.trim(), value: document.getElementById("paymentMethodValue").value.trim() || existing?.value || "", holder: document.getElementById("paymentMethodHolder").value.trim(), expiry: document.getElementById("paymentMethodExpiry").value.trim(), cvv: document.getElementById("paymentMethodCvv").value.trim() || existing?.cvv || "", notes: document.getElementById("paymentMethodNotes").value.trim(), active: true }, editId); clearEdit("paymentMethod"); await persistWorkspace(); });
document.getElementById("inspectorForm").addEventListener("submit", async (event) => { event.preventDefault(); const editId = document.getElementById("inspectorEditId").value; upsert("inspectors", { id: editId || uid("inspector"), label: document.getElementById("inspectorLabel").value.trim(), patterns: document.getElementById("inspectorPatterns").value.split(/\n|,/).map((v) => v.trim()).filter(Boolean), active: true }, editId); clearEdit("inspector"); await persistWorkspace(); });
document.getElementById("apiForm").addEventListener("submit", async (event) => { event.preventDefault(); const editId = document.getElementById("apiEditId").value; const existing = findById("apis", editId); upsert("apis", { id: editId || uid("api"), label: document.getElementById("apiLabel").value.trim(), baseUrl: document.getElementById("apiBaseUrl").value.trim(), token: document.getElementById("apiToken").value || existing?.token || "", active: true }, editId); clearEdit("api"); await persistWorkspace(); });
document.getElementById("resourceForm").addEventListener("submit", async (event) => { event.preventDefault(); const editId = document.getElementById("resourceEditId").value; upsert("resources", { id: editId || uid("resource"), label: document.getElementById("resourceLabel").value.trim(), url: document.getElementById("resourceUrl").value.trim(), category: document.getElementById("resourceCategory").value.trim(), icon: document.getElementById("resourceIcon").value.trim(), active: true }, editId); clearEdit("resource"); await persistWorkspace(); });

document.getElementById("urlRelationForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const patternInput = document.getElementById("urlPatternInput");
  const pattern = normalizeUrlPatterns(patternInput.value)[0];
  if (!pattern) { patternInput.setCustomValidity(t("Informe uma URL ou padrão válido.")); patternInput.reportValidity(); return; }
  if (!urlSelectedEnvironmentIds.size) { patternInput.setCustomValidity(t("Selecione pelo menos um ambiente.")); patternInput.reportValidity(); return; }
  patternInput.setCustomValidity("");
  const editId = document.getElementById("urlRelationEditId").value;
  upsert("urlBindings", {
    id: editId || uid("binding"),
    pattern,
    productId: document.getElementById("urlRelationProduct").value,
    environmentIds: [...urlSelectedEnvironmentIds],
    primaryUrl: document.getElementById("urlRelationPrimaryUrl").value.trim(),
    active: true,
  }, editId);
  clearEdit("urlRelation");
  await persistWorkspace();
});

function editItem(collection, item) {
  const prefix = COLLECTION_UI[collection].prefix;
  const workspaceTabs = { clients: "structure", projects: "structure", products: "structure", environments: "environments", urlBindings: "urls", testAccounts: "accounts", paymentMethods: "payments", inspectors: "integrations", apis: "integrations", resources: "integrations" };
  activateWorkspaceTab(workspaceTabs[collection] || "structure", { syncNavigation: true });
  const composer = document.getElementById(`${prefix}Composer`);
  if (composer) composer.open = true;
  document.getElementById(`${prefix}EditId`).value = item.id;
  document.querySelector(`[data-cancel="${prefix}"]`).hidden = false;
  const values = {
    clients: { clientName: item.name, clientLogoUrl: item.logoUrl, clientAbbreviation: item.abbreviation, clientShowLabel: item.showLabel !== false },
    projects: { projectClient: item.clientId, projectName: item.name, projectLogoUrl: item.logoUrl, projectAbbreviation: item.abbreviation, projectShowLabel: item.showLabel !== false },
    products: { productProject: item.projectId, productName: item.name, productLogoUrl: item.logoUrl, productAbbreviation: item.abbreviation, productShowLabel: item.showLabel !== false },
    environments: { environmentName: item.name, environmentColor: item.color },
    urlBindings: { urlRelationProduct: item.productId, urlPatternInput: item.pattern, urlRelationPrimaryUrl: item.primaryUrl },
    testAccounts: { testAccountEnvironment: item.environmentId, testAccountProduct: item.productId || "", testAccountLabel: item.label, testAccountType: item.accountType, testAccountTypeImage: item.accountTypeImage, testAccountUsername: item.username, testAccountPassword: "", testAccountNotes: item.notes },
    paymentMethods: { paymentMethodEnvironment: item.environmentId || "", paymentMethodProduct: item.productId || "", paymentMethodLabel: item.label, paymentMethodType: item.type, paymentMethodIcon: item.icon, paymentMethodValue: "", paymentMethodHolder: item.holder, paymentMethodExpiry: item.expiry, paymentMethodCvv: "", paymentMethodNotes: item.notes },
    inspectors: { inspectorLabel: item.label, inspectorPatterns: (item.patterns || []).join("\n") },
    apis: { apiLabel: item.label, apiBaseUrl: item.baseUrl, apiToken: "" },
    resources: { resourceLabel: item.label, resourceUrl: item.url, resourceCategory: item.category, resourceIcon: item.icon },
  }[collection];
  for (const [elementId, value] of Object.entries(values || {})) {
    const element = document.getElementById(elementId);
    if (element.type === "checkbox") element.checked = Boolean(value); else element.value = value ?? "";
    if (element.matches("[data-image-url]")) element.dispatchEvent(new Event("input", { bubbles: true }));
  }
  if (collection === "testAccounts") {
    testAccountCustomFieldsDraft = structuredClone(item.customFields || []);
    renderCustomFieldsEditor();
  }
  if (collection === "urlBindings") { urlSelectedEnvironmentIds = new Set(item.environmentIds || []); renderUrlEnvironmentPicker(); }
  document.getElementById(`${prefix}Form`).scrollIntoView({ behavior: "smooth", block: "center" });
}

// Environments are reusable across products now (see storage.js's normalizeUrlBindings), so
// removing a client/project/product no longer deletes environments — only the URL bindings and
// product-scoped test accounts/payment methods that actually belong to the removed product(s).
// An environment itself only goes away when removed directly from the "Ambientes" tab.
function cascadeRemove(collection, removeId) {
  const removeSet = (key, predicate) => { workspace[key] = workspace[key].filter((item) => !predicate(item)); };
  const dropProducts = (productIds) => {
    removeSet("urlBindings", (item) => productIds.has(item.productId));
    removeSet("testAccounts", (item) => item.productId && productIds.has(item.productId));
    removeSet("paymentMethods", (item) => item.productId && productIds.has(item.productId));
    removeSet("products", (item) => productIds.has(item.id));
  };
  if (collection === "clients") {
    const projectIds = new Set(workspace.projects.filter((item) => item.clientId === removeId).map((item) => item.id));
    const productIds = new Set(workspace.products.filter((item) => projectIds.has(item.projectId)).map((item) => item.id));
    dropProducts(productIds);
    removeSet("projects", (item) => projectIds.has(item.id));
  }
  if (collection === "projects") {
    const productIds = new Set(workspace.products.filter((item) => item.projectId === removeId).map((item) => item.id));
    dropProducts(productIds);
  }
  if (collection === "products") {
    dropProducts(new Set([removeId]));
  }
  if (collection === "environments") {
    workspace.urlBindings = workspace.urlBindings
      .map((item) => ({ ...item, environmentIds: item.environmentIds.filter((environmentId) => environmentId !== removeId) }))
      .filter((item) => item.environmentIds.length > 0);
    removeSet("testAccounts", (item) => item.environmentId === removeId);
    removeSet("paymentMethods", (item) => item.environmentId === removeId);
  }
  removeSet(collection, (item) => item.id === removeId);
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action][data-collection][data-id]");
  if (!button) return;
  const { action, collection, id } = button.dataset;
  const item = findById(collection, id);
  if (!item) return;
  if (action === "reveal") { revealedAccountIds.has(id) ? revealedAccountIds.delete(id) : revealedAccountIds.add(id); renderWorkspace(); return; }
  if (action === "move-up" || action === "move-down") {
    const items = workspace[collection];
    const from = items.findIndex((candidate) => candidate.id === id);
    const to = from + (action === "move-up" ? -1 : 1);
    if (from < 0 || to < 0 || to >= items.length) return;
    [items[from], items[to]] = [items[to], items[from]];
    await persistWorkspace();
    return;
  }
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
