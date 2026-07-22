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
  document.getElementById("deleteAccountCard").hidden = !active;
  const paymentFailed = accessState?.billing?.status === "past_due" || accessState?.billing?.status === "unpaid";
  document.getElementById("paymentFailedBanner").hidden = !paymentFailed;
  if (active) {
    document.getElementById("accountEmail").textContent = accessState.user?.email || "Conta autenticada";
    document.getElementById("accountPlan").textContent = accessState.plan?.name || "Acesso ativo";
  } else if (paymentFailed) {
    showMessage("authMessage", "Seu pagamento falhou e o acesso a recursos pagos foi bloqueado. Veja o aviso acima para regularizar.", "Error");
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

document.getElementById("voucherForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  const input = document.getElementById("voucherCodeInput");
  const code = input.value.trim().toUpperCase();
  if (!code) return;
  button.disabled = true;
  showMessage("voucherMessage", "Aplicando voucher…");
  const response = await runtimeMessage({ type: "qts:voucher-redeem", code });
  button.disabled = false;
  if (!response.ok) {
    const messages = {
      voucher_unavailable: "Voucher inválido, expirado ou já utilizado.",
      voucher_already_redeemed: "Você já resgatou este voucher.",
      voucher_requires_checkout: "Este é um voucher de desconto — aplique-o na tela de checkout do site.",
      rate_limit_exceeded: "Muitas tentativas. Aguarde alguns minutos.",
    };
    showMessage("voucherMessage", messages[response.error] || "Não foi possível aplicar o voucher agora.", "Error");
    return;
  }
  input.value = "";
  accessState = response.access;
  await loadAccess();
  showMessage("voucherMessage", "Voucher aplicado! Acesso atualizado.", "Success");
});

document.getElementById("signOutButton").addEventListener("click", async () => {
  await runtimeMessage({ type: "qts:auth-sign-out" });
  accessState = null;
  await loadAccess();
  showMessage("authMessage", "Você saiu. Seus dados locais foram preservados.", "Success");
});

document.getElementById("deleteAccountButton").addEventListener("click", () => {
  document.getElementById("deleteAccountForm").reset();
  showMessage("deleteAccountMessage", "");
  document.getElementById("deleteAccountDialog").showModal();
});
document.getElementById("deleteAccountForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  const password = document.getElementById("deleteAccountPassword").value;
  button.disabled = true;
  showMessage("deleteAccountMessage", "Confirmando e excluindo sua conta…");
  const response = await runtimeMessage({ type: "qts:account-delete", password });
  button.disabled = false;
  if (!response.ok) {
    const messages = {
      invalid_password: "Senha incorreta.",
      payment_past_due: "Seu pagamento está pendente. Regularize a fatura antes de excluir a conta.",
      subscription_cancel_failed: "Não foi possível cancelar sua assinatura agora. Tente novamente em instantes.",
      rate_limit_exceeded: "Muitas tentativas. Aguarde alguns minutos.",
      authentication_required: "Sessão expirada. Entre novamente para excluir a conta.",
    };
    showMessage("deleteAccountMessage", messages[response.error] || "Não foi possível excluir a conta agora. Tente novamente.", "Error");
    return;
  }
  document.getElementById("deleteAccountDialog").close();
  accessState = null;
  await loadAccess();
  showMessage("authMessage", "Sua conta foi excluída.", "Success");
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
  toolsMenuOrderDraft = normalizeToolsMenuOrderDraft(preferences.toolsMenuOrder);
  renderToolsMenuOrderList();
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

// Tools-menu item order — same drag/arrow pattern as the breadcrumb order above, kept as its own
// (slightly duplicated) implementation rather than a shared abstraction, since the breadcrumb
// list is small/fixed (3 keys) and this one is long/dynamic (every known tool) with a different
// label source (read straight from each checkbox's own <label> text, so it can never drift out of
// sync with whatever that checkbox is actually called, in whatever language is active).
let toolsMenuOrderDraft = [...window.QTS_STORAGE.DEFAULT_ENABLED_TOOLS];
let toolsMenuOrderDragKey = null;

function normalizeToolsMenuOrderDraft(value) {
  const known = window.QTS_STORAGE.DEFAULT_ENABLED_TOOLS;
  const order = (Array.isArray(value) ? value : []).filter((key) => known.includes(key));
  for (const key of known) if (!order.includes(key)) order.push(key);
  return [...new Set(order)];
}

function toolsMenuItemLabel(key) {
  const checkbox = document.querySelector(`[data-tool="${key}"]`);
  return checkbox?.parentElement?.textContent?.trim() || key;
}

function renderToolsMenuOrderList() {
  const list = document.getElementById("toolsMenuOrderList");
  list.innerHTML = toolsMenuOrderDraft.map((key, index) => `
    <li class="breadcrumbOrderItem" draggable="true" data-order-key="${key}">
      <span class="dragHandle">⠿</span><span>${escapeHtml(toolsMenuItemLabel(key))}</span>
      <span class="orderArrows">
        <button type="button" data-order-move="up" data-order-key="${key}" ${index === 0 ? "disabled" : ""} title="${escapeHtml(t("Mover para cima"))}">↑</button>
        <button type="button" data-order-move="down" data-order-key="${key}" ${index === toolsMenuOrderDraft.length - 1 ? "disabled" : ""} title="${escapeHtml(t("Mover para baixo"))}">↓</button>
      </span>
    </li>`).join("");
  list.querySelectorAll("[data-order-move]").forEach((button) => button.addEventListener("click", () => {
    const key = button.dataset.orderKey;
    const from = toolsMenuOrderDraft.indexOf(key);
    const to = from + (button.dataset.orderMove === "up" ? -1 : 1);
    if (to < 0 || to >= toolsMenuOrderDraft.length) return;
    [toolsMenuOrderDraft[from], toolsMenuOrderDraft[to]] = [toolsMenuOrderDraft[to], toolsMenuOrderDraft[from]];
    renderToolsMenuOrderList();
  }));
  list.querySelectorAll(".breadcrumbOrderItem").forEach((item) => {
    item.addEventListener("dragstart", () => { toolsMenuOrderDragKey = item.dataset.orderKey; item.classList.add("isDragging"); });
    item.addEventListener("dragend", () => { item.classList.remove("isDragging"); toolsMenuOrderDragKey = null; });
    item.addEventListener("dragover", (event) => event.preventDefault());
    item.addEventListener("drop", (event) => {
      event.preventDefault();
      const targetKey = item.dataset.orderKey;
      if (!toolsMenuOrderDragKey || toolsMenuOrderDragKey === targetKey) return;
      const from = toolsMenuOrderDraft.indexOf(toolsMenuOrderDragKey);
      const to = toolsMenuOrderDraft.indexOf(targetKey);
      toolsMenuOrderDraft.splice(from, 1);
      toolsMenuOrderDraft.splice(to, 0, toolsMenuOrderDragKey);
      renderToolsMenuOrderList();
    });
  });
}

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
    toolsMenuOrder: [...toolsMenuOrderDraft],
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

// founder feedback: search used to JSON.stringify() the whole item, which drags in every base64
// image field (logos, account-type icons, payment icons — up to 300k chars each) on every single
// keystroke across every collection. None of that is human-searchable text, so this instead builds
// a small haystack from just the fields a person would actually search by.
const SEARCH_IGNORED_KEYS = new Set(["id", "logoUrl", "accountTypeImage", "icon", "active", "showLabel", "color"]);
function matchesSearch(item) {
  if (!searchQuery) return true;
  const parts = [];
  for (const [key, value] of Object.entries(item)) {
    if (SEARCH_IGNORED_KEYS.has(key) || value == null) continue;
    if (typeof value === "string" || typeof value === "number") parts.push(String(value));
    else if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === "string" || typeof entry === "number") parts.push(String(entry));
        else if (entry && typeof entry === "object" && "key" in entry) parts.push(`${entry.key} ${entry.value ?? ""}`);
      }
    }
  }
  return parts.join(" ").toLowerCase().includes(searchQuery);
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
let urlPatternsDraft = [];

// Founder feedback: the old single-value "URL ou padrão" field only ever showed (and saved) one
// pattern, so registering several country/domain URLs for the same product+environments meant
// repeating the whole modal per URL, and re-opening it to edit only ever showed the last one.
// Mirrors the environment picker's own pill styling below it.
function renderUrlPatternsPicker() {
  const container = document.getElementById("urlPatternsPicker");
  container.innerHTML = urlPatternsDraft.length
    ? urlPatternsDraft.map((pattern, index) => `<span class="patternPill">${escapeHtml(pattern)}<button type="button" data-remove-pattern="${index}" aria-label="${escapeHtml(t("Remover"))}">×</button></span>`).join("")
    : `<div class="listEmpty">${escapeHtml(t("Adicione ao menos uma URL ou padrão."))}</div>`;
  container.querySelectorAll("[data-remove-pattern]").forEach((button) => button.addEventListener("click", () => {
    urlPatternsDraft.splice(Number(button.dataset.removePattern), 1);
    renderUrlPatternsPicker();
  }));
}

function addUrlPatternDraft() {
  const input = document.getElementById("urlPatternInput");
  const [normalized] = normalizeUrlPatterns(input.value);
  if (!normalized) { input.setCustomValidity(t("Informe uma URL ou padrão válido.")); input.reportValidity(); return; }
  input.setCustomValidity("");
  if (!urlPatternsDraft.includes(normalized)) urlPatternsDraft.push(normalized);
  input.value = "";
  renderUrlPatternsPicker();
  input.focus();
}

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

// URLs are grouped by environment into collapsible accordions (rather than one flat list) so a
// workspace with many countries/products per environment stays scannable — each section shows its
// own URL count and can be collapsed once reviewed. A binding can belong to several environments
// at once (see the environment picker above), so it's rendered once per environment it's tied to;
// bindings with no environment yet land in a trailing "Sem ambiente" group instead of vanishing.
function renderUrlRelationRow(item) {
  const product = findById("products", item.productId);
  const productBadge = product ? window.QTS_AVATAR.buildEntityHtml(product, { size: 18 }) : "";
  const badges = item.environmentIds.map((environmentId) => findById("environments", environmentId)).filter(Boolean)
    .map((environment) => `<span class="relationBadge"><i style="--environment-color:${escapeHtml(environment.color)}"></i>${escapeHtml(environmentDisplayName(environment))}</span>`).join("");
  return `<div class="listRow${item.active === false ? " isInactive" : ""}" data-id="${escapeHtml(item.id)}"><div><b class="urlPattern">${escapeHtml((item.patterns || []).join(", "))}</b><small>${productBadge}${escapeHtml(product?.name || "—")}</small><small class="relationBadges">${badges}</small></div>${rowActions("urlBindings", item)}</div>`;
}

// Remembers which environment accordions the founder has manually collapsed — renderWorkspace()
// re-renders this list after every unrelated save anywhere on the page (a new test account, a
// language switch, etc.), so without this every collapse would silently snap back open the next
// time anything else changed.
const collapsedUrlAccordionIds = new Set();

function renderUrlRelationList() {
  const element = document.getElementById(COLLECTION_UI.urlBindings.listId);
  const environments = workspace.environments || [];
  const bindings = (workspace.urlBindings || []).filter(matchesSearch);
  if (!bindings.length) { element.innerHTML = `<div class="listEmpty">${escapeHtml(t(searchQuery ? "Nenhum resultado." : "Nada cadastrado ainda."))}</div>`; return; }
  if (!environments.length) { element.innerHTML = bindings.map(renderUrlRelationRow).join(""); return; }
  const orphans = bindings.filter((item) => !(item.environmentIds || []).length);
  const sections = [
    ...environments.map((environment) => ({ environment, items: bindings.filter((item) => (item.environmentIds || []).includes(environment.id)) })),
    ...(orphans.length ? [{ environment: null, items: orphans }] : []),
  ];
  element.innerHTML = sections.map(({ environment, items }) => {
    const key = environment ? environment.id : "__none__";
    const name = environment ? environmentDisplayName(environment) : t("Sem ambiente");
    const color = environment ? environment.color : "#5b6172";
    return `<details class="environmentAccordion" data-accordion-key="${escapeHtml(key)}" ${collapsedUrlAccordionIds.has(key) ? "" : "open"}>
      <summary><span class="environmentDot" style="--environment-color:${escapeHtml(color)}"></span><b>${escapeHtml(name)}</b><span class="count">${items.length}</span></summary>
      <div class="list listComfortable">${items.length ? items.map(renderUrlRelationRow).join("") : `<div class="listEmpty">${escapeHtml(t("Nenhuma URL cadastrada neste ambiente."))}</div>`}</div>
    </details>`;
  }).join("");
  element.querySelectorAll("details.environmentAccordion").forEach((details) => details.addEventListener("toggle", () => {
    const key = details.dataset.accordionKey;
    details.open ? collapsedUrlAccordionIds.delete(key) : collapsedUrlAccordionIds.add(key);
  }));
}

// Shared badge summary for anything with environmentIds[]/productIds[] (test accounts, payment
// methods) — empty productIds means "all products", empty environmentIds only happens for
// payment methods (test accounts always require at least one).
function scopeBadgesHtml(item) {
  const environmentBadges = (item.environmentIds || []).map((environmentId) => findById("environments", environmentId)).filter(Boolean)
    .map((environment) => `<span class="relationBadge"><i style="--environment-color:${escapeHtml(environment.color)}"></i>${escapeHtml(environmentDisplayName(environment))}</span>`).join("");
  const productNames = (item.productIds || []).map((productId) => findById("products", productId)?.name).filter(Boolean);
  const productBadge = `<span class="relationBadge">${escapeHtml(productNames.length ? productNames.join(", ") : t("Todos os produtos"))}</span>`;
  return `${environmentBadges || `<span class="relationBadge">${escapeHtml(t("Todos os ambientes"))}</span>`}${productBadge}`;
}

// Every product bound to `environmentId` via any urlBinding — the reverse of
// environmentBoundProductNames above, used to gate the scope picker's Product column once an
// Environment checkbox is checked.
function productIdsForEnvironment(environmentId) {
  const ids = new Set();
  for (const binding of workspace.urlBindings || []) if ((binding.environmentIds || []).includes(environmentId)) ids.add(binding.productId);
  return ids;
}

// Cascading Client -> Project -> Environment -> Product multi-select shared by the Test Account
// and Payment Method composers (see options.html's #testAccountScopePicker/#paymentMethodScopePicker
// containers). Only
// environmentIds/productIds are ever persisted — Client/Project checkboxes exist purely to narrow
// the options below them (a test account/payment method has no direct client/project field of its
// own, since that's already implied by whichever product(s) it's scoped to).
//
// Rendered as four independent floating comboboxes (one per facet) rather than one big
// always-expanded 4-column grid — founder feedback: the grid version pushed the whole dialog open
// and was unreadable, nothing like a real combobox. Each facet now behaves like a normal <select>:
// closed by default, opens ITS OWN small floating panel (search + Todos/Limpar + a scrollable
// checkbox list) positioned over the rest of the form instead of shoving it downward, and closes
// on outside click, Escape, or picking a different facet.
const scopePickerStates = {
  testAccount: null,
  paymentMethod: null,
};

function freshScopePickerState(environmentIds = [], productIds = []) {
  return {
    clientIds: new Set(), projectIds: new Set(),
    environmentIds: new Set(environmentIds), productIds: new Set(productIds),
    search: { clientIds: "", projectIds: "", environmentIds: "", productIds: "" },
    openFacet: null,
  };
}

function resetScopePickerState(key, { environmentIds = [], productIds = [] } = {}) {
  scopePickerStates[key] = freshScopePickerState(environmentIds, productIds);
}

function scopePickerContainerId(key) {
  return key === "testAccount" ? "testAccountScopePicker" : "paymentMethodScopePicker";
}

function renderScopePicker(key, { requireEnvironment }) {
  const container = document.getElementById(scopePickerContainerId(key));
  if (!container) return;
  if (!scopePickerStates[key]) scopePickerStates[key] = freshScopePickerState();
  const state = scopePickerStates[key];

  const clientScoped = Boolean(state.clientIds.size || state.projectIds.size);
  const productClientProjectMatch = (product) => {
    const project = findById("projects", product.projectId);
    const clientOk = !state.clientIds.size || state.clientIds.has(project?.clientId);
    const projectOk = !state.projectIds.size || state.projectIds.has(product.projectId);
    return clientOk && projectOk;
  };
  const scopedProductIds = new Set(workspace.products.filter(productClientProjectMatch).map((product) => product.id));

  const visibleProjects = workspace.projects.filter((project) => !state.clientIds.size || state.clientIds.has(project.clientId) || state.projectIds.has(project.id));
  const visibleEnvironments = workspace.environments.filter((environment) => {
    if (!clientScoped) return true;
    if (state.environmentIds.has(environment.id)) return true;
    return [...scopedProductIds].some((productId) => productIdsForEnvironment(environment.id).has(productId));
  });
  const visibleProducts = workspace.products.filter((product) => {
    if (state.productIds.has(product.id)) return true;
    if (!productClientProjectMatch(product)) return false;
    if (!state.environmentIds.size) return true;
    const productEnvironmentIds = new Set();
    for (const binding of workspace.urlBindings || []) if (binding.productId === product.id) for (const environmentId of binding.environmentIds || []) productEnvironmentIds.add(environmentId);
    return [...state.environmentIds].some((environmentId) => productEnvironmentIds.has(environmentId));
  });

  const facets = [
    { field: "clientIds", title: t("Clientes"), items: workspace.clients, labeler: (item) => escapeHtml(item.name), optionText: (item) => item.name },
    { field: "projectIds", title: t("Projetos"), items: visibleProjects, labeler: (item) => escapeHtml(item.name), optionText: (item) => item.name },
    { field: "environmentIds", title: t("Ambientes"), items: visibleEnvironments, labeler: (item) => `<span class="scopeDot" style="--environment-color:${escapeHtml(item.color)}"></span>${escapeHtml(environmentDisplayName(item))}`, optionText: (item) => environmentDisplayName(item), required: requireEnvironment },
    { field: "productIds", title: t("Produtos"), items: visibleProducts, labeler: (item) => escapeHtml(item.name), optionText: (item) => item.name },
  ];

  const facetHtml = (facet, index) => {
    const selected = state[facet.field];
    const query = state.search[facet.field].trim().toLowerCase();
    const visibleItems = facet.items.filter((item) => !query || facet.optionText(item).toLowerCase().includes(query));
    const isOpen = state.openFacet === facet.field;
    const isEmpty = !selected.size;
    const emptyLabel = facet.required
      ? t("Selecione ao menos um ambiente")
      : t("Todos");
    return `
      <div class="scopeFacet${index === facets.length - 1 ? " alignRight" : ""}" data-facet="${facet.field}">
        <button type="button" class="scopeFacetTrigger${isOpen ? " isOpen" : ""}${facet.required && isEmpty ? " isRequiredEmpty" : ""}" data-facet-trigger="${facet.field}" aria-expanded="${isOpen}" aria-haspopup="listbox">
          <span>${escapeHtml(facet.title)}</span>
          ${selected.size ? `<span class="scopeFacetCount">${selected.size}</span>` : `<span class="scopeFacetPlaceholder">${escapeHtml(emptyLabel)}</span>`}
          <span class="scopeFacetCaret">${ICON("chevronDown")}</span>
        </button>
        <div class="scopeFacetPanel" ${isOpen ? "" : "hidden"} data-facet-panel="${facet.field}">
          <input type="search" class="scopeFacetSearch" data-facet-search="${facet.field}" value="${escapeHtml(state.search[facet.field])}" placeholder="${escapeHtml(t("Buscar {facet}", { facet: facet.title.toLowerCase() }))}" />
          <div class="scopeFacetActions">
            <button type="button" data-facet-all="${facet.field}">${escapeHtml(t("Todos"))}</button>
            <button type="button" data-facet-clear="${facet.field}">${escapeHtml(t("Limpar"))}</button>
          </div>
          <div class="scopeFacetOptions" data-facet-options="${facet.field}">${facet.items.map((item) => `<label data-option-text="${escapeHtml(facet.optionText(item).toLowerCase())}" ${visibleItems.includes(item) ? "" : "hidden"}><input type="checkbox" data-scope-field="${facet.field}" value="${escapeHtml(item.id)}" ${selected.has(item.id) ? "checked" : ""} /> ${facet.labeler(item)}</label>`).join("")}<span class="scopeFacetEmpty" data-facet-empty ${visibleItems.length ? "hidden" : ""}>${escapeHtml(t("Nada encontrado."))}</span></div>
        </div>
      </div>`;
  };

  container.innerHTML = facets.map(facetHtml).join("");

  container.querySelectorAll("[data-facet-trigger]").forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation();
    const field = button.dataset.facetTrigger;
    state.openFacet = state.openFacet === field ? null : field;
    renderScopePicker(key, { requireEnvironment });
  }));
  container.querySelectorAll("[data-scope-field]").forEach((input) => input.addEventListener("change", () => {
    const field = input.dataset.scopeField;
    input.checked ? state[field].add(input.value) : state[field].delete(input.value);
    renderScopePicker(key, { requireEnvironment });
  }));
  // Filtering-as-you-type toggles `hidden` on the already-rendered <label> rows instead of calling
  // renderScopePicker() again — a full re-render on every keystroke would blow away and recreate
  // this very <input>, kicking focus out of it after the first character typed.
  container.querySelectorAll("[data-facet-search]").forEach((input) => input.addEventListener("input", (event) => {
    const field = input.dataset.facetSearch;
    state.search[field] = event.target.value;
    const query = event.target.value.trim().toLowerCase();
    const optionsBox = container.querySelector(`[data-facet-options="${field}"]`);
    let visibleCount = 0;
    optionsBox.querySelectorAll("label[data-option-text]").forEach((label) => {
      const matches = !query || label.dataset.optionText.includes(query);
      label.hidden = !matches;
      if (matches) visibleCount += 1;
    });
    const emptyMessage = optionsBox.querySelector("[data-facet-empty]");
    if (emptyMessage) emptyMessage.hidden = visibleCount > 0;
  }));
  container.querySelectorAll("[data-facet-all]").forEach((button) => button.addEventListener("click", () => {
    const facet = facets.find((candidate) => candidate.field === button.dataset.facetAll);
    const query = state.search[facet.field].trim().toLowerCase();
    for (const item of facet.items) if (!query || facet.optionText(item).toLowerCase().includes(query)) state[facet.field].add(item.id);
    renderScopePicker(key, { requireEnvironment });
  }));
  container.querySelectorAll("[data-facet-clear]").forEach((button) => button.addEventListener("click", () => {
    state[button.dataset.facetClear].clear();
    renderScopePicker(key, { requireEnvironment });
  }));
  if (requireEnvironment && state.environmentIds.size) {
    const error = document.getElementById("testAccountScopeError");
    if (error) error.hidden = true;
  }
}

// One shared listener (bound once, never per-render) closes whichever facet panel is open when
// the user clicks anywhere outside the scope picker that owns it, or presses Escape — the normal
// way any floating combobox/dropdown is expected to behave.
function closeOpenScopeFacet(key) {
  const state = scopePickerStates[key];
  if (!state?.openFacet) return;
  state.openFacet = null;
  renderScopePicker(key, { requireEnvironment: key === "testAccount" });
}
document.addEventListener("click", (event) => {
  // composedPath() (the click's path at dispatch time) rather than container.contains(event.target):
  // checking/unchecking an option re-renders the panel from inside its own "change" handler, which
  // replaces the checkbox with a new node mid-bubble — by the time this listener runs on document,
  // `event.target` may already be detached, so `contains()` would (wrongly) call that an outside
  // click and slam the panel shut on every single selection.
  const path = event.composedPath();
  for (const key of Object.keys(scopePickerStates)) {
    const container = document.getElementById(scopePickerContainerId(key));
    if (container && !path.includes(container)) closeOpenScopeFacet(key);
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  for (const key of Object.keys(scopePickerStates)) closeOpenScopeFacet(key);
});

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
  renderUrlRelationList();
  renderUrlEnvironmentPicker();
  renderUrlPatternsPicker();
  renderRows("testAccounts", (item) => {
    const password = item.password ? (revealedAccountIds.has(item.id) ? escapeHtml(item.password) : "••••••••") : "—";
    // The toolbar's own read-only drawer already renders this image (renderTestAccountsList in
    // toolbar.js) — this options-page list never did, so the same uploaded/URL icon that shows
    // up later was invisible here while managing the account.
    const typeImage = item.accountTypeImage ? `<img src="${escapeHtml(item.accountTypeImage)}" alt="" style="width:16px;height:16px;border-radius:4px;object-fit:cover;vertical-align:middle;margin-right:4px" />` : "";
    return `<b>${typeImage}${escapeHtml(item.label)}${item.accountType ? ` <span class="accountType">${escapeHtml(item.accountType)}</span>` : ""}</b><small>${escapeHtml(item.username || "—")} · ${password}</small><small class="relationBadges">${scopeBadgesHtml(item)}</small>`;
  }, { reveal: (item) => Boolean(item.password) });
  renderCustomFieldSuggestions();
  renderRows("paymentMethods", (item) => {
    return `<b>${escapeHtml(item.label)}</b><small>${escapeHtml(t(item.type || "other"))} · ${escapeHtml(t(item.value ? "valor protegido" : "sem valor"))} · ${escapeHtml(item.notes || "")}</small><small class="relationBadges">${scopeBadgesHtml(item)}</small>`;
  });
  renderRows("inspectors", (item) => `<b>${escapeHtml(item.label)}</b><small>${escapeHtml((item.patterns || []).join(", "))}</small>`);
  renderRows("apis", (item) => `<b>${escapeHtml(item.label)}</b><small>${escapeHtml(item.baseUrl || "—")} · ${escapeHtml(t(item.token ? "token local configurado" : "sem token"))}</small>`);
  renderRows("resources", (item) => `<b>${escapeHtml(item.label)}</b><small>${escapeHtml(item.url || "—")}</small>`);
  renderSelect("projectClient", workspace.clients, t("Selecione o cliente"));
  renderSelect("productProject", workspace.projects, t("Selecione o projeto"));
  renderSelect("urlRelationProduct", workspace.products, t("Selecione o produto"));
  renderScopePicker("testAccount", { requireEnvironment: true });
  renderScopePicker("paymentMethod", { requireEnvironment: false });
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
  // Explicitly clicking a step chip opens its dialog (the user asked to go there) — but since
  // dialogs are real modals now (unlike the old inline <details>), auto-advancing the wizard
  // reactively on every render must NOT force one open unprompted; it only switches tabs and
  // draws attention to the "+ Adicionar" trigger, letting the founder open it when ready.
  const focusStep = (step) => {
    activateWorkspaceTab(step.tab, { syncNavigation: true });
    const composer = document.getElementById(step.composer);
    if (composer && !composer.open) composer.showModal();
    const target = document.getElementById(step.targetId);
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    target?.focus();
  };
  const revealStep = (step) => {
    activateWorkspaceTab(step.tab, { syncNavigation: true });
    const trigger = document.querySelector(`[data-open-composer="${step.composer}"]`);
    trigger?.scrollIntoView({ behavior: "smooth", block: "center" });
    trigger?.focus();
  };
  document.querySelectorAll("#wizardSteps [data-wizard-step]").forEach((item) => item.addEventListener("click", () => focusStep(steps[Number(item.dataset.wizardStep)])));
  if (activeIndex !== wizardLastActiveStep && accessState?.active && document.querySelector('[data-panel="workspace"]')?.classList.contains("isActive")) {
    wizardLastActiveStep = activeIndex;
    revealStep(steps[activeIndex]);
  }
}

// Founder feedback: with enough clients/products/accounts registered (especially ones carrying
// base64 logos/icons), saving felt sluggish because the UI waited for the full chrome.storage.local
// write to finish before showing anything. `workspace` is already the up-to-date in-memory object
// (upsert/cascadeRemove mutate it directly) — rendering it immediately makes every edit feel
// instant, and the storage round-trip (plus a second render, in case normalization changed
// anything) still happens right after, same as before.
async function persistWorkspace() {
  renderWorkspace();
  workspace = await saveWorkspace(workspace);
  renderWorkspace();
}

let workspaceSearchDebounce = null;
document.getElementById("workspaceSearch").addEventListener("input", (event) => {
  const value = event.target.value.trim().toLowerCase();
  window.clearTimeout(workspaceSearchDebounce);
  workspaceSearchDebounce = window.setTimeout(() => { searchQuery = value; renderWorkspace(); }, 150);
});

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
  if (prefix === "urlRelation") { urlSelectedEnvironmentIds = new Set(); renderUrlEnvironmentPicker(); urlPatternsDraft = []; renderUrlPatternsPicker(); }
  form.querySelectorAll("[data-image-group]").forEach((group) => {
    group.dataset.mode = "url";
    group.querySelectorAll("[data-image-mode]").forEach((button) => button.classList.toggle("isActive", button.dataset.imageMode === "url"));
    group.querySelector("[data-image-url]")?.dispatchEvent(new Event("input", { bubbles: true }));
  });
  if (prefix === "testAccount") {
    testAccountCustomFieldsDraft = [];
    renderCustomFieldsEditor();
    resetScopePickerState("testAccount");
    renderScopePicker("testAccount", { requireEnvironment: true });
    const scopeError = document.getElementById("testAccountScopeError");
    if (scopeError) scopeError.hidden = true;
  }
  if (prefix === "paymentMethod") {
    resetScopePickerState("paymentMethod");
    renderScopePicker("paymentMethod", { requireEnvironment: false });
  }
  const composer = document.getElementById(`${prefix}Composer`);
  if (composer?.open) composer.close();
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
  renderCustomFieldSuggestions();
}

// Field *definitions* (name + type) used on any test account are remembered and offered when
// adding/editing any other account — founder feedback: a field created on one account wasn't
// available on the next, forcing it to be retyped every time. Only the schema is shared here;
// each account's own value is never suggested, since values are account-specific.
function knownCustomFieldTemplates() {
  const seen = new Map();
  for (const account of workspace.testAccounts || []) {
    for (const field of account.customFields || []) {
      const key = String(field.key || "").trim();
      if (!key) continue;
      seen.set(key.toLowerCase(), { key, type: field.type || "string" });
    }
  }
  return [...seen.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function renderCustomFieldSuggestions() {
  const container = document.getElementById("testAccountFieldSuggestions");
  if (!container) return;
  const usedKeys = new Set(testAccountCustomFieldsDraft.map((field) => String(field.key || "").trim().toLowerCase()));
  const suggestions = knownCustomFieldTemplates().filter((template) => !usedKeys.has(template.key.toLowerCase()));
  if (!suggestions.length) { container.innerHTML = ""; return; }
  container.innerHTML = `<small>${escapeHtml(t("Campos já usados em outras contas:"))}</small><div class="fieldSuggestionRow">${suggestions.map((template) => `<button type="button" class="fieldSuggestionChip" data-add-known-field="${escapeHtml(template.key)}" data-known-field-type="${escapeHtml(template.type)}">+ ${escapeHtml(template.key)}</button>`).join("")}</div>`;
  container.querySelectorAll("[data-add-known-field]").forEach((button) => button.addEventListener("click", () => {
    testAccountCustomFieldsDraft.push({ key: button.dataset.addKnownField, type: button.dataset.knownFieldType, value: button.dataset.knownFieldType === "boolean" ? false : "" });
    renderCustomFieldsEditor();
  }));
}
document.getElementById("testAccountAddField").addEventListener("click", () => {
  testAccountCustomFieldsDraft.push({ key: "", type: "string", value: "" });
  renderCustomFieldsEditor();
});
document.querySelectorAll(".cancelEdit").forEach((button) => button.addEventListener("click", () => clearEdit(button.dataset.cancel)));

// Every create/edit form lives in a <dialog> now (centered modal) instead of an inline
// <details> below its list — "+ Adicionar X" triggers open it, the × in the header (or Esc,
// native to <dialog>) closes it without saving.
document.querySelectorAll("[data-open-composer]").forEach((button) => button.addEventListener("click", () => {
  const dialog = document.getElementById(button.dataset.openComposer);
  if (dialog && !dialog.open) dialog.showModal();
}));
document.querySelectorAll("[data-close-composer]").forEach((button) => button.addEventListener("click", () => button.closest("dialog")?.close()));

// Promise-based replacement for window.confirm(...) so deletion confirmation is a themed modal
// (consistent with every other dialog) instead of the browser's native alert box.
function confirmDialog(message) {
  return new Promise((resolve) => {
    const dialog = document.getElementById("deleteConfirmDialog");
    document.getElementById("deleteConfirmBody").textContent = message;
    const accept = document.getElementById("deleteConfirmAccept");
    const cancel = document.getElementById("deleteConfirmCancel");
    const settle = (result) => {
      accept.removeEventListener("click", onAccept);
      cancel.removeEventListener("click", onCancel);
      dialog.removeEventListener("close", onCancel);
      if (dialog.open) dialog.close();
      resolve(result);
    };
    const onAccept = () => settle(true);
    const onCancel = () => settle(false);
    accept.addEventListener("click", onAccept);
    cancel.addEventListener("click", onCancel);
    dialog.addEventListener("close", onCancel); // Esc key or clicking the × also cancels
    dialog.showModal();
  });
}

document.getElementById("clientForm").addEventListener("submit", async (event) => { event.preventDefault(); const editId = document.getElementById("clientEditId").value; upsert("clients", { id: editId || uid("client"), name: document.getElementById("clientName").value.trim(), ...appearance("client") }, editId); clearEdit("client"); await persistWorkspace(); });
document.getElementById("projectForm").addEventListener("submit", async (event) => { event.preventDefault(); const editId = document.getElementById("projectEditId").value; upsert("projects", { id: editId || uid("project"), clientId: document.getElementById("projectClient").value, name: document.getElementById("projectName").value.trim(), ...appearance("project") }, editId); clearEdit("project"); await persistWorkspace(); });
document.getElementById("productForm").addEventListener("submit", async (event) => { event.preventDefault(); const editId = document.getElementById("productEditId").value; upsert("products", { id: editId || uid("product"), projectId: document.getElementById("productProject").value, name: document.getElementById("productName").value.trim(), ...appearance("product") }, editId); clearEdit("product"); await persistWorkspace(); });
// "+ Novo ambiente" inside the URL relation modal opens this same dialog nested on top of it
// (stacked <dialog>s, standard behavior) — when that's how it was opened, the freshly created
// environment should land pre-selected back in the URL modal's picker instead of the founder
// having to find and toggle it themselves right after.
let pendingUrlEnvironmentAutoSelect = false;
document.getElementById("urlRelationAddEnvironment").addEventListener("click", () => { pendingUrlEnvironmentAutoSelect = true; });
// Cancelling (Esc or ×) instead of saving must not leave the flag armed for the next time the
// environment composer is opened normally (e.g. from the Environments tab).
document.getElementById("environmentComposer").addEventListener("close", () => { pendingUrlEnvironmentAutoSelect = false; });
document.getElementById("environmentForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const editId = document.getElementById("environmentEditId").value;
  const newId = editId || uid("env");
  upsert("environments", { id: newId, name: document.getElementById("environmentName").value.trim(), color: document.getElementById("environmentColor").value, active: true }, editId);
  if (pendingUrlEnvironmentAutoSelect && !editId) { urlSelectedEnvironmentIds.add(newId); renderUrlEnvironmentPicker(); }
  pendingUrlEnvironmentAutoSelect = false;
  clearEdit("environment");
  await persistWorkspace();
});

document.getElementById("testAccountForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const scope = scopePickerStates.testAccount;
  if (!scope.environmentIds.size) { document.getElementById("testAccountScopeError").hidden = false; return; }
  const editId = document.getElementById("testAccountEditId").value;
  const existing = findById("testAccounts", editId);
  const password = document.getElementById("testAccountPassword").value;
  upsert("testAccounts", { id: editId || uid("account"), environmentIds: [...scope.environmentIds], productIds: [...scope.productIds], label: document.getElementById("testAccountLabel").value.trim(), accountType: document.getElementById("testAccountType").value.trim(), accountTypeImage: document.getElementById("testAccountTypeImage").value.trim(), username: document.getElementById("testAccountUsername").value.trim(), password: password || existing?.password || "", notes: document.getElementById("testAccountNotes").value.trim(), customFields: testAccountCustomFieldsDraft, active: true }, editId);
  clearEdit("testAccount");
  await persistWorkspace();
});
document.getElementById("paymentMethodForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const scope = scopePickerStates.paymentMethod;
  const editId = document.getElementById("paymentMethodEditId").value;
  const existing = findById("paymentMethods", editId);
  upsert("paymentMethods", { id: editId || uid("payment"), environmentIds: [...scope.environmentIds], productIds: [...scope.productIds], label: document.getElementById("paymentMethodLabel").value.trim(), type: document.getElementById("paymentMethodType").value, icon: document.getElementById("paymentMethodIcon").value.trim(), value: document.getElementById("paymentMethodValue").value.trim() || existing?.value || "", holder: document.getElementById("paymentMethodHolder").value.trim(), expiry: document.getElementById("paymentMethodExpiry").value.trim(), cvv: document.getElementById("paymentMethodCvv").value.trim() || existing?.cvv || "", notes: document.getElementById("paymentMethodNotes").value.trim(), active: true }, editId);
  clearEdit("paymentMethod");
  await persistWorkspace();
});
document.getElementById("inspectorForm").addEventListener("submit", async (event) => { event.preventDefault(); const editId = document.getElementById("inspectorEditId").value; upsert("inspectors", { id: editId || uid("inspector"), label: document.getElementById("inspectorLabel").value.trim(), patterns: document.getElementById("inspectorPatterns").value.split(/\n|,/).map((v) => v.trim()).filter(Boolean), active: true }, editId); clearEdit("inspector"); await persistWorkspace(); });
document.getElementById("apiForm").addEventListener("submit", async (event) => { event.preventDefault(); const editId = document.getElementById("apiEditId").value; const existing = findById("apis", editId); upsert("apis", { id: editId || uid("api"), label: document.getElementById("apiLabel").value.trim(), baseUrl: document.getElementById("apiBaseUrl").value.trim(), token: document.getElementById("apiToken").value || existing?.token || "", active: true }, editId); clearEdit("api"); await persistWorkspace(); });
document.getElementById("resourceForm").addEventListener("submit", async (event) => { event.preventDefault(); const editId = document.getElementById("resourceEditId").value; upsert("resources", { id: editId || uid("resource"), label: document.getElementById("resourceLabel").value.trim(), url: document.getElementById("resourceUrl").value.trim(), category: document.getElementById("resourceCategory").value.trim(), icon: document.getElementById("resourceIcon").value.trim(), active: true }, editId); clearEdit("resource"); await persistWorkspace(); });

document.getElementById("urlPatternAdd").addEventListener("click", () => addUrlPatternDraft());
document.getElementById("urlPatternInput").addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  addUrlPatternDraft();
});

// The founder's own request: drop the manual "URL principal" field entirely — the first pattern
// added is almost always the concrete, no-wildcard entry point anyway, so just derive it instead
// of asking for it twice. Trailing wildcard(s) are stripped so it opens as a real URL, not
// literally "…/*"; anything that still isn't a plain http(s) URL after that (e.g. `*://host/*`)
// is left blank, same as storage.js's own normalizeUrlBinding would do with a bad value.
function derivePrimaryUrl(pattern) {
  const stripped = String(pattern || "").replace(/\*+$/, "");
  return /^https?:\/\//i.test(stripped) ? stripped : "";
}

document.getElementById("urlRelationForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const patternInput = document.getElementById("urlPatternInput");
  // A URL still sitting in the input (typed but not explicitly added) counts too — otherwise
  // submitting silently drops it, which is exactly the confusing "só salva o que já virou pill"
  // trap this rework is meant to fix.
  if (patternInput.value.trim()) addUrlPatternDraft();
  if (!urlSelectedEnvironmentIds.size) { patternInput.setCustomValidity(t("Selecione pelo menos um ambiente.")); patternInput.reportValidity(); return; }
  if (!urlPatternsDraft.length) { patternInput.setCustomValidity(t("Informe ao menos uma URL ou padrão válido.")); patternInput.reportValidity(); return; }
  patternInput.setCustomValidity("");
  const editId = document.getElementById("urlRelationEditId").value;
  upsert("urlBindings", {
    id: editId || uid("binding"),
    patterns: [...urlPatternsDraft],
    productId: document.getElementById("urlRelationProduct").value,
    environmentIds: [...urlSelectedEnvironmentIds],
    primaryUrl: derivePrimaryUrl(urlPatternsDraft[0]),
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
  if (composer && !composer.open) composer.showModal();
  document.getElementById(`${prefix}EditId`).value = item.id;
  document.querySelector(`[data-cancel="${prefix}"]`).hidden = false;
  const values = {
    clients: { clientName: item.name, clientLogoUrl: item.logoUrl, clientAbbreviation: item.abbreviation, clientShowLabel: item.showLabel !== false },
    projects: { projectClient: item.clientId, projectName: item.name, projectLogoUrl: item.logoUrl, projectAbbreviation: item.abbreviation, projectShowLabel: item.showLabel !== false },
    products: { productProject: item.projectId, productName: item.name, productLogoUrl: item.logoUrl, productAbbreviation: item.abbreviation, productShowLabel: item.showLabel !== false },
    environments: { environmentName: item.name, environmentColor: item.color },
    urlBindings: { urlRelationProduct: item.productId, urlPatternInput: "" },
    testAccounts: { testAccountLabel: item.label, testAccountType: item.accountType, testAccountTypeImage: item.accountTypeImage, testAccountUsername: item.username, testAccountPassword: "", testAccountNotes: item.notes },
    paymentMethods: { paymentMethodLabel: item.label, paymentMethodType: item.type, paymentMethodIcon: item.icon, paymentMethodValue: "", paymentMethodHolder: item.holder, paymentMethodExpiry: item.expiry, paymentMethodCvv: "", paymentMethodNotes: item.notes },
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
    resetScopePickerState("testAccount", { environmentIds: item.environmentIds || [], productIds: item.productIds || [] });
    renderScopePicker("testAccount", { requireEnvironment: true });
  }
  if (collection === "paymentMethods") {
    resetScopePickerState("paymentMethod", { environmentIds: item.environmentIds || [], productIds: item.productIds || [] });
    renderScopePicker("paymentMethod", { requireEnvironment: false });
  }
  if (collection === "urlBindings") {
    urlSelectedEnvironmentIds = new Set(item.environmentIds || []);
    renderUrlEnvironmentPicker();
    urlPatternsDraft = [...(item.patterns || [])];
    renderUrlPatternsPicker();
  }
  document.getElementById(`${prefix}Form`).scrollIntoView({ behavior: "smooth", block: "center" });
}

// Environments are reusable across products now (see storage.js's normalizeUrlBindings), so
// removing a client/project/product no longer deletes environments — only the URL bindings and
// product-scoped test accounts/payment methods that actually belong to the removed product(s).
// An environment itself only goes away when removed directly from the "Ambientes" tab.
// Test accounts/payment methods can be scoped to several environments/products at once, so
// removing just one of those no longer has to delete the whole item — only when pruning the
// removed id(s) out of a REQUIRED-non-empty field (or out of an already-scoped optional one)
// would leave it with zero left does the item disappear entirely. An item whose field was already
// empty (payment methods' "applies to every environment/product") is untouched either way.
function pruneScopedCollection(items, field, removeIds) {
  return items
    .map((item) => {
      if (!item[field] || !item[field].length) return item;
      const next = item[field].filter((value) => !removeIds.has(value));
      return next.length ? { ...item, [field]: next } : null;
    })
    .filter(Boolean);
}

function cascadeRemove(collection, removeId) {
  const removeSet = (key, predicate) => { workspace[key] = workspace[key].filter((item) => !predicate(item)); };
  const dropProducts = (productIds) => {
    removeSet("urlBindings", (item) => productIds.has(item.productId));
    workspace.testAccounts = pruneScopedCollection(workspace.testAccounts, "productIds", productIds);
    workspace.paymentMethods = pruneScopedCollection(workspace.paymentMethods, "productIds", productIds);
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
    const removeIdSet = new Set([removeId]);
    workspace.testAccounts = pruneScopedCollection(workspace.testAccounts, "environmentIds", removeIdSet);
    workspace.paymentMethods = pruneScopedCollection(workspace.paymentMethods, "environmentIds", removeIdSet);
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
  if (action === "remove") { if (!(await confirmDialog(t("Excluir este item? Itens dependentes também serão removidos.")))) return; cascadeRemove(collection, id); await persistWorkspace(); }
});

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Shared by the real export button and the "download template" button below — both need the same
// {format, version, checksum} envelope so a template downloaded today always matches whatever this
// build's schema/checksum rules currently are, instead of a hand-written static file going stale.
async function buildExportEnvelope(workspaceData, filenamePrefix) {
  const exportable = structuredClone(workspaceData);
  exportable.testAccounts = exportable.testAccounts.map(({ password, ...item }) => item);
  exportable.paymentMethods = exportable.paymentMethods.map(({ value, cvv, ...item }) => item);
  exportable.apis = exportable.apis.map(({ token, ...item }) => item);
  const checksum = `sha256:${await sha256Hex(JSON.stringify(exportable))}`;
  const blob = new Blob([JSON.stringify({ format: "qts-workspace", version: 2, exportedAt: new Date().toISOString(), checksum, workspace: exportable }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${filenamePrefix}-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 5_000);
}

document.getElementById("exportButton").addEventListener("click", () => buildExportEnvelope(workspace, "qa-toolbar-workspace"));
document.getElementById("downloadTemplateButton").addEventListener("click", () => {
  // A minimal, generic (no real customer name) one-of-*everything* workspace — normalized the
  // same way an import would be, so this is guaranteed to be a file that imports cleanly. Founder
  // feedback: the old template only had structure/URL examples, so a hand-edited copy that also
  // needed test accounts or payment methods had no shape to copy from and came out wrong (most
  // often the old singular environmentId/productId instead of the current environmentIds[]/
  // productIds[] arrays). Every importable collection gets a real example now.
  const template = normalizeWorkspace({
    clients: [{ id: "client-exemplo", name: "Cliente Exemplo" }],
    projects: [{ id: "project-exemplo", clientId: "client-exemplo", name: "Projeto Exemplo" }],
    products: [{ id: "product-exemplo", projectId: "project-exemplo", name: "Produto Exemplo" }],
    environments: [{ id: "env-exemplo", name: "QA", color: "#7657ff" }],
    urlBindings: [{ id: "binding-exemplo", patterns: ["https://app.exemplo.com/*"], productId: "product-exemplo", environmentIds: ["env-exemplo"] }],
    // password/value/cvv are omitted here on purpose (not just left blank): buildExportEnvelope
    // strips them from every export anyway, real or template, so a placeholder here would never
    // actually reach the downloaded file — and a fake-looking secret string in source is exactly
    // what a credential scanner should (correctly) refuse to let through.
    testAccounts: [{
      id: "account-exemplo", environmentIds: ["env-exemplo"], productIds: ["product-exemplo"],
      label: "Conta Exemplo", accountType: "Padrão", username: "qa.teste@exemplo.com",
      notes: "Uso exclusivo sandbox.", customFields: [{ key: "Plano", type: "string", value: "Gold" }],
    }],
    paymentMethods: [{
      id: "payment-exemplo", environmentIds: ["env-exemplo"], productIds: [],
      label: "Cartão Exemplo", type: "card", holder: "Sandbox QA",
      expiry: "12/2030", notes: "Somente sandbox.",
    }],
    apis: [{ id: "api-exemplo", label: "API Exemplo", baseUrl: "https://api.exemplo.com", token: "" }],
    inspectors: [{ id: "inspector-exemplo", label: "Inspector Exemplo", patterns: ["*/api/*"] }],
    resources: [{ id: "resource-exemplo", label: "Recurso Exemplo", url: "https://exemplo.com/docs", category: "Documentação" }],
    macros: [{ id: "macro-exemplo", name: "Macro Exemplo", description: "Exemplo de macro gravada.", steps: [{ action: "click", selector: "#exemplo-botao" }] }],
  });
  void buildExportEnvelope(template, "qa-toolbar-template");
});
// normalizeWorkspace() is deliberately forgiving (it has to be — it's also what reads whatever's
// already in local storage across schema versions, and silently healing a slightly-off value
// there is the right call). An imported *file* is different: a junk entry here almost always
// means the file itself is wrong (hand-edited badly, wrong file picked, truncated download), and
// silently turning `"a string"` or `null` into a fake "Cliente 2" with zero indication is exactly
// the "imported with errors" the founder ran into. So the import path validates the raw shape
// first and refuses the whole file rather than normalizing garbage into phantom records.
const IMPORTABLE_COLLECTIONS = ["clients", "projects", "products", "environments", "urlBindings", "testAccounts", "paymentMethods", "apis", "inspectors", "resources", "macros"];
function validateImportShape(candidate) {
  for (const key of IMPORTABLE_COLLECTIONS) {
    const value = candidate[key];
    if (value === undefined) continue;
    if (!Array.isArray(value)) throw new Error(`"${key}" deveria ser uma lista`);
    const badIndex = value.findIndex((item) => item === null || typeof item !== "object" || Array.isArray(item));
    if (badIndex !== -1) throw new Error(`"${key}" tem um registro inválido na posição ${badIndex + 1}`);
  }
}

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
    validateImportShape(candidate);
    workspace = normalizeWorkspace(candidate);
    await persistWorkspace();
    document.getElementById("dataHint").textContent = t("Importado: {clients} cliente(s), {environments} ambiente(s). URLs e vínculos foram normalizados.", { clients: workspace.clients.length, environments: workspace.environments.length });
  } catch (error) { workspace = previousWorkspace; renderWorkspace(); document.getElementById("dataHint").textContent = t("Falha ao importar: {error}. O workspace anterior foi preservado.", { error: t(error.message) }); }
  event.target.value = "";
});
async function loadLegalStatus() {
  const record = await window.QTS_LEGAL.fetchLegalRegistration();
  if (!record) {
    document.getElementById("legalStatusTitle").textContent = "Informações jurídicas indisponíveis no momento.";
    return;
  }
  const copy = window.QTS_LEGAL.resolveStatusText(record, currentLocale);
  document.getElementById("legalStatusTitle").textContent = copy.title;
  const staleNote = record.stale ? ` (última verificação: ${window.QTS_LEGAL.formatDate(record.updatedAt?.slice(0, 10), currentLocale) || "offline"})` : "";
  document.getElementById("legalStatusBody").textContent = `${copy.body}${copy.disclaimer ? ` ${copy.disclaimer}` : ""}${staleNote}`;
}

document.getElementById("resetButton").addEventListener("click", async () => {
  if (!(await confirmDialog(t("Apagar somente o workspace local? Sua conta e assinatura não serão removidas.")))) return;
  workspace = window.QTS_STORAGE.createEmptyWorkspace(); await persistWorkspace(); document.getElementById("dataHint").textContent = t("Workspace local resetado.");
});

(async () => {
  await loadLocale();
  workspace = await getWorkspace();
  await loadScopeUi();
  renderWorkspace();
  await loadAccess(true);
  void loadLegalStatus();
  onStorageChanged(async (changes) => {
    if (!changes[STORAGE_KEYS.workspace]) return;
    workspace = await getWorkspace();
    renderWorkspace();
  });
})();
