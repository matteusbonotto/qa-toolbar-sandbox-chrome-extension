const { getWorkspace, saveWorkspace, getSiteScope, saveSiteScope, normalizeWorkspace, normalizeUrlPatterns, onStorageChanged, STORAGE_KEYS } = window.QTS_STORAGE;
const ICON = window.QTS_ICONS.svg;
document.querySelectorAll("[data-qts-icon]").forEach((slot) => {
  slot.innerHTML = ICON(slot.dataset.qtsIcon);
});

let imageEditorTarget = null;
let imageEditorImage = null;

function applyAppearanceTheme(theme) {
  const normalized = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = normalized;
  const select = document.getElementById("appearanceTheme");
  if (select) select.value = normalized;
  document.querySelectorAll("[data-theme-choice]").forEach((button) => {
    const selected = button.dataset.themeChoice === normalized;
    button.classList.toggle("isSelected", selected);
    button.setAttribute("aria-checked", String(selected));
  });
}

document.getElementById("appearanceThemeToggle")?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-theme-choice]");
  if (!button) return;
  const theme = button.dataset.themeChoice;
  applyAppearanceTheme(theme);
  if (!workspace) return;
  const currentFamily = String(workspace.preferences?.colorTheme || "blue-light").replace(/-(?:light|dark)$/, "");
  const family = window.QTS_THEME_PRESETS.families.includes(currentFamily) ? currentFamily : "blue";
  const colorTheme = `${family}-${theme}`;
  applyColorThemeToPage(colorTheme);
  workspace.preferences = { ...(workspace.preferences || {}), appearanceTheme: theme, colorTheme };
  await saveWorkspace(workspace);
  renderColorThemeGrid(colorTheme);
  document.getElementById("generalSavedHint").textContent = t("Salvo - a barra já foi atualizada.");
});

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
let selectedStructureClientId = null;
let selectedStructureProjectId = null;
let structureViewMode = "client";
let accessState = null;
let currentLocale = "pt-BR";
let searchQuery = "";
let activeWorkspaceTab = "structure";
let wizardOptionalComposerKey = null;
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
  accountTypes: { listId: "accountTypeList", prefix: "accountType" },
  paymentMethodTypes: { listId: "paymentMethodTypeList", prefix: "paymentMethodType" },
  inspectors: { listId: "inspectorList", prefix: "inspector" },
  apis: { listId: "apiList", prefix: "api" },
  resources: { listId: "resourceList", prefix: "resource" },
  operatingSystems: { listId: "operatingSystemList", prefix: "operatingSystem" },
  browsers: { listId: "browserList", prefix: "browser" },
  devices: { listId: "deviceList", prefix: "device" },
};

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function runtimeMessage(message) {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, (response) => {
    const runtimeError = chrome.runtime.lastError;
    if (runtimeError) {
      resolve({ ok: false, error: "extension_connection_failed", detail: runtimeError.message });
      return;
    }
    resolve(response ?? { ok: false, error: "extension_no_response" });
  }));
}

const NAV_WORKSPACE_ROUTES = Object.freeze({ workspace: "structure", "test-data": "accounts", integrations: "integrations" });

function activateWorkspaceTab(tabName, { syncNavigation = false } = {}) {
  if (tabName === "environments") tabName = "urls";
  const target = document.querySelector(`[data-workspace-pane="${tabName}"]`) ? tabName : "structure";
  activeWorkspaceTab = target;
  document.querySelectorAll(".workspaceTab").forEach((item) => {
    const active = item.dataset.workspaceTab === target;
    item.classList.toggle("isActive", active);
    item.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll(".workspacePane").forEach((pane) => pane.classList.toggle("isActive", pane.dataset.workspacePane === target));
  document.querySelectorAll("[data-workspace-nav]").forEach((item) => {
    const active = item.dataset.workspaceNav === target;
    item.classList.toggle("isActive", active);
    item.setAttribute("aria-current", active ? "page" : "false");
  });
  if (syncNavigation) document.querySelectorAll(".navItem").forEach((item) => item.classList.toggle("isActive", item.dataset.tab === "workspace"));
}

function switchTab(tabName, { allowInactive = false } = {}) {
  if (tabName !== "account" && !accessState?.active && !allowInactive) tabName = "account";
  document.querySelectorAll(".navItem").forEach((item) => item.classList.toggle("isActive", item.dataset.tab === tabName));
  const workspaceRoute = NAV_WORKSPACE_ROUTES[tabName];
  const panelName = workspaceRoute ? "workspace" : tabName;
  document.querySelectorAll(".panel").forEach((panel) => panel.classList.toggle("isActive", panel.dataset.panel === panelName));
  document.getElementById("workspaceNavSubmenu").hidden = panelName !== "workspace";
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
  renderTutorialPanel(); // plan-gated lock badges depend on accessState.features, refreshed here too
  renderTutorialBanner();
  return active;
}

document.querySelectorAll(".navItem").forEach((item) => item.addEventListener("click", () => switchTab(item.dataset.tab)));
document.querySelectorAll(".workspaceTab").forEach((item) => item.addEventListener("click", () => activateWorkspaceTab(item.dataset.workspaceTab, { syncNavigation: true })));
document.querySelectorAll("[data-workspace-nav]").forEach((item) => item.addEventListener("click", () => {
  switchTab("workspace");
  activateWorkspaceTab(item.dataset.workspaceNav, { syncNavigation: true });
}));
document.querySelectorAll("[data-workspace-shortcut]").forEach((item) => item.addEventListener("click", () => {
  activateWorkspaceTab(item.dataset.workspaceShortcut, { syncNavigation: true });
  document.querySelector(".workspaceStudio")?.scrollIntoView({ behavior: "smooth", block: "start" });
}));
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
    const messages = {
      authentication_failed: "E-mail ou senha inválidos.",
      invalid_credentials: "Informe um e-mail válido e uma senha com pelo menos 8 caracteres.",
      rate_limit_exceeded: "Muitas tentativas. Aguarde alguns minutos.",
      access_required: "Conta válida, mas sem acesso ativo.",
      origin_not_allowed: "Esta instalação local não está autorizada pelo servidor. Recarregue a versão oficial ou o pacote de teste identificado.",
      extension_connection_failed: "A extensão foi atualizada, mas o processo interno ainda não recarregou. Recarregue-a em chrome://extensions e tente novamente.",
      extension_no_response: "A extensão não respondeu. Recarregue-a em chrome://extensions e tente novamente.",
    };
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
      voucher_requires_checkout: "Este é um voucher de desconto - aplique-o na tela de checkout do site.",
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
  const supportedMode = scope.mode === "all" ? "all" : "environments";
  document.querySelectorAll('input[name="scopeMode"]').forEach((input) => { input.checked = input.value === supportedMode; });
}

// The Settings page has its own separate CSS token system (--accent/--on-accent in options.css,
// not the --qts-ui-* tokens toolbar.js sets on the page it's injected into) since this page is
// the extension's own chrome.runtime page, not a content script -- so the chosen color theme needs
// its own application point here too, or Settings would keep the fixed purple accent regardless of
// what preset the user picked (exactly the founder-reported gap: "a tela de configurações também
// deveria refletir com os temas selecionados").
function applyColorThemeToPage(colorTheme) {
  const preset = window.QTS_THEME_PRESETS?.presets.find((item) => item.id === colorTheme);
  const semantics = preset ? window.QTS_THEME_PRESETS.semantics[preset.mode] : null;
  const root = document.documentElement.style;
  if (preset) {
    root.setProperty("--accent", preset.primary);
    root.setProperty("--on-accent", preset.primaryContrast);
    root.setProperty("--danger", preset.danger || semantics.danger);
    root.setProperty("--accent-2", preset.secondary || semantics.secondary);
  } else {
    root.removeProperty("--accent");
    root.removeProperty("--on-accent");
    root.removeProperty("--danger");
  }
}

// A visual preview of the option instead of a plain word in a <select> - "top" reads faster as a
// little highlighted top edge than as text, especially across 4 near-identical toolbar options
// that only differ by one word. `kind: "bar"` (toolbar dock) draws a thin highlighted strip on the
// chosen edge; `kind: "panel"` (sidebar dock) draws a thicker one, echoing how much of that edge
// each element actually occupies on the real page.
function positionPickerIcon(kind, side) {
  const stripThickness = kind === "panel" ? 5 : 2.2;
  const x = 1, y = 1, w = 20, h = 14;
  const strip = side === "top" ? `x="${x}" y="${y}" width="${w}" height="${stripThickness}"`
    : side === "bottom" ? `x="${x}" y="${y + h - stripThickness}" width="${w}" height="${stripThickness}"`
      : side === "left" ? `x="${x}" y="${y}" width="${stripThickness}" height="${h}"`
        : `x="${x + w - stripThickness}" y="${y}" width="${stripThickness}" height="${h}"`;
  return `<svg viewBox="0 0 22 16" width="22" height="16" aria-hidden="true"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.4" opacity=".5"></rect><rect ${strip} rx="1.1" fill="currentColor"></rect></svg>`;
}

// Renders/re-renders a segmented icon-button group into `#${id}` (replaces what used to be a
// plain <select> for toolbar/sidebar position) and wires click-to-select. The chosen value lives
// in the container's `dataset.value` - read it back with pickerValue(id), same spirit as
// `select.value` but for a widget with no native value of its own.
function renderPositionPicker(id, { kind, options, current, label }) {
  const container = document.getElementById(id);
  if (!container) return;
  container.className = "positionPicker";
  container.setAttribute("role", "radiogroup");
  if (label) container.setAttribute("aria-label", t(label));
  container.dataset.value = current;
  const previewIds = {
    drawerPosition: "drawerPositionPreview",
    toolbarPosition: "toolbarPositionPreview",
    mobileDrawerPosition: "mobileDrawerPositionPreview",
    mobileToolbarPosition: "mobileToolbarPositionPreview",
  };
  const preview = document.getElementById(previewIds[id] || "");
  if (preview) preview.dataset.position = current;
  container.innerHTML = options.map(({ value, title }) => `<button type="button" class="positionPickerBtn" data-value="${value}" title="${escapeHtml(t(title))}" aria-pressed="${value === current}">${positionPickerIcon(kind, value)}</button>`).join("");
  container.querySelectorAll(".positionPickerBtn").forEach((button) => {
    button.addEventListener("click", () => {
      container.dataset.value = button.dataset.value;
      if (preview) preview.dataset.position = button.dataset.value;
      container.querySelectorAll(".positionPickerBtn").forEach((btn) => btn.setAttribute("aria-pressed", String(btn === button)));
    });
  });
}

function pickerValue(id) {
  return document.getElementById(id)?.dataset.value || "";
}

const TOOLBAR_POSITION_OPTIONS = [
  { value: "top", title: "Horizontal - cima" },
  { value: "bottom", title: "Horizontal - baixo" },
  { value: "left", title: "Vertical - esquerda" },
  { value: "right", title: "Vertical - direita" },
];

function loadPreferenceUi() {
  const preferences = workspace.preferences || {};
  applyColorThemeToPage(preferences.colorTheme || null);
  document.getElementById("appearanceTheme").value = preferences.appearanceTheme === "light" ? "light" : "dark";
  applyAppearanceTheme(document.getElementById("appearanceTheme").value);
  document.getElementById("compactMode").checked = preferences.compactMode === true;
  compactEntitiesDraft = { ...(preferences.compactEntities || { project: preferences.compactMode === true, product: preferences.compactMode === true }) };
  document.getElementById("pushSiteContent").checked = preferences.pushSiteContent !== false;
  document.getElementById("pushSiteContentForDrawer").checked = preferences.pushSiteContentForDrawer === true;
  document.getElementById("soundEffects").checked = preferences.soundEffects !== false;
  document.getElementById("remindTestStatusOnRecording").checked = preferences.remindTestStatusOnRecording === true;
  renderPositionPicker("drawerPosition", {
    kind: "panel", label: "Posição do sidebar (desktop)",
    current: ["left", "right", "top", "bottom"].includes(preferences.drawerPosition) ? preferences.drawerPosition : "right",
    options: [{ value: "right", title: "Direita" }, { value: "left", title: "Esquerda" }, { value: "top", title: "Cima" }, { value: "bottom", title: "Baixo" }],
  });
  renderPositionPicker("toolbarPosition", { kind: "bar", label: "Posição da toolbar (desktop)", current: ["top", "bottom", "left", "right"].includes(preferences.toolbarPosition) ? preferences.toolbarPosition : "top", options: TOOLBAR_POSITION_OPTIONS });
  renderPositionPicker("mobileDrawerPosition", {
    kind: "panel", label: "Posição do sidebar (mobile)",
    current: ["left", "right", "top", "bottom"].includes(preferences.mobileDrawerPosition) ? preferences.mobileDrawerPosition : "bottom",
    options: [{ value: "bottom", title: "Baixo - bottom sheet" }, { value: "top", title: "Cima" }, { value: "right", title: "Direita" }, { value: "left", title: "Esquerda" }],
  });
  renderPositionPicker("mobileToolbarPosition", { kind: "bar", label: "Posição da toolbar (mobile)", current: ["top", "bottom", "left", "right"].includes(preferences.mobileToolbarPosition) ? preferences.mobileToolbarPosition : "top", options: TOOLBAR_POSITION_OPTIONS });
  document.getElementById("avatarShape").value = preferences.avatarShape === "round" ? "round" : "square";
  pinnedToolsDraft = new Set(preferences.pinnedTools || []);
  enabledToolsDraft = new Set(preferences.enabledTools || window.QTS_STORAGE.DEFAULT_ENABLED_TOOLS);
  toolsMenuOrderDraft = normalizeToolsMenuOrderDraft(preferences.toolsMenuOrder);
  document.getElementById("toolsSortMode").value = ["custom", "az", "za", "mostUsed"].includes(preferences.toolsSortMode) ? preferences.toolsSortMode : "custom";
  customShortcutsDraft = { ...(preferences.customShortcuts || {}) };
  renderToolsMenuOrderList();
  updateToolsMenuOrderVisibility();
  breadcrumbVisibilityDraft = { client: true, project: true, product: true, environment: true, ...(preferences.breadcrumbVisibility || {}) };
  breadcrumbOrderDraft = normalizeBreadcrumbOrderDraft(preferences.breadcrumbOrder);
  renderBreadcrumbOrderList();
  renderColorThemeGrid(preferences.colorTheme || null);
}

let customShortcutsDraft = {};
let enabledToolsDraft = new Set(window.QTS_STORAGE.DEFAULT_ENABLED_TOOLS);
let pinnedToolsDraft = new Set();
function shortcutFromEvent(event) {
  const key = event.key.length === 1 ? event.key.toLocaleUpperCase() : event.key;
  if (["Control", "Alt", "Shift", "Meta"].includes(key)) return "";
  const parts = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Meta");
  return [...parts, key].join("+");
}
document.getElementById("resetCustomShortcuts").addEventListener("click", () => { customShortcutsDraft = {}; renderToolsMenuOrderList(); });

const COLOR_FAMILY_LABEL_SOURCE = { red: "Vermelho", gold: "Dourado", blue: "Azul", pink: "Rosa", green: "Verde", orange: "Laranja", purple: "Roxo", yellow: "Amarelo", black: "Preto", gray: "Cinza", lego: "Lego multicolorido" };

// The picker's own visual state (border highlight) is driven straight off `preferences.colorTheme`
// here, separate from applyColorTheme() in toolbar.js which reads the same field to set the live
// page tokens -- options.js and the injected content script never share JS state, only storage.
function renderColorThemeGrid(selectedId) {
  const grid = document.getElementById("colorThemeGrid");
  if (!grid) return;
  const mode = document.getElementById("appearanceTheme")?.value === "dark" ? "dark" : "light";
  const selectedFamily = String(selectedId || "blue-light").replace(/-(?:light|dark)$/, "");
  grid.innerHTML = window.QTS_THEME_PRESETS.families.map((family) => {
    const preset = window.QTS_THEME_PRESETS.presets.find((item) => item.family === family && item.mode === mode);
    const selected = family === selectedFamily;
    return `<button type="button" class="colorThemeSwatch${selected ? " isSelected" : ""}" role="radio" aria-checked="${selected}" data-color-family="${family}"><span class="colorThemeDot" style="background:${preset.primary}"></span>${escapeHtml(t(COLOR_FAMILY_LABEL_SOURCE[family]))}</button>`;
  }).join("");
}

document.getElementById("colorThemeGrid")?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-color-family]");
  if (!button || !workspace) return;
  const mode = document.getElementById("appearanceTheme").value === "dark" ? "dark" : "light";
  const colorTheme = `${button.dataset.colorFamily}-${mode}`;
  applyColorThemeToPage(colorTheme);
  workspace.preferences = { ...(workspace.preferences || {}), colorTheme };
  await saveWorkspace(workspace);
  renderColorThemeGrid(colorTheme);
  document.getElementById("generalSavedHint").textContent = t("Salvo - a barra já foi atualizada.");
});

document.getElementById("colorThemeReset")?.addEventListener("click", async () => {
  if (!workspace) return;
  applyAppearanceTheme("light");
  applyColorThemeToPage("blue-light");
  workspace.preferences = { ...(workspace.preferences || {}), colorTheme: "blue-light", appearanceTheme: "light" };
  await saveWorkspace(workspace);
  renderColorThemeGrid("blue-light");
  document.getElementById("generalSavedHint").textContent = t("Salvo - a barra já foi atualizada.");
});

const PINNED_TOOLS_LIMIT = 4;

// Cliente/Projeto/Produto priority in the breadcrumb - a local draft array (not saved until
// "Salvar", the sticky bottom button) so drag/arrow reordering and the live preview stay instant without writing
// to the workspace on every rearrange. Environment is intentionally not reorderable - it's always
// the last, "current tier" segment (see buildBreadcrumb in toolbar.js).
let breadcrumbOrderDraft = ["client", "project", "product"];
let breadcrumbOrderDragKey = null;
let breadcrumbVisibilityDraft = { client: true, project: true, product: true, environment: true };
let compactEntitiesDraft = { client: false, project: false, product: false };

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
      <span class="dragHandle">⠿</span><strong>${escapeHtml(labels[key])}</strong>
      <label class="inlinePreference"><input type="checkbox" data-breadcrumb="${key}" ${breadcrumbVisibilityDraft[key] !== false ? "checked" : ""} /> Exibir</label>
      <label class="inlinePreference"><input type="checkbox" data-compact-entity="${key}" ${compactEntitiesDraft[key] === true ? "checked" : ""} /> Compacto</label>
      <span class="orderArrows">
        <button type="button" data-order-move="up" data-order-key="${key}" ${index === 0 ? "disabled" : ""} title="${escapeHtml(t("Mover para cima"))}">↑</button>
        <button type="button" data-order-move="down" data-order-key="${key}" ${index === breadcrumbOrderDraft.length - 1 ? "disabled" : ""} title="${escapeHtml(t("Mover para baixo"))}">↓</button>
      </span>
    </li>`).join("") + `<li class="breadcrumbOrderItem isFixed"><span class="dragHandle">•</span><strong>${escapeHtml(t("Ambiente"))}</strong><label class="inlinePreference"><input type="checkbox" data-breadcrumb="environment" ${breadcrumbVisibilityDraft.environment !== false ? "checked" : ""} /> Exibir</label><span class="fixedOrderHint">${escapeHtml(t("Sempre por último"))}</span></li>`;
  list.querySelectorAll("[data-breadcrumb]").forEach((input) => input.addEventListener("change", () => {
    breadcrumbVisibilityDraft[input.dataset.breadcrumb] = input.checked;
    renderBarPreview();
  }));
  list.querySelectorAll("[data-compact-entity]").forEach((input) => input.addEventListener("change", () => {
    compactEntitiesDraft[input.dataset.compactEntity] = input.checked;
    renderBarPreview();
  }));
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

// Mock breadcrumb using sample names - reflects order/visibility/compact-mode instantly, without
// needing a real workspace/environment or waiting for the "Salvar" button.
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

// Tools-menu item order - same drag/arrow pattern as the breadcrumb order above, kept as its own
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
  const label = window.QTS_STORAGE.FEATURE_REGISTRY.find((feature) => feature.key === key)?.label || key;
  return t(label);
}

// The manual drag/arrow order only has any visible effect in "Personalizado" mode -- A-Z/Z-A/mais
// usados always compute their own order at render time in the toolbar itself, so showing an
// editable list the user just picked "A-Z" over would be actively misleading (it'd look ignored).
function updateToolsMenuOrderVisibility() {
  const isCustom = document.getElementById("toolsSortMode").value === "custom";
  document.getElementById("toolsMenuOrderHint").toggleAttribute("hidden", !isCustom);
  document.getElementById("toolsMenuOrderList").classList.toggle("isAutoSorted", !isCustom);
}
document.getElementById("toolsSortMode").addEventListener("change", updateToolsMenuOrderVisibility);

function renderToolsMenuOrderList() {
  const list = document.getElementById("toolsMenuOrderList");
  list.innerHTML = toolsMenuOrderDraft.map((key, index) => `
    <li class="breadcrumbOrderItem" draggable="true" data-order-key="${key}">
      <span class="dragHandle">⠿</span><strong>${escapeHtml(toolsMenuItemLabel(key))}</strong>
      <label class="inlinePreference"><input type="checkbox" data-tool="${key}" ${enabledToolsDraft.has(key) ? "checked" : ""} /> Menu</label>
      <button type="button" class="pinToggle${pinnedToolsDraft.has(key) ? " isPinned" : ""}" data-pin-tool="${key}" aria-pressed="${pinnedToolsDraft.has(key)}" title="${pinnedToolsDraft.has(key) ? "Remover da toolbar" : "Fixar na toolbar"}">${ICON("pin")}</button>
      <input class="inlineShortcutInput" type="text" readonly inputmode="none" data-shortcut-key="${key}" value="${escapeHtml(customShortcutsDraft[key] || "")}" placeholder="Tecla ou combinação" aria-label="Atalho de ${escapeHtml(toolsMenuItemLabel(key))}" />
      <span class="orderArrows">
        <button type="button" data-order-move="up" data-order-key="${key}" ${index === 0 ? "disabled" : ""} title="${escapeHtml(t("Mover para cima"))}">↑</button>
        <button type="button" data-order-move="down" data-order-key="${key}" ${index === toolsMenuOrderDraft.length - 1 ? "disabled" : ""} title="${escapeHtml(t("Mover para baixo"))}">↓</button>
      </span>
    </li>`).join("");
  list.querySelectorAll("[data-tool]").forEach((input) => input.addEventListener("change", () => {
    if (input.checked) enabledToolsDraft.add(input.dataset.tool);
    else {
      enabledToolsDraft.delete(input.dataset.tool);
      pinnedToolsDraft.delete(input.dataset.tool);
      renderToolsMenuOrderList();
    }
  }));
  list.querySelectorAll("[data-pin-tool]").forEach((button) => button.addEventListener("click", () => {
    const key = button.dataset.pinTool;
    if (pinnedToolsDraft.has(key)) pinnedToolsDraft.delete(key);
    else {
      if (pinnedToolsDraft.size >= PINNED_TOOLS_LIMIT) {
        const hint = document.getElementById("pinnedToolsLimitHint");
        hint.hidden = false;
        window.setTimeout(() => { hint.hidden = true; }, 6_000);
        return;
      }
      pinnedToolsDraft.add(key);
      enabledToolsDraft.add(key);
    }
    renderToolsMenuOrderList();
  }));
  list.querySelectorAll("[data-shortcut-key]").forEach((input) => input.addEventListener("keydown", (event) => {
    event.preventDefault();
    if (event.key === "Backspace" || event.key === "Delete") {
      delete customShortcutsDraft[input.dataset.shortcutKey];
      input.value = "";
      return;
    }
    const shortcut = shortcutFromEvent(event);
    if (!shortcut) return;
    const conflict = Object.entries(customShortcutsDraft).find(([key, value]) => key !== input.dataset.shortcutKey && value === shortcut);
    const error = document.getElementById("customShortcutError");
    if (conflict) {
      error.hidden = false;
      error.textContent = `${shortcut} já está usado por ${toolsMenuItemLabel(conflict[0])}.`;
      return;
    }
    error.hidden = true;
    customShortcutsDraft[input.dataset.shortcutKey] = shortcut;
    input.value = shortcut;
  }));
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

// One button saves everything on this screen (site scope + all toolbar/appearance preferences)
// instead of the two separate saves this panel used to have - a user changing both a URL pattern
// and, say, a pinned tool no longer has to remember to click twice.
document.getElementById("saveGeneralSettings").addEventListener("click", async () => {
  const scopeMode = document.querySelector('input[name="scopeMode"]:checked')?.value || "environments";
  await saveSiteScope({ mode: scopeMode, patterns: [] });

  const compactEntities = Object.fromEntries([...document.querySelectorAll("[data-compact-entity]")].map((checkbox) => [checkbox.dataset.compactEntity, checkbox.checked]));
  workspace.preferences = {
    ...(workspace.preferences || {}),
    compactMode: compactEntities.project === true && compactEntities.product === true,
    appearanceTheme: document.getElementById("appearanceTheme").value,
    compactEntities,
    pushSiteContent: document.getElementById("pushSiteContent").checked,
    pushSiteContentForDrawer: document.getElementById("pushSiteContentForDrawer").checked,
    soundEffects: document.getElementById("soundEffects").checked,
    remindTestStatusOnRecording: document.getElementById("remindTestStatusOnRecording").checked,
    drawerPosition: pickerValue("drawerPosition"),
    toolbarPosition: pickerValue("toolbarPosition"),
    mobileDrawerPosition: pickerValue("mobileDrawerPosition"),
    mobileToolbarPosition: pickerValue("mobileToolbarPosition"),
    avatarShape: document.getElementById("avatarShape").value === "round" ? "round" : "square",
    pinnedTools: [...pinnedToolsDraft],
    enabledTools: [...enabledToolsDraft],
    breadcrumbVisibility: Object.fromEntries([...document.querySelectorAll("[data-breadcrumb]")].map((checkbox) => [checkbox.dataset.breadcrumb, checkbox.checked])),
    breadcrumbOrder: [...breadcrumbOrderDraft],
    toolsMenuOrder: [...toolsMenuOrderDraft],
    toolsSortMode: document.getElementById("toolsSortMode").value,
    customShortcuts: { ...customShortcutsDraft },
  };
  await persistWorkspace();
  document.getElementById("generalSavedHint").textContent = t("Salvo - a barra já foi atualizada.");
});

function findById(collection, id) {
  return (workspace[collection] || []).find((item) => item.id === id);
}

function environmentDisplayName(environment) {
  return environment?.name || "";
}

// Which products/countries an environment is actually deployed to now lives on urlBindings
// (Environment is a reusable tier - see storage.js's normalizeUrlBindings) - this derives a
// short "AR, BO, PY" style summary for the environment list row and search.
function environmentBoundProductNames(environmentId) {
  const productIds = new Set((workspace.urlBindings || []).filter((binding) => binding.environmentIds.includes(environmentId)).map((binding) => binding.productId));
  return [...productIds].map((productId) => findById("products", productId)?.name).filter(Boolean);
}

// founder feedback: search used to JSON.stringify() the whole item, which drags in every base64
// image field (logos, account-type icons, payment icons - up to 300k chars each) on every single
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
  // Toolbar/Sandbox/STAGE (the seeded demo entities the tour/tutorial points at) are fixed on
  // purpose -- no CRUD buttons at all (they'd all either no-op or visibly break the tour target),
  // just a padlock badge explaining why.
  if (item.locked) {
    return `<div class="rowActions"><span class="lockedBadge" title="${escapeHtml(t("Item fixo do ambiente de demonstração - não pode ser editado"))}">🔒 ${escapeHtml(t("Fixo"))}</span></div>`;
  }
  const reorderable = ["clients", "projects", "products"].includes(collection) && (workspace[collection] || []).length > 1;
  // Icon-only buttons (title carries the label for a11y/tooltip) - this used to spell out
  // "Editar Duplicar Pausar Excluir" in full text on every single row, which never fit inside an
  // entity card and forced a horizontal scrollbar under every row just to reach "Excluir". Found
  // live, screenshots included: "a listagem tá antiga, tá horrível".
  return `<div class="rowActions">
    ${reveal ? `<button type="button" data-action="reveal" data-collection="${collection}" data-id="${escapeHtml(item.id)}" title="${escapeHtml(t(revealedAccountIds.has(item.id) ? "Ocultar" : "Ver"))}">${ICON(revealedAccountIds.has(item.id) ? "eyeSlash" : "eye")}</button>` : ""}
    ${reorderable ? `<button type="button" data-action="move-up" data-collection="${collection}" data-id="${escapeHtml(item.id)}" title="${escapeHtml(t("Mover para cima"))}">${ICON("chevronUp")}</button><button type="button" data-action="move-down" data-collection="${collection}" data-id="${escapeHtml(item.id)}" title="${escapeHtml(t("Mover para baixo"))}">${ICON("chevronDown")}</button>` : ""}
    <button type="button" data-action="edit" data-collection="${collection}" data-id="${escapeHtml(item.id)}" title="${escapeHtml(t("Editar"))}">${ICON("edit")}</button>
    <button type="button" data-action="duplicate" data-collection="${collection}" data-id="${escapeHtml(item.id)}" title="${escapeHtml(t("Duplicar"))}">${ICON("copy")}</button>
    <button type="button" data-action="toggle" data-collection="${collection}" data-id="${escapeHtml(item.id)}" title="${escapeHtml(t(item.active === false ? "Ativar" : "Pausar"))}">${ICON(item.active === false ? "play" : "pause")}</button>
    <button type="button" data-action="remove" data-collection="${collection}" data-id="${escapeHtml(item.id)}" title="${escapeHtml(t("Excluir"))}">${ICON("eraser")}</button>
  </div>`;
}

function renderRows(collection, formatter, options = {}) {
  const element = document.getElementById(COLLECTION_UI[collection].listId);
  const items = (workspace[collection] || []).filter((item) => !item.locked && matchesSearch(item) && (!options.filter || options.filter(item)));
  if (!items.length) { element.innerHTML = `<div class="listEmpty">${escapeHtml(t(searchQuery ? "Nenhum resultado." : "Nada cadastrado ainda."))}</div>`; return; }
  element.innerHTML = items.map((item) => `<div class="listRow${item.active === false ? " isInactive" : ""}${options.selectedId === item.id ? " isSelected" : ""}" data-id="${escapeHtml(item.id)}"><div>${formatter(item)}</div>${rowActions(collection, item, { reveal: options.reveal?.(item) })}</div>`).join("");
}

function visibleWorkspaceItems(collection) {
  return (workspace[collection] || []).filter((item) => !item.locked && matchesSearch(item));
}

function relationshipEntityCard(collection, item, { context = "", children = "", childCollection = "", childLabel = "" } = {}) {
  const type = { clients: "Cliente", projects: "Projeto", products: "Produto" }[collection];
  const entityHtml = window.QTS_AVATAR.buildEntityHtml(item, { size: 26 });
  const draggable = collection !== "clients";
  return `<details class="relationshipNode relationshipNode-${collection}" open data-entity-collection="${collection}" data-entity-id="${escapeHtml(item.id)}" ${draggable ? 'draggable="true"' : ""}>
    <summary class="relationshipNodeSummary">
      <span class="relationshipType">${escapeHtml(t(type))}</span>
      <span class="relationshipIdentity">${entityHtml}${context ? `<small>${escapeHtml(context)}</small>` : ""}</span>
      <span class="relationshipNodeActions">
        ${childCollection ? `<button type="button" class="relationshipAdd" data-tree-create="${childCollection}" data-parent-id="${escapeHtml(item.id)}">+ ${escapeHtml(t(childLabel))}</button>` : ""}
        ${rowActions(collection, item)}
        <span class="hierarchyChevron" aria-hidden="true"></span>
      </span>
    </summary>
    ${children ? `<div class="relationshipChildren">${children}</div>` : childCollection ? `<div class="relationshipEmpty">${escapeHtml(t("Nenhum item relacionado."))}</div>` : ""}
  </details>`;
}

function renderStructureHierarchy() {
  const container = document.getElementById("structureHierarchy");
  if (!container) return;
  const clients = visibleWorkspaceItems("clients");
  const projects = visibleWorkspaceItems("projects");
  const products = visibleWorkspaceItems("products");
  const productCard = (product) => {
    const project = findById("projects", product.projectId);
    const client = findById("clients", project?.clientId);
    const context = structureViewMode === "product" ? [client?.name, project?.name].filter(Boolean).join(" · ") : "";
    return relationshipEntityCard("products", product, { context });
  };
  const projectCard = (project) => {
    const client = findById("clients", project.clientId);
    const children = products.filter((product) => product.projectId === project.id).map(productCard).join("");
    return relationshipEntityCard("projects", project, {
      context: structureViewMode === "project" ? client?.name || "" : "",
      children, childCollection: "product", childLabel: "Adicionar produto",
    });
  };
  const clientCard = (client) => relationshipEntityCard("clients", client, {
    children: projects.filter((project) => project.clientId === client.id).map(projectCard).join(""),
    childCollection: "project", childLabel: "Adicionar projeto",
  });
  const html = structureViewMode === "product" ? products.map(productCard).join("")
    : structureViewMode === "project" ? projects.map(projectCard).join("")
      : clients.map(clientCard).join("");
  container.innerHTML = html || `<div class="listEmpty">${escapeHtml(t(searchQuery ? "Nenhum resultado." : "Nada cadastrado ainda."))}</div>`;
  container.querySelectorAll(".rowActions").forEach((actions) => actions.addEventListener("click", (event) => event.preventDefault()));
}

const relationalViewDimension = { testAccounts: "environment", paymentMethods: "environment", devices: "operatingSystem" };

function relationalEntities(item, dimension, collection) {
  if (dimension === "environment") return (item.environmentIds || []).map((id) => findById("environments", id)).filter((entry) => entry && !entry.locked);
  if (dimension === "product") return (item.productIds || []).map((id) => findById("products", id)).filter((entry) => entry && !entry.locked);
  if (dimension === "project" || dimension === "client") {
    const products = (item.productIds || []).map((id) => findById("products", id)).filter(Boolean);
    const projects = [...new Map(products.map((product) => {
      const project = findById("projects", product.projectId);
      return [project?.id, project];
    }).filter(([id, project]) => id && project && !project.locked)).values()];
    if (dimension === "project") return projects;
    return [...new Map(projects.map((project) => {
      const client = findById("clients", project.clientId);
      return [client?.id, client];
    }).filter(([id, client]) => id && client && !client.locked)).values()];
  }
  if (dimension === "type") {
    const catalog = collection === "testAccounts" ? "accountTypes" : "paymentMethodTypes";
    const id = collection === "testAccounts" ? item.accountTypeId : item.typeId;
    return [findById(catalog, id)].filter(Boolean);
  }
  if (dimension === "operatingSystem") return (item.operatingSystemIds || []).map((id) => findById("operatingSystems", id)).filter(Boolean);
  if (dimension === "browser") return (item.browserIds || []).map((id) => findById("browsers", id)).filter(Boolean);
  return [];
}

function renderRelationalRows(collection, formatter, { reveal } = {}) {
  const element = document.getElementById(COLLECTION_UI[collection].listId);
  const items = visibleWorkspaceItems(collection);
  if (!items.length) {
    element.innerHTML = `<div class="listEmpty">${escapeHtml(t(searchQuery ? "Nenhum resultado." : "Nada cadastrado ainda."))}</div>`;
    return;
  }
  const dimension = relationalViewDimension[collection];
  const groups = new Map();
  for (const item of items) {
    const entities = relationalEntities(item, dimension, collection);
    for (const entity of entities.length ? entities : [null]) {
      const key = entity?.id || "__none";
      if (!groups.has(key)) groups.set(key, { entity, items: [] });
      groups.get(key).items.push(item);
    }
  }
  const emptyLabel = { environment: "Sem ambiente", client: "Sem cliente", project: "Sem projeto", product: "Sem produto", type: "Sem tipo", operatingSystem: "Sem sistema", browser: "Sem navegador" }[dimension];
  const dimensionLabel = { environment: "Ambiente", client: "Cliente", project: "Projeto", product: "Produto", type: "Tipo", operatingSystem: "Sistema", browser: "Navegador" }[dimension];
  element.innerHTML = [...groups.values()].map(({ entity, items: groupedItems }) => {
    const identity = entity && dimension === "environment"
      ? `<span class="environmentToolbarPreview relationalEnvironmentPreview" style="--environment-color:${escapeHtml(entity.color || "#64748b")}"><span>${escapeHtml(environmentDisplayName(entity).slice(0, 22))}</span><i></i><i></i><i></i></span>`
      : entity ? window.QTS_AVATAR.buildEntityHtml(entity, { size: 24 }) : `<b>${escapeHtml(t(emptyLabel))}</b>`;
    const rows = groupedItems.map((item) => `<div class="listRow${item.active === false ? " isInactive" : ""}" data-id="${escapeHtml(item.id)}"><div>${formatter(item)}</div>${rowActions(collection, item, { reveal: reveal?.(item) })}</div>`).join("");
    return `<details class="urlTreeNode relationalDataNode" open><summary><span class="urlTreeBranch" aria-hidden="true"></span><span class="relationshipType">${escapeHtml(t(dimensionLabel))}</span><span class="urlTreeIdentity">${identity}</span><span class="count">${groupedItems.length}</span></summary><div class="urlTreeChildren">${rows}</div></details>`;
  }).join("");
}

function renderSelect(selectId, items, placeholder) {
  const select = document.getElementById(selectId);
  const current = select.value;
  select.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>${items.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("")}`;
  if (items.some((item) => item.id === current)) select.value = current;
}

let urlSelectedEnvironmentIds = new Set();
let urlSelectedProductIds = new Set();
let urlPatternsDraft = [];

// Founder feedback: the old single-value "URL ou padrão" field only ever showed (and saved) one
// pattern, so registering several country/domain URLs for the same product+environments meant
// repeating the whole modal per URL, and re-opening it to edit only ever showed the last one.
// Mirrors the environment picker's own pill styling below it.
function renderUrlPatternsPicker() {
  const container = document.getElementById("urlPatternsPicker");
  container.innerHTML = urlPatternsDraft.length
    ? urlPatternsDraft.map((pattern, index) => `<span class="patternPill">${escapeHtml(pattern)}<button type="button" data-remove-pattern="${index}" aria-label="${escapeHtml(t("Remover"))}">${ICON("fail")}</button></span>`).join("")
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
  const environments = (workspace.environments || []).filter((item) => !item.locked);
  if (!environments.length) {
    container.innerHTML = `<div class="listEmpty">${escapeHtml(t("Crie um ambiente antes de associar URLs."))}</div>`;
    return;
  }
  if (environments.length <= 4) {
    container.innerHTML = `<div class="environmentToggles">${environments.map((environment) => {
      const selected = urlSelectedEnvironmentIds.has(environment.id);
      return `<button type="button" class="environmentToggle${selected ? " isSelected" : ""}" data-url-environment="${escapeHtml(environment.id)}" aria-pressed="${selected}"><span class="environmentColorDot" style="--environment-color:${escapeHtml(environment.color)}"></span><span class="environmentToggleLabel">${escapeHtml(environmentDisplayName(environment))}</span></button>`;
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

function renderUrlProductPicker() {
  const container = document.getElementById("urlProductPicker");
  const products = (workspace.products || []).filter((item) => !item.locked);
  container.innerHTML = products.length
    ? `<div class="environmentToggles">${products.map((product) => {
      const selected = urlSelectedProductIds.has(product.id);
      return `<button type="button" class="environmentToggle${selected ? " isSelected" : ""}" data-url-product="${escapeHtml(product.id)}" aria-pressed="${selected}">${window.QTS_AVATAR.buildBadgeHtml(product, { size: 18 })}<span class="environmentToggleLabel">${escapeHtml(product.name)}</span></button>`;
    }).join("")}</div>`
    : `<div class="listEmpty">${escapeHtml(t("Crie um produto antes de associar URLs."))}</div>`;
  container.querySelectorAll("[data-url-product]").forEach((button) => button.addEventListener("click", () => {
    const id = button.dataset.urlProduct;
    urlSelectedProductIds.has(id) ? urlSelectedProductIds.delete(id) : urlSelectedProductIds.add(id);
    renderUrlProductPicker();
  }));
}

// URLs are grouped by environment into collapsible accordions (rather than one flat list) so a
// workspace with many countries/products per environment stays scannable - each section shows its
// own URL count and can be collapsed once reviewed. A binding can belong to several environments
// at once (see the environment picker above), so it's rendered once per environment it's tied to;
// bindings with no environment yet land in a trailing "Sem ambiente" group instead of vanishing.
function renderUrlRelationRow(item) {
  const product = findById("products", item.productId);
  const productIdentity = product && !urlTreeDimensions.has("product")
    ? `<span class="relationBadge">${window.QTS_AVATAR.buildBadgeHtml(product, { size: 18 })}<span>${escapeHtml(product.name)}</span></span>`
    : "";
  const environmentBadges = urlTreeDimensions.has("environment") ? "" : item.environmentIds
    .map((environmentId) => findById("environments", environmentId)).filter(Boolean)
    .map((environment) => `<span class="relationBadge"><i style="--environment-color:${escapeHtml(environment.color)}"></i>${escapeHtml(environmentDisplayName(environment))}</span>`).join("");
  const metadata = [productIdentity, environmentBadges].filter(Boolean).join("");
  return `<div class="listRow${item.active === false ? " isInactive" : ""}" draggable="true" data-drag-collection="urlBindings" data-id="${escapeHtml(item.id)}"><div><b class="urlPattern">${escapeHtml((item.patterns || []).join(", "))}</b>${metadata ? `<small class="relationBadges">${metadata}</small>` : ""}</div>${rowActions("urlBindings", item)}</div>`;
}

// Remembers which environment accordions the founder has manually collapsed - renderWorkspace()
// re-renders this list after every unrelated save anywhere on the page (a new test account, a
// language switch, etc.), so without this every collapse would silently snap back open the next
// time anything else changed.
const collapsedUrlAccordionIds = new Set();
const urlTreeDimensions = new Set(["environment", "client", "project", "product"]);

function urlTreeContext(binding, environmentId) {
  const product = findById("products", binding.productId);
  const project = findById("projects", product?.projectId);
  const client = findById("clients", project?.clientId);
  const environment = findById("environments", environmentId);
  return { binding, environment, client, project, product };
}

function renderUrlTree(records, dimensions, depth = 0) {
  if (!dimensions.length) return records.map((record) => renderUrlRelationRow(record.binding)).join("");
  const [dimension, ...rest] = dimensions;
  const groups = new Map();
  for (const record of records) {
    const entity = record[dimension];
    const key = entity?.id || `__none_${dimension}`;
    if (!groups.has(key)) groups.set(key, { entity, records: [] });
    groups.get(key).records.push(record);
  }
  return [...groups.entries()].map(([key, group]) => {
    const entity = group.entity;
    const emptyLabel = { environment: "Sem ambiente", client: "Sem cliente", project: "Sem projeto", product: "Sem produto" }[dimension];
    const label = entity ? (entity.name || entity.label) : t(emptyLabel);
    const color = dimension === "environment" ? entity?.color || "#64748b" : "";
    const identity = entity && dimension !== "environment"
      ? window.QTS_AVATAR.buildEntityHtml(entity, { size: 20 })
      : `<b>${escapeHtml(label)}</b>`;
    const preview = dimension === "environment"
      ? `<span class="environmentToolbarPreview" style="--environment-color:${escapeHtml(color)}"><i></i><i></i><i></i></span>`
      : "";
    return `<details class="urlTreeNode urlTreeLevel-${dimension}" data-accordion-key="${escapeHtml(key)}" data-tree-dimension="${dimension}" data-tree-entity-id="${escapeHtml(entity?.id || "")}" style="${color ? `--environment-color:${escapeHtml(color)}` : ""}" ${collapsedUrlAccordionIds.has(key) ? "" : "open"}><summary><span class="urlTreeBranch" aria-hidden="true"></span><span class="urlTreeIdentity">${identity}</span>${preview}<span class="count">${group.records.length}</span></summary><div class="urlTreeChildren">${renderUrlTree(group.records, rest, depth + 1)}</div></details>`;
  }).join("");
}

function renderEnvironmentUrlTree(records, remainingDimensions) {
  const environments = visibleWorkspaceItems("environments").filter(matchesSearch);
  const groups = environments.map((environment) => ({ environment, records: records.filter((record) => record.environment?.id === environment.id) }));
  const unassigned = records.filter((record) => !record.environment);
  if (unassigned.length) groups.push({ environment: null, records: unassigned });
  if (!groups.length) return `<div class="listEmpty">${escapeHtml(t(searchQuery ? "Nenhum resultado." : "Nada cadastrado ainda."))}</div>`;
  return groups.map(({ environment, records: environmentRecords }) => {
    const key = environment?.id || "__none_environment";
    const color = environment?.color || "#64748b";
    const label = environment ? environmentDisplayName(environment) : t("Sem ambiente");
    const preview = environment ? `<span class="environmentToolbarPreview" style="--environment-color:${escapeHtml(color)}"><span>${escapeHtml(label.slice(0, 22))}</span><i></i><i></i><i></i></span>` : "";
    const actions = environment ? rowActions("environments", environment) : "";
    const children = environmentRecords.length ? renderUrlTree(environmentRecords, remainingDimensions) : `<div class="relationshipEmpty">${escapeHtml(t("Nenhuma URL relacionada ainda"))}</div>`;
    const add = environment ? `<button type="button" class="relationshipAdd" data-add-url-for-environment="${escapeHtml(environment.id)}">Adicionar URL neste ambiente</button>` : "";
    const identity = environment ? "" : `<span class="urlTreeIdentity"><b>${escapeHtml(label)}</b></span>`;
    return `<details class="urlTreeNode urlTreeLevel-environment" data-accordion-key="${escapeHtml(key)}" data-tree-dimension="environment" data-tree-entity-id="${escapeHtml(environment?.id || "")}" style="--environment-color:${escapeHtml(color)}" ${collapsedUrlAccordionIds.has(key) ? "" : "open"}><summary><span class="urlTreeBranch" aria-hidden="true"></span>${preview}${identity}<span class="count">${environmentRecords.length}</span>${actions}</summary><div class="urlTreeChildren">${children}${add}</div></details>`;
  }).join("");
}

function renderUrlRelationList() {
  const element = document.getElementById(COLLECTION_UI.urlBindings.listId);
  const bindings = (workspace.urlBindings || []).filter(matchesSearch);
  const records = bindings.flatMap((binding) => (binding.environmentIds?.length ? binding.environmentIds : [null]).map((environmentId) => urlTreeContext(binding, environmentId)));
  const dimensions = ["environment", "client", "project", "product"].filter((dimension) => urlTreeDimensions.has(dimension));
  element.innerHTML = dimensions[0] === "environment" ? renderEnvironmentUrlTree(records, dimensions.slice(1)) : (records.length ? renderUrlTree(records, dimensions) : `<div class="listEmpty">${escapeHtml(t(searchQuery ? "Nenhum resultado." : "Nada cadastrado ainda."))}</div>`);
  element.querySelectorAll("details.urlTreeNode").forEach((details) => details.addEventListener("toggle", () => {
    const key = details.dataset.accordionKey;
    details.open ? collapsedUrlAccordionIds.delete(key) : collapsedUrlAccordionIds.add(key);
  }));
  element.querySelectorAll(".rowActions").forEach((actions) => actions.addEventListener("click", (event) => event.preventDefault()));
}
document.querySelectorAll("[data-url-tree-dimension]").forEach((button) => button.addEventListener("click", () => {
  const dimension = button.dataset.urlTreeDimension;
  urlTreeDimensions.has(dimension) ? urlTreeDimensions.delete(dimension) : urlTreeDimensions.add(dimension);
  button.setAttribute("aria-pressed", String(urlTreeDimensions.has(dimension)));
  renderUrlRelationList();
}));
document.querySelectorAll("[data-relational-view]").forEach((button) => button.addEventListener("click", () => {
  const collection = button.dataset.relationalView;
  relationalViewDimension[collection] = button.dataset.relationalDimension;
  document.querySelectorAll(`[data-relational-view="${collection}"]`).forEach((entry) => entry.setAttribute("aria-pressed", String(entry === button)));
  renderWorkspace();
}));

document.querySelectorAll("[data-structure-view]").forEach((button) => button.addEventListener("click", () => {
  structureViewMode = ["client", "project", "product"].includes(button.dataset.structureView) ? button.dataset.structureView : "client";
  if (structureViewMode !== "client") selectedStructureClientId = null;
  if (structureViewMode === "product") selectedStructureProjectId = null;
  renderWorkspace();
}));

// Shared badge summary for anything with environmentIds[]/productIds[] (test accounts, payment
// methods) - empty productIds means "all products", empty environmentIds only happens for
// payment methods (test accounts always require at least one).
function scopeBadgesHtml(item, { excludeDimension = "" } = {}) {
  const environmentBadges = excludeDimension === "environment" ? "" : (item.environmentIds || []).map((environmentId) => findById("environments", environmentId)).filter(Boolean)
    .map((environment) => `<span class="relationBadge"><i style="--environment-color:${escapeHtml(environment.color)}"></i>${escapeHtml(environmentDisplayName(environment))}</span>`).join("");
  const productNames = (item.productIds || []).map((productId) => findById("products", productId)?.name).filter(Boolean);
  const productBadge = excludeDimension === "product" ? "" : `<span class="relationBadge">${escapeHtml(productNames.length ? productNames.join(", ") : t("Todos os produtos"))}</span>`;
  const environmentFallback = excludeDimension === "environment" ? "" : environmentBadges || `<span class="relationBadge">${escapeHtml(t("Todos os ambientes"))}</span>`;
  return `${environmentFallback}${productBadge}`;
}

// Every product bound to `environmentId` via any urlBinding - the reverse of
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
// environmentIds/productIds are ever persisted - Client/Project checkboxes exist purely to narrow
// the options below them (a test account/payment method has no direct client/project field of its
// own, since that's already implied by whichever product(s) it's scoped to).
//
// Rendered as four independent floating comboboxes (one per facet) rather than one big
// always-expanded 4-column grid - founder feedback: the grid version pushed the whole dialog open
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
    // A full sentence ("Selecione ao menos um ambiente") never fit in this badge - it always
    // truncated so hard the field's own name got cut too ("Ambi…"). The red isRequiredEmpty
    // border already signals "this needs attention"; the badge just needs one short word.
    const emptyLabel = facet.required
      ? t("Obrigatório")
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
  // renderScopePicker() again - a full re-render on every keystroke would blow away and recreate
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
// the user clicks anywhere outside the scope picker that owns it, or presses Escape - the normal
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
  // replaces the checkbox with a new node mid-bubble - by the time this listener runs on document,
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

// Preserves whatever's already checked in the pill grid across re-renders (the same grid is
// repainted every time a related "+" quick-add composer saves), so a device being filled out
// never loses its picks just because a new operating system/browser was added mid-form.
function renderCheckboxGrid(containerId, catalog) {
  const container = document.getElementById(containerId);
  const previouslyChecked = new Set([...container.querySelectorAll("input:checked")].map((input) => input.value));
  container.innerHTML = catalog.map((entry) => `
    <label class="checkboxPill">
      <input type="checkbox" value="${escapeHtml(entry.id)}" ${previouslyChecked.has(entry.id) ? "checked" : ""} />
      ${entry.icon ? `<img src="${escapeHtml(entry.icon)}" alt="" />` : ""}
      ${escapeHtml(entry.name)}
    </label>`).join("") || `<span class="hint">${escapeHtml(t("Nada cadastrado ainda."))}</span>`;
}

function captureOptionsSearchFocus() {
  const active = document.activeElement;
  if (!(active instanceof HTMLInputElement) || active.type !== "search") return null;
  let selector = active.id ? `#${CSS.escape(active.id)}` : "";
  if (!selector && active.dataset.facetSearch) selector = `[data-facet-search="${CSS.escape(active.dataset.facetSearch)}"]`;
  if (!selector && active.hasAttribute("data-environment-search")) selector = "[data-environment-search]";
  return {
    element: active,
    selector,
    value: active.value,
    selStart: active.selectionStart,
    selEnd: active.selectionEnd,
  };
}

function restoreOptionsSearchFocus(snapshot) {
  if (!snapshot) return;
  const input = snapshot.element.isConnected ? snapshot.element : (snapshot.selector ? document.querySelector(snapshot.selector) : null);
  if (!(input instanceof HTMLInputElement)) return;
  input.value = snapshot.value;
  input.focus({ preventScroll: true });
  if (typeof snapshot.selStart === "number") {
    try { input.setSelectionRange(snapshot.selStart, snapshot.selEnd); } catch {}
  }
}

function renderWorkspace() {
  const searchFocus = captureOptionsSearchFocus();
  const visibleClients = workspace.clients.filter((item) => !item.locked);
  const allVisibleProjects = workspace.projects.filter((item) => !item.locked);
  if (structureViewMode === "client" && !visibleClients.some((item) => item.id === selectedStructureClientId)) selectedStructureClientId = visibleClients[0]?.id || null;
  const visibleProjects = allVisibleProjects.filter((item) => structureViewMode !== "client" || !selectedStructureClientId || item.clientId === selectedStructureClientId);
  if (structureViewMode !== "product" && !visibleProjects.some((item) => item.id === selectedStructureProjectId)) selectedStructureProjectId = visibleProjects[0]?.id || null;
  if (structureViewMode === "product") selectedStructureProjectId = null;
  const structureExplorer = document.querySelector(".structureExplorer");
  if (structureExplorer) structureExplorer.dataset.structureViewMode = structureViewMode;
  document.querySelectorAll("[data-structure-view]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.structureView === structureViewMode)));
  for (const [collection, countId] of Object.entries({ clients: "clientCount", projects: "projectCount", products: "productCount", environments: "environmentCount", urlBindings: "urlRelationCount", testAccounts: "testAccountCount", paymentMethods: "paymentMethodCount", inspectors: "inspectorCount", apis: "apiCount", resources: "resourceCount", operatingSystems: "operatingSystemCount", browsers: "browserCount", devices: "deviceCount", accountTypes: "accountTypeCount", paymentMethodTypes: "paymentMethodTypeCount" })) {
    document.getElementById(countId).textContent = String((workspace[collection] || []).filter((item) => !item.locked).length);
  }
  document.getElementById("structureRelationHint").textContent = t("{clients} cliente(s) · {projects} projeto(s) · {products} produto(s)", { clients: visibleClients.length, projects: allVisibleProjects.length, products: workspace.products.filter((item) => !item.locked).length });
  const badge = (entity) => window.QTS_AVATAR.buildEntityHtml(entity, { size: 22 });
  const typeRowFormatter = (item) => `<b class="catalogTypeName">${item.icon ? `<img src="${escapeHtml(item.icon)}" alt="" />` : ""}${escapeHtml(item.name)}</b>`;
  renderRows("operatingSystems", typeRowFormatter);
  renderRows("browsers", typeRowFormatter);
  renderRows("accountTypes", typeRowFormatter);
  renderRows("paymentMethodTypes", typeRowFormatter);
  renderRelationalRows("devices", (item) => {
    const osNames = item.operatingSystemIds.map((entryId) => findById("operatingSystems", entryId)?.name).filter(Boolean);
    const browserNames = item.browserIds.map((entryId) => findById("browsers", entryId)?.name).filter(Boolean);
    return `<b>${escapeHtml(item.label)}</b><small>${escapeHtml([...osNames, ...browserNames].join(", ") || t("Nenhum sistema/navegador selecionado"))}</small>${item.notes ? `<small>${escapeHtml(item.notes)}</small>` : ""}`;
  });
  renderCheckboxGrid("deviceOperatingSystems", workspace.operatingSystems);
  renderCheckboxGrid("deviceBrowsers", workspace.browsers);
  renderRows("clients", (item) => `<b>${badge(item)}</b>`, { selectedId: selectedStructureClientId });
  renderRows("projects", (item) => `<b>${badge(item)}</b><small>${escapeHtml(findById("clients", item.clientId)?.name || "-")}</small>`, {
    selectedId: selectedStructureProjectId,
    filter: (item) => structureViewMode !== "client" || !selectedStructureClientId || item.clientId === selectedStructureClientId,
  });
  renderRows("products", (item) => {
    const project = findById("projects", item.projectId);
    const client = findById("clients", project?.clientId);
    const context = structureViewMode === "product" ? [client?.name, project?.name].filter(Boolean).join(" · ") : project?.name || "-";
    return `<b>${badge(item)}</b><small>${escapeHtml(context)}</small>`;
  }, {
    filter: (item) => structureViewMode === "product"
      ? true
      : selectedStructureProjectId
      ? item.projectId === selectedStructureProjectId
      : visibleProjects.some((project) => project.id === item.projectId),
  });
  renderStructureHierarchy();
  renderRows("environments", (item) => {
    const products = environmentBoundProductNames(item.id);
    return `<b class="environmentToolbarPreview" style="--environment-color:${escapeHtml(item.color)}"><span>${escapeHtml(item.name.slice(0, 22))}</span><i></i><i></i><i></i></b><small>${escapeHtml(products.length ? products.join(", ") : t("Nenhuma URL relacionada ainda"))}</small>`;
  });
  renderUrlRelationList();
  renderUrlEnvironmentPicker();
  renderUrlPatternsPicker();
  renderRelationalRows("testAccounts", (item) => {
    const password = item.password ? (revealedAccountIds.has(item.id) ? escapeHtml(item.password) : "••••••••") : "-";
    const accountType = findById("accountTypes", item.accountTypeId);
    const typeName = accountType?.name || item.accountType || "";
    // The toolbar's own read-only drawer already renders this image (renderTestAccountsList in
    // toolbar.js) - this options-page list never did, so the same uploaded/URL icon that shows
    // up later was invisible here while managing the account.
    const typeImageSrc = accountType?.icon || item.accountTypeImage || "";
    const typeImage = typeImageSrc ? `<img class="catalogTypeIcon" src="${escapeHtml(typeImageSrc)}" alt="" />` : "";
    const scopeBadges = scopeBadgesHtml(item, { excludeDimension: relationalViewDimension.testAccounts });
    return `<b>${typeImage}${escapeHtml(item.label)}${typeName ? ` <span class="accountType">${escapeHtml(typeName)}</span>` : ""}</b><small>${escapeHtml(item.username || "-")} · ${password}</small>${scopeBadges ? `<small class="relationBadges">${scopeBadges}</small>` : ""}`;
  }, { reveal: (item) => Boolean(item.password) });
  renderCustomFieldSuggestions();
  document.querySelectorAll("#clientList .listRow").forEach((row) => {
    row.addEventListener("click", (event) => {
      if (event.target.closest(".rowActions")) return;
      selectedStructureClientId = row.dataset.id;
      selectedStructureProjectId = null;
      renderWorkspace();
    });
  });
  document.querySelectorAll("#projectList .listRow").forEach((row) => {
    row.addEventListener("click", (event) => {
      if (event.target.closest(".rowActions")) return;
      selectedStructureProjectId = row.dataset.id;
      renderWorkspace();
    });
  });
  renderRelationalRows("paymentMethods", (item) => {
    const typeName = findById("paymentMethodTypes", item.typeId)?.name || item.type || t("Outro");
    const scopeBadges = scopeBadgesHtml(item, { excludeDimension: relationalViewDimension.paymentMethods });
    return `<b>${escapeHtml(item.label)}</b><small>${escapeHtml(typeName)} · ${escapeHtml(t(item.value ? "valor protegido" : "sem valor"))} · ${escapeHtml(item.notes || "")}</small>${scopeBadges ? `<small class="relationBadges">${scopeBadges}</small>` : ""}`;
  });
  renderRows("inspectors", (item) => {
    const patterns = (item.patterns || []).map((pattern) => `<span class="inspectorPatternPill" title="${escapeHtml(pattern)}">${escapeHtml(pattern)}</span>`).join("");
    return `<b>${escapeHtml(item.label)}</b><small>${escapeHtml(t("{count} padrão(ões) monitorado(s)", { count: (item.patterns || []).length }))}</small><span class="inspectorPatternList">${patterns}</span>`;
  });
  renderRows("apis", (item) => `<b>${escapeHtml(item.label)}</b><small>${escapeHtml(item.baseUrl || "-")} · ${escapeHtml(t(item.token ? "token local configurado" : "sem token"))}</small>`);
  renderRows("resources", (item) => `<b>${escapeHtml(item.label)}</b><small>${escapeHtml(item.url || "-")}</small>`);
  renderSelect("projectClient", workspace.clients, t("Selecione o cliente"));
  renderSelect("productProject", workspace.projects, t("Selecione o projeto"));
  renderUrlProductPicker();
  renderSelect("testAccountTypeId", workspace.accountTypes, t("Sem tipo"));
  renderSelect("paymentMethodTypeId", workspace.paymentMethodTypes, t("Sem tipo"));
  renderScopePicker("testAccount", { requireEnvironment: true });
  renderScopePicker("paymentMethod", { requireEnvironment: false });
  loadPreferenceUi();
  renderWorkspaceWizard();
  activateWorkspaceTab(activeWorkspaceTab);
  window.QTS_OPTIONS_I18N.apply(currentLocale);
  restoreOptionsSearchFocus(searchFocus);
}

// First-access nudge: a single banner (not the multi-step checklist this used to be - that's now
// the full onboardingWizard dialog below) pointing at the guided setup while the workspace is
// still empty. Disappears the moment there's at least one client, project, product AND
// environment - past that point it's the founder's own workspace, not a fresh install anymore.
function renderWorkspaceWizard() {
  const wizard = document.getElementById("workspaceWizard");
  const stillEmpty = !workspace.clients.length || !workspace.projects.length || !workspace.products.length || !workspace.environments.length;
  wizard.hidden = !stillEmpty;
}

// ---------------------------------------------------------------------
// Onboarding wizard: Cliente -> Projeto -> Produto -> Ambiente -> URLs, then optional operation data.
// same workspace.X.push(...) + persistWorkspace() every other CRUD action in this file uses - this
// is a guided front door onto that one path, not a second way to create data.
// ---------------------------------------------------------------------
const WIZARD_STEPS = [
  { key: "client", collection: "clients", label: () => t("Cliente"), title: () => t("Qual é o cliente?"), lead: () => t("A empresa que você atende - ou a sua própria, se for testar seu próprio produto. Pode adicionar mais de um.") },
  { key: "project", collection: "projects", parentKey: "client", parentField: "clientId", label: () => t("Projeto"), title: () => t("Quais projetos esse cliente tem?"), lead: () => t("Uma frente de trabalho do cliente. Esse projeto é de outro cliente? É só trocar no seletor ao lado.") },
  { key: "product", collection: "products", parentKey: "project", parentField: "projectId", label: () => t("Produto"), title: () => t("Qual produto esse projeto tem?"), lead: () => t("O app, sistema ou site que você vai testar. Também pode pertencer a outro projeto - é só trocar.") },
  { key: "environment", label: () => t("Ambiente"), title: () => t("Crie um ambiente"), lead: () => t("QA, Staging, Produção... escolha uma cor - ela identifica esse ambiente na barra e na lista de URLs.") },
  { key: "urls", label: () => t("URLs"), title: () => t("Onde esse produto roda?"), lead: () => t("Associe uma ou mais URLs ao ambiente que você acabou de criar. Pode pular e cadastrar depois.") },
  { key: "testAccounts", collection: "testAccounts", label: () => t("Contas"), title: () => t("Quer cadastrar contas de teste?"), lead: () => t("Credenciais sandbox por ambiente, mascaradas na barra. Totalmente opcional.") },
  { key: "paymentMethods", collection: "paymentMethods", label: () => t("Pagamentos"), title: () => t("Quer cadastrar meios de pagamento?"), lead: () => t("Cartões de teste sandbox, filtrados pelo ambiente. Totalmente opcional.") },
  { key: "devices", collection: "devices", label: () => t("Dispositivos"), title: () => t("Quer cadastrar dispositivos?"), lead: () => t("Relacione aparelhos, sistemas operacionais e navegadores usados nos testes. Totalmente opcional.") },
  { key: "inspectors", collection: "inspectors", label: () => t("Inspectors"), title: () => t("Quer observar endpoints?"), lead: () => t("Inspectors capturam respostas de API que batem com um padrão de URL. Totalmente opcional.") },
];
const WIZARD_OPTIONAL_COMPOSER = { testAccounts: "testAccountComposer", paymentMethods: "paymentMethodComposer", devices: "deviceComposer", inspectors: "inspectorComposer" };
const WIZARD_CSV_SCHEMA = {
  testAccounts: { columns: ["label", "username", "password", "notes"], example: "label,username,password,notes\nConta QA,qa@exemplo.com,Senha123,Uso interno" },
  paymentMethods: { columns: ["label", "holder", "value", "expiry", "cvv", "notes"], example: "label,holder,value,expiry,cvv,notes\nCartão Visa,QA Sandbox,4242424242424242,12/2030,123,Somente teste" },
  devices: { columns: ["label", "systems", "browsers", "notes"], example: "label,systems,browsers,notes\nNotebook QA,Windows|Linux,Chrome|Firefox,Estação compartilhada" },
  inspectors: { columns: ["label", "patterns"], example: "label,patterns\nCheckout API,*/api/checkout/*|*/payments/*" },
};

let wizardStepIndex = 0;
// What THIS wizard session has created/picked at each level, so the next step defaults sensibly
// (a project you just added under "Cliente X" makes "Cliente X" the product step's default
// parent) without ever forcing it - every add row still lets you repoint to any existing parent.
let wizardSelection = { client: new Set(), project: new Set(), product: new Set(), environment: new Set() };

function resetWizardSelection() {
  wizardSelection = { client: new Set(), project: new Set(), product: new Set(), environment: new Set() };
  wizardStepIndex = 0;
}

function wizardStep() {
  return WIZARD_STEPS[wizardStepIndex];
}

function showWizardSuccess(label) {
  return new Promise((resolve) => {
    const dialog = document.getElementById("wizardSuccessDialog");
    document.getElementById("wizardSuccessTitle").textContent = t("{item} adicionado com sucesso", { item: label });
    const finish = (choice) => { dialog.close(); resolve(choice); };
    document.getElementById("wizardSuccessAnother").onclick = () => finish("another");
    document.getElementById("wizardSuccessContinue").onclick = () => finish("continue");
    dialog.showModal();
  });
}

async function continueWizardAfterSuccess(label) {
  const choice = await showWizardSuccess(label);
  if (choice === "continue" && wizardStepIndex < WIZARD_STEPS.length - 1) wizardStepIndex += 1;
  renderWizardStep();
}

// Required for the core hierarchy (client/project/product/environment) - optional for URLs and
// the three trailing steps, which all have their own explicit "Pular" action anyway.
function wizardStepCanAdvance() {
  const step = wizardStep();
  if (["testAccounts", "paymentMethods", "devices", "inspectors", "urls"].includes(step.key)) return true;
  return wizardSelection[step.key]?.size > 0;
}

function wizardEntityChip(item, selectionKey) {
  const selected = wizardSelection[selectionKey].has(item.id);
  return `<button type="button" class="wizardChip${selected ? " isSelected" : ""}" data-wizard-chip="${escapeHtml(item.id)}">${selected ? ICON("pass") : ""} ${escapeHtml(item.name)}</button>`;
}

function renderWizardEntityStep(step) {
  const items = workspace[step.collection] || [];
  const parentStep = step.parentKey ? WIZARD_STEPS.find((candidate) => candidate.key === step.parentKey) : null;
  const parentItems = parentStep ? workspace[parentStep.collection] || [] : null;
  const parentSelectionIds = step.parentKey ? [...wizardSelection[step.parentKey]] : null;
  const relevantParentId = parentSelectionIds?.length ? parentSelectionIds[parentSelectionIds.length - 1] : null;
  const visibleItems = step.parentField && parentSelectionIds?.length
    ? items.filter((item) => parentSelectionIds.includes(item[step.parentField]))
    : items;
  const parentOptions = parentItems
    ? (parentItems.length ? parentItems.map((parent) => `<option value="${escapeHtml(parent.id)}" ${parent.id === relevantParentId ? "selected" : ""}>${escapeHtml(parent.name)}</option>`).join("") : `<option value="">${escapeHtml(t("Nenhum cadastrado ainda"))}</option>`)
    : "";
  return `
    <div class="wizardAddRow">
      <input type="text" id="wizardEntityInput" placeholder="${escapeHtml(t("Nome do {entity}", { entity: step.label().toLowerCase() }))}" />
      ${parentItems ? `<select id="wizardEntityParent" aria-label="${escapeHtml(parentStep.label())}" ${parentItems.length ? "" : "disabled"}>${parentOptions}</select>` : ""}
      <button type="button" class="button primary" id="wizardEntityAdd">${escapeHtml(t("Adicionar"))}</button>
    </div>
    <div>
      <p class="cardLead wizardExistingLabel">${escapeHtml(t("Já cadastrados:"))}</p>
      <div class="wizardChipList" id="wizardChipList">${visibleItems.length ? visibleItems.map((item) => wizardEntityChip(item, step.key)).join("") : `<span class="wizardChipEmpty">${escapeHtml(t("Nenhum ainda - adicione o primeiro acima."))}</span>`}</div>
    </div>`;
}

function renderWizardEnvironmentStep() {
  const existing = workspace.environments || [];
  return `
    <div class="wizardAddRow">
      <input type="text" id="wizardEnvName" placeholder="${escapeHtml(t("Nome do ambiente (ex.: QA, Staging)"))}" />
      <div class="wizardColorRow"><input type="color" id="wizardEnvColor" value="#7c5cff" title="${escapeHtml(t("Cor da barra"))}" /><button type="button" class="button primary" id="wizardEnvAdd">${escapeHtml(t("Adicionar"))}</button></div>
    </div>
    <div class="wizardEnvPreview" id="wizardEnvPreview" style="--wizard-preview-color:#7c5cff"><span class="dot"></span><strong id="wizardEnvPreviewName">${escapeHtml(t("Prévia"))}</strong></div>
    <div>
      <p class="cardLead wizardExistingLabel">${escapeHtml(t("Já cadastrados:"))}</p>
      <div class="wizardChipList" id="wizardChipList">${existing.length ? existing.map((env) => wizardEntityChip(env, "environment")).join("") : `<span class="wizardChipEmpty">${escapeHtml(t("Nenhum ainda - adicione o primeiro acima."))}</span>`}</div>
    </div>`;
}

function renderWizardUrlsStep() {
  const environmentIds = [...wizardSelection.environment];
  const productIds = [...wizardSelection.product];
  if (!environmentIds.length) return `<p class="wizardChipEmpty">${escapeHtml(t("Volte e crie/selecione um ambiente primeiro."))}</p>`;
  const environments = environmentIds.map((id) => findById("environments", id)).filter(Boolean);
  const products = productIds.map((id) => findById("products", id)).filter(Boolean);
  const relevantBindings = (workspace.urlBindings || []).filter((binding) => (binding.environmentIds || []).some((id) => environmentIds.includes(id)));
  return `
    <div class="wizardAddRow">
      <input type="text" id="wizardUrlPattern" placeholder="${escapeHtml(t("https://app.exemplo.com/*"))}" />
      <select id="wizardUrlProduct" aria-label="${escapeHtml(t("Produto"))}">${products.length ? products.map((product) => `<option value="${escapeHtml(product.id)}">${escapeHtml(product.name)}</option>`).join("") : `<option value="">${escapeHtml(t("Nenhum produto selecionado"))}</option>`}</select>
      <button type="button" class="button primary" id="wizardUrlAdd">${escapeHtml(t("Adicionar"))}</button>
    </div>
    <p class="cardLead wizardRelationSummary">${escapeHtml(t("Será associada ao ambiente: {env}", { env: environments.map((environment) => environment.name).join(", ") }))}</p>
    <div class="wizardChipList" id="wizardChipList">${relevantBindings.length ? relevantBindings.map((binding) => `<span class="wizardChip">${escapeHtml((binding.patterns || []).join(", "))}</span>`).join("") : `<span class="wizardChipEmpty">${escapeHtml(t("Nenhuma URL ainda."))}</span>`}</div>`;
}

function wizardCsvPanelHtml(key) {
  const schema = WIZARD_CSV_SCHEMA[key];
  if (!schema) return "";
  return `
    <div class="wizardCsvImport" id="wizardCsvPanel-${key}" hidden>
      <textarea id="wizardCsvInput-${key}" placeholder="${escapeHtml(schema.example)}"></textarea>
      <p class="wizardCsvHint">${escapeHtml(t("Colunas esperadas: {columns}. A primeira linha pode ser o cabeçalho ou já ser o primeiro registro.", { columns: schema.columns.join(", ") }))}</p>
      <div class="wizardOptionalActions"><button type="button" class="button primary" data-wizard-csv-submit="${key}">${escapeHtml(t("Importar linhas"))}</button></div>
      <p class="formMessage" id="wizardCsvMessage-${key}" role="status"></p>
    </div>`;
}

function renderWizardOptionalStep(step) {
  const composerId = WIZARD_OPTIONAL_COMPOSER[step.key];
  const count = (workspace[step.collection] || []).length;
  const details = {
    testAccounts: [
      ["Escopo N:N", "Relacione uma conta a vários ambientes e produtos."],
      ["Credenciais", "Nome, tipo, usuário, senha e observações."],
      ["Campos flexíveis", "Crie campos de texto, número ou sim e não."],
    ],
    paymentMethods: [
      ["Escopo N:N", "Reutilize um meio em vários ambientes e produtos."],
      ["Tipos", "Cartão, PIX, conta bancária ou outro."],
      ["Dados sandbox", "Token, titular, validade, CVV e observações."],
    ],
    inspectors: [
      ["Identificação", "Dê um nome claro para o grupo de chamadas."],
      ["Várias rotas", "Informe um ou mais padrões de endpoint."],
      ["Execução segura", "A configuração é declarativa e não executa scripts."],
    ],
    devices: [
      ["Relação N:N", "Um dispositivo pode usar vários sistemas e navegadores."],
      ["Catálogos prontos", "Ícones e opções conhecidas já vêm cadastrados."],
      ["Contexto de teste", "Use o dispositivo nos relatos e evidências."],
    ],
  }[step.key];
  return `
    <div class="wizardOptionalIntro">${details.map(([title, text]) => `<div class="wizardOptionalFact"><strong>${escapeHtml(t(title))}</strong><span>${escapeHtml(t(text))}</span></div>`).join("")}</div>
    <div class="wizardOptionalCard">
      <p>${count ? escapeHtml(t("{count} já cadastrado(s). Você pode adicionar mais ou continuar.", { count })) : escapeHtml(t("Nenhum item cadastrado. Esta etapa é opcional e pode ser concluída depois."))}</p>
      <div class="wizardOptionalActions">
        <button type="button" class="button primary" data-wizard-open-composer="${composerId}" data-wizard-optional-key="${step.key}">${escapeHtml(t("Preencher formulário"))}</button>
        ${WIZARD_CSV_SCHEMA[step.key] ? `<button type="button" class="button" data-wizard-template="${step.key}">${escapeHtml(t("Baixar template CSV"))}</button><button type="button" class="button" data-wizard-csv="${step.key}">${escapeHtml(t("Importar CSV"))}</button>` : ""}
      </div>
    </div>
    ${wizardCsvPanelHtml(step.key)}`;
}

// A CSV's first line might be a real header row (matches every expected column name) or might
// already be the first data record - only skip it as a header when every expected column is
// actually present, so a header-less paste never silently loses its first row.
function parseWizardCsv(text, columns) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];
  const firstCells = lines[0].split(",").map((cell) => cell.trim().toLowerCase());
  const isHeader = columns.every((column) => firstCells.includes(column));
  const order = isHeader ? firstCells : columns;
  const dataLines = isHeader ? lines.slice(1) : lines;
  return dataLines.map((line) => {
    const cells = line.split(",").map((cell) => cell.trim());
    const record = {};
    order.forEach((column, index) => { if (columns.includes(column)) record[column] = cells[index] || ""; });
    return record;
  }).filter((record) => record.label);
}

function bindWizardStepEvents(step) {
  document.querySelectorAll("#wizardChipList [data-wizard-chip]").forEach((chip) => chip.addEventListener("click", () => {
    const set = wizardSelection[step.key];
    const id = chip.dataset.wizardChip;
    if (set.has(id)) set.delete(id); else set.add(id);
    renderWizardStep();
  }));

  if (["client", "project", "product"].includes(step.key)) {
    const addEntity = async () => {
      const input = document.getElementById("wizardEntityInput");
      const name = input.value.trim();
      if (!name) { input.focus(); return; }
      const record = { id: uid(step.collection.replace(/s$/, "")), name };
      if (step.parentField) {
        const parentId = document.getElementById("wizardEntityParent")?.value;
        if (!parentId) { input.focus(); return; }
        record[step.parentField] = parentId;
      }
      workspace[step.collection].push(record);
      wizardSelection[step.key].add(record.id);
      renderWizardStep();
      await persistWorkspace();
      await continueWizardAfterSuccess(step.label());
    };
    document.getElementById("wizardEntityAdd").addEventListener("click", () => void addEntity());
    document.getElementById("wizardEntityInput").addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); void addEntity(); } });
  }

  if (step.key === "environment") {
    const nameInput = document.getElementById("wizardEnvName");
    const colorInput = document.getElementById("wizardEnvColor");
    const preview = document.getElementById("wizardEnvPreview");
    const previewName = document.getElementById("wizardEnvPreviewName");
    const syncPreview = () => {
      preview.style.setProperty("--wizard-preview-color", colorInput.value);
      previewName.textContent = nameInput.value.trim() || t("Prévia");
    };
    nameInput.addEventListener("input", syncPreview);
    colorInput.addEventListener("input", syncPreview);
    document.getElementById("wizardEnvAdd").addEventListener("click", async () => {
      const name = nameInput.value.trim();
      if (!name) { nameInput.focus(); return; }
      const record = { id: uid("environment"), name, color: colorInput.value };
      workspace.environments.push(record);
      wizardSelection.environment.add(record.id);
      renderWizardStep();
      await persistWorkspace();
      await continueWizardAfterSuccess(t("Ambiente"));
    });
  }

  if (step.key === "urls") {
    document.getElementById("wizardUrlAdd")?.addEventListener("click", async () => {
      const patternInput = document.getElementById("wizardUrlPattern");
      const productSelect = document.getElementById("wizardUrlProduct");
      const pattern = patternInput.value.trim();
      const productId = productSelect?.value;
      if (!pattern || !productId) { patternInput.focus(); return; }
      workspace.urlBindings.push({ id: uid("binding"), productId, environmentIds: [...wizardSelection.environment], patterns: normalizeUrlPatterns(pattern) });
      patternInput.value = "";
      renderWizardStep();
      await persistWorkspace();
      await continueWizardAfterSuccess(t("URL"));
    });
  }

  if (["testAccounts", "paymentMethods", "devices", "inspectors"].includes(step.key)) {
    document.querySelectorAll("[data-wizard-open-composer]").forEach((button) => button.addEventListener("click", () => {
      const key = button.dataset.wizardOptionalKey;
      wizardOptionalComposerKey = key;
      if (key === "testAccounts" || key === "paymentMethods") {
        const state = scopePickerStates[key === "testAccounts" ? "testAccount" : "paymentMethod"];
        state.environmentIds = new Set(wizardSelection.environment);
        state.productIds = new Set(wizardSelection.product);
        renderScopePicker(key === "testAccounts" ? "testAccount" : "paymentMethod", { requireEnvironment: key === "testAccounts" });
      }
      document.getElementById(button.dataset.wizardOpenComposer)?.showModal();
    }));
    document.querySelectorAll("[data-wizard-csv]").forEach((button) => button.addEventListener("click", () => {
      const panel = document.getElementById(`wizardCsvPanel-${button.dataset.wizardCsv}`);
      if (panel) panel.hidden = !panel.hidden;
    }));
    document.querySelectorAll("[data-wizard-template]").forEach((button) => button.addEventListener("click", () => {
      const schema = WIZARD_CSV_SCHEMA[button.dataset.wizardTemplate];
      const blob = new Blob([`\uFEFF${schema.example}`], { type: "text/csv;charset=utf-8" });
      downloadBlob(blob, `template-${button.dataset.wizardTemplate}.csv`);
    }));
    document.querySelectorAll("[data-wizard-csv-submit]").forEach((button) => button.addEventListener("click", async () => {
      const key = button.dataset.wizardCsvSubmit;
      const schema = WIZARD_CSV_SCHEMA[key];
      const textarea = document.getElementById(`wizardCsvInput-${key}`);
      const message = document.getElementById(`wizardCsvMessage-${key}`);
      const records = parseWizardCsv(textarea.value, schema.columns);
      if (!records.length) { message.textContent = t("Nenhuma linha válida encontrada."); message.classList.add("isError"); return; }
      const environmentIds = [...wizardSelection.environment];
      const productIds = [...wizardSelection.product];
      for (const record of records) {
        if (key === "testAccounts") {
          workspace.testAccounts.push({ id: uid("testAccount"), environmentIds, productIds, label: record.label, username: record.username || "", password: record.password || "", notes: record.notes || "" });
        } else if (key === "paymentMethods") {
          workspace.paymentMethods.push({ id: uid("paymentMethod"), environmentIds, productIds, label: record.label, holder: record.holder || "", value: record.value || "", expiry: record.expiry || "", cvv: record.cvv || "", notes: record.notes || "" });
        } else if (key === "inspectors") {
          workspace.inspectors.push({ id: uid("inspector"), label: record.label, patterns: String(record.patterns || "").split("|").map((value) => value.trim()).filter(Boolean), active: true });
        } else if (key === "devices") {
          const names = (value) => String(value || "").split("|").map((item) => item.trim().toLowerCase()).filter(Boolean);
          const systemNames = new Set(names(record.systems));
          const browserNames = new Set(names(record.browsers));
          workspace.devices.push({
            id: uid("device"),
            label: record.label,
            operatingSystemIds: workspace.operatingSystems.filter((item) => systemNames.has(item.name.toLowerCase())).map((item) => item.id),
            browserIds: workspace.browsers.filter((item) => browserNames.has(item.name.toLowerCase())).map((item) => item.id),
            notes: record.notes || "",
            active: true,
          });
        }
      }
      await persistWorkspace();
      message.classList.remove("isError");
      message.textContent = t("{count} registro(s) importado(s).", { count: records.length });
      textarea.value = "";
    }));
  }
}

function renderWizardDots() {
  document.getElementById("onboardingWizardDots").innerHTML = WIZARD_STEPS.map((step, index) => `
    <button type="button" class="wizardStepDot${index === wizardStepIndex ? " isActive" : ""}${index < wizardStepIndex ? " isDone" : ""}" data-wizard-dot="${index}" title="${escapeHtml(step.label())}">
      <span class="dot">${index < wizardStepIndex ? ICON("pass") : index + 1}</span>
      <span class="label">${escapeHtml(step.label())}</span>
    </button>`).join("");
  document.querySelectorAll("[data-wizard-dot]").forEach((button) => button.addEventListener("click", () => {
    const target = Number(button.dataset.wizardDot);
    if (target <= wizardStepIndex || wizardStepCanAdvance()) { wizardStepIndex = target; renderWizardStep(); }
  }));
}

function renderWizardStep() {
  const step = wizardStep();
  document.getElementById("onboardingWizardEyebrow").textContent = t("Passo {current} de {total}", { current: wizardStepIndex + 1, total: WIZARD_STEPS.length });
  document.getElementById("onboardingWizardTitle").textContent = step.title();
  document.getElementById("onboardingWizardLead").textContent = step.lead();
  const body = document.getElementById("onboardingWizardBody");
  if (["client", "project", "product"].includes(step.key)) body.innerHTML = renderWizardEntityStep(step);
  else if (step.key === "environment") body.innerHTML = renderWizardEnvironmentStep();
  else if (step.key === "urls") body.innerHTML = renderWizardUrlsStep();
  else body.innerHTML = renderWizardOptionalStep(step);
  renderWizardDots();
  bindWizardStepEvents(step);
  document.getElementById("onboardingWizardBack").disabled = wizardStepIndex === 0;
  document.getElementById("onboardingWizardSkip").hidden = ["client", "project", "product", "environment"].includes(step.key);
  document.getElementById("onboardingWizardTemplate").hidden = wizardStepIndex !== 0;
  document.getElementById("onboardingWizardNext").textContent = wizardStepIndex === WIZARD_STEPS.length - 1 ? t("Concluir") : t("Continuar");
}

function openOnboardingWizard() {
  resetWizardSelection();
  renderWizardStep();
  document.getElementById("onboardingWizard").showModal();
}

function closeOnboardingWizard() {
  document.getElementById("onboardingWizard").close();
}

document.getElementById("openOnboardingWizard").addEventListener("click", () => openOnboardingWizard());
document.getElementById("workspaceWizardNudgeOpen").addEventListener("click", () => openOnboardingWizard());
document.getElementById("onboardingWizardClose").addEventListener("click", () => closeOnboardingWizard());
document.getElementById("onboardingWizardBack").addEventListener("click", () => { if (wizardStepIndex > 0) { wizardStepIndex -= 1; renderWizardStep(); } });
document.getElementById("onboardingWizardSkip").addEventListener("click", () => {
  if (wizardStepIndex < WIZARD_STEPS.length - 1) { wizardStepIndex += 1; renderWizardStep(); } else closeOnboardingWizard();
});
document.getElementById("onboardingWizardNext").addEventListener("click", () => {
  if (!wizardStepCanAdvance()) return;
  if (wizardStepIndex < WIZARD_STEPS.length - 1) { wizardStepIndex += 1; renderWizardStep(); } else closeOnboardingWizard();
});
// Fast path for someone who just wants realistic example data instead of typing their own -
// reuses the exact same one-of-everything template as "Baixar template" (Importar/Exportar), so
// the two never drift into showing different shapes.
document.getElementById("onboardingWizardTemplate").addEventListener("click", async () => {
  const template = buildTemplateWorkspace();
  for (const collection of IMPORTABLE_COLLECTIONS) workspace[collection].push(...template[collection]);
  await persistWorkspace();
  closeOnboardingWizard();
});

// Founder feedback: with enough clients/products/accounts registered (especially ones carrying
// base64 logos/icons), saving felt sluggish because the UI waited for the full chrome.storage.local
// write to finish before showing anything. `workspace` is already the up-to-date in-memory object
// (upsert/cascadeRemove mutate it directly) - rendering it immediately makes every edit feel
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
  setComposerEditing(prefix, false);
  form.querySelectorAll("[data-default-placeholder]").forEach((element) => { element.placeholder = element.dataset.defaultPlaceholder; });
  const showLabel = document.getElementById(`${prefix}ShowLabel`); if (showLabel) showLabel.checked = true;
  if (prefix === "environment") { document.getElementById("environmentColor").value = "#3a3a3a"; }
  if (prefix === "urlRelation") { urlSelectedEnvironmentIds = new Set(); urlSelectedProductIds = new Set(); renderUrlEnvironmentPicker(); renderUrlProductPicker(); urlPatternsDraft = []; renderUrlPatternsPicker(); }
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
  if (prefix === "device") {
    document.querySelectorAll("#deviceOperatingSystems input, #deviceBrowsers input").forEach((input) => { input.checked = false; });
  }
  const composer = document.getElementById(`${prefix}Composer`);
  if (composer?.open) composer.close();
}

// Test account custom fields: a small user-defined key/type/value schema (string/boolean/
// number) rather than a fixed capability list - the founder's explicit ask, since even the
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
// adding/editing any other account - founder feedback: a field created on one account wasn't
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
// <details> below its list - "+ Adicionar X" triggers open it, the × in the header (or Esc,
// native to <dialog>) closes it without saving.
document.querySelectorAll("[data-open-composer]").forEach((button) => button.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  const dialog = document.getElementById(button.dataset.openComposer);
  if (!dialog || dialog.open) return;
  // Closing a previous edit via the × (instead of "Cancelar") never cleared its editId - opening
  // this same dialog fresh for "Adicionar" would otherwise silently resubmit as an update to that
  // still-referenced item instead of creating a new one.
  const prefix = button.dataset.openComposer.replace(/Composer$/, "");
  if (document.getElementById(`${prefix}EditId`)?.value) clearEdit(prefix);
  dialog.showModal();
}));
document.querySelectorAll("[data-close-composer]").forEach((button) => button.addEventListener("click", () => button.closest("dialog")?.close()));

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-tree-create]");
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  const collection = button.dataset.treeCreate;
  const composerId = collection === "project" ? "projectComposer" : "productComposer";
  if (document.getElementById(`${collection}EditId`)?.value) clearEdit(collection);
  const select = document.getElementById(collection === "project" ? "projectClient" : "productProject");
  if (select) select.value = button.dataset.parentId || "";
  document.getElementById(composerId)?.showModal();
});
document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-add-url-for-environment]");
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  if (document.getElementById("urlRelationEditId")?.value) clearEdit("urlRelation");
  urlSelectedEnvironmentIds = new Set([button.dataset.addUrlForEnvironment]);
  renderUrlEnvironmentPicker();
  document.getElementById("urlRelationComposer")?.showModal();
});

let workspaceDragPayload = null;
document.addEventListener("dragstart", (event) => {
  const entity = event.target.closest("[data-entity-collection][data-entity-id]");
  const url = event.target.closest('[data-drag-collection="urlBindings"][data-id]');
  const source = entity ? { collection: entity.dataset.entityCollection, id: entity.dataset.entityId } : url ? { collection: "urlBindings", id: url.dataset.id } : null;
  if (!source) return;
  workspaceDragPayload = source;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("application/x-qts-workspace-entity", JSON.stringify(source));
});
document.addEventListener("dragend", () => {
  workspaceDragPayload = null;
  document.querySelectorAll(".isDropTarget").forEach((element) => element.classList.remove("isDropTarget"));
});
document.addEventListener("dragover", (event) => {
  if (!workspaceDragPayload) return;
  const entityTarget = event.target.closest("[data-entity-collection][data-entity-id]");
  const treeTarget = event.target.closest("[data-tree-dimension][data-tree-entity-id]");
  const allowed = (workspaceDragPayload.collection === "projects" && entityTarget?.dataset.entityCollection === "clients")
    || (workspaceDragPayload.collection === "products" && entityTarget?.dataset.entityCollection === "projects")
    || (workspaceDragPayload.collection === "urlBindings" && ["environment", "product"].includes(treeTarget?.dataset.treeDimension));
  if (!allowed) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  (entityTarget || treeTarget).classList.add("isDropTarget");
});
document.addEventListener("dragleave", (event) => event.target.closest(".isDropTarget")?.classList.remove("isDropTarget"));
document.addEventListener("drop", async (event) => {
  if (!workspaceDragPayload) return;
  const entityTarget = event.target.closest("[data-entity-collection][data-entity-id]");
  const treeTarget = event.target.closest("[data-tree-dimension][data-tree-entity-id]");
  let changed = false;
  if (workspaceDragPayload.collection === "projects" && entityTarget?.dataset.entityCollection === "clients") {
    const project = findById("projects", workspaceDragPayload.id);
    if (project && project.clientId !== entityTarget.dataset.entityId) { project.clientId = entityTarget.dataset.entityId; changed = true; }
  }
  if (workspaceDragPayload.collection === "products" && entityTarget?.dataset.entityCollection === "projects") {
    const product = findById("products", workspaceDragPayload.id);
    if (product && product.projectId !== entityTarget.dataset.entityId) { product.projectId = entityTarget.dataset.entityId; changed = true; }
  }
  if (workspaceDragPayload.collection === "urlBindings" && treeTarget?.dataset.treeEntityId) {
    const binding = findById("urlBindings", workspaceDragPayload.id);
    if (binding && treeTarget.dataset.treeDimension === "environment") { binding.environmentIds = [treeTarget.dataset.treeEntityId]; changed = true; }
    if (binding && treeTarget.dataset.treeDimension === "product") { binding.productId = treeTarget.dataset.treeEntityId; binding.productIds = [treeTarget.dataset.treeEntityId]; changed = true; }
  }
  workspaceDragPayload = null;
  document.querySelectorAll(".isDropTarget").forEach((element) => element.classList.remove("isDropTarget"));
  if (changed) { event.preventDefault(); await persistWorkspace(); }
});

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
// (stacked <dialog>s, standard behavior) - when that's how it was opened, the freshly created
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
  const accountType = findById("accountTypes", document.getElementById("testAccountTypeId").value);
  upsert("testAccounts", { id: editId || uid("account"), environmentIds: [...scope.environmentIds], productIds: [...scope.productIds], label: document.getElementById("testAccountLabel").value.trim(), accountTypeId: accountType?.id || "", accountType: accountType?.name || "", accountTypeImage: accountType?.icon || "", username: document.getElementById("testAccountUsername").value.trim(), password: password || existing?.password || "", notes: document.getElementById("testAccountNotes").value.trim(), customFields: testAccountCustomFieldsDraft, active: true }, editId);
  clearEdit("testAccount");
  await persistWorkspace();
  if (onboardingWizard.open && wizardOptionalComposerKey === "testAccounts") {
    wizardOptionalComposerKey = null;
    await continueWizardAfterSuccess(t("Conta de teste"));
  }
});
document.getElementById("paymentMethodForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const scope = scopePickerStates.paymentMethod;
  const editId = document.getElementById("paymentMethodEditId").value;
  const existing = findById("paymentMethods", editId);
  const paymentMethodType = findById("paymentMethodTypes", document.getElementById("paymentMethodTypeId").value);
  upsert("paymentMethods", { id: editId || uid("payment"), environmentIds: [...scope.environmentIds], productIds: [...scope.productIds], label: document.getElementById("paymentMethodLabel").value.trim(), typeId: paymentMethodType?.id || "", type: paymentMethodType?.name || "", icon: document.getElementById("paymentMethodIcon").value.trim(), value: document.getElementById("paymentMethodValue").value.trim() || existing?.value || "", holder: document.getElementById("paymentMethodHolder").value.trim(), expiry: document.getElementById("paymentMethodExpiry").value.trim(), cvv: document.getElementById("paymentMethodCvv").value.trim() || existing?.cvv || "", notes: document.getElementById("paymentMethodNotes").value.trim(), active: true }, editId);
  clearEdit("paymentMethod");
  await persistWorkspace();
  if (onboardingWizard.open && wizardOptionalComposerKey === "paymentMethods") {
    wizardOptionalComposerKey = null;
    await continueWizardAfterSuccess(t("Meio de pagamento"));
  }
});
// After a quick-add ("+ novo") from inside the device composer, the newly created system/browser
// is checked back into the pill it came from, instead of leaving the user to find and tick it.
let quickAddTypeTarget = null;
document.querySelectorAll("[data-quick-add-type]").forEach((button) => button.addEventListener("click", () => {
  quickAddTypeTarget = button.dataset.quickAddType;
  document.getElementById(`${quickAddTypeTarget}Composer`).showModal();
}));
document.getElementById("accountTypeForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const editId = document.getElementById("accountTypeEditId").value;
  const newId = editId || uid("accountType");
  upsert("accountTypes", { id: newId, name: document.getElementById("accountTypeName").value.trim(), icon: document.getElementById("accountTypeIcon").value.trim(), active: true }, editId);
  clearEdit("accountType");
  await persistWorkspace();
  if (quickAddTypeTarget === "accountType") { document.getElementById("testAccountTypeId").value = newId; quickAddTypeTarget = null; }
});
document.getElementById("paymentMethodTypeForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const editId = document.getElementById("paymentMethodTypeEditId").value;
  const newId = editId || uid("paymentMethodType");
  upsert("paymentMethodTypes", { id: newId, name: document.getElementById("paymentMethodTypeName").value.trim(), icon: document.getElementById("paymentMethodTypeIcon").value.trim(), active: true }, editId);
  clearEdit("paymentMethodType");
  await persistWorkspace();
  if (quickAddTypeTarget === "paymentMethodType") { document.getElementById("paymentMethodTypeId").value = newId; quickAddTypeTarget = null; }
});
document.getElementById("operatingSystemForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const editId = document.getElementById("operatingSystemEditId").value;
  const newId = editId || uid("operatingSystem");
  upsert("operatingSystems", { id: newId, name: document.getElementById("operatingSystemName").value.trim(), icon: document.getElementById("operatingSystemIcon").value.trim(), active: true }, editId);
  clearEdit("operatingSystem");
  await persistWorkspace();
  if (quickAddTypeTarget === "operatingSystem") { const input = document.querySelector(`#deviceOperatingSystems input[value="${newId}"]`); if (input) input.checked = true; quickAddTypeTarget = null; }
});
document.getElementById("browserForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const editId = document.getElementById("browserEditId").value;
  const newId = editId || uid("browser");
  upsert("browsers", { id: newId, name: document.getElementById("browserName").value.trim(), icon: document.getElementById("browserIcon").value.trim(), active: true }, editId);
  clearEdit("browser");
  await persistWorkspace();
  if (quickAddTypeTarget === "browser") { const input = document.querySelector(`#deviceBrowsers input[value="${newId}"]`); if (input) input.checked = true; quickAddTypeTarget = null; }
});
document.querySelectorAll("[data-inspector-pattern]").forEach((button) => button.addEventListener("click", () => {
  const input = document.getElementById("inspectorPatterns");
  const pattern = button.dataset.inspectorPattern;
  const patterns = input.value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  if (!patterns.includes(pattern)) patterns.push(pattern);
  input.value = patterns.join("\n");
  input.focus();
}));
document.getElementById("deviceForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const editId = document.getElementById("deviceEditId").value;
  const operatingSystemIds = [...document.querySelectorAll("#deviceOperatingSystems input:checked")].map((input) => input.value);
  const browserIds = [...document.querySelectorAll("#deviceBrowsers input:checked")].map((input) => input.value);
  upsert("devices", { id: editId || uid("device"), label: document.getElementById("deviceLabel").value.trim(), operatingSystemIds, browserIds, notes: document.getElementById("deviceNotes").value.trim(), active: true }, editId);
  clearEdit("device");
  await persistWorkspace();
  if (onboardingWizard.open && wizardOptionalComposerKey === "devices") {
    wizardOptionalComposerKey = null;
    await continueWizardAfterSuccess(t("Dispositivo"));
  }
});
document.getElementById("inspectorForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const editId = document.getElementById("inspectorEditId").value;
  upsert("inspectors", { id: editId || uid("inspector"), label: document.getElementById("inspectorLabel").value.trim(), patterns: document.getElementById("inspectorPatterns").value.split(/\n|,/).map((v) => v.trim()).filter(Boolean), active: true }, editId);
  clearEdit("inspector");
  await persistWorkspace();
  if (onboardingWizard.open && wizardOptionalComposerKey === "inspectors") {
    wizardOptionalComposerKey = null;
    await continueWizardAfterSuccess(t("Inspector"));
  }
});
document.getElementById("apiForm").addEventListener("submit", async (event) => { event.preventDefault(); const editId = document.getElementById("apiEditId").value; const existing = findById("apis", editId); upsert("apis", { id: editId || uid("api"), label: document.getElementById("apiLabel").value.trim(), baseUrl: document.getElementById("apiBaseUrl").value.trim(), token: document.getElementById("apiToken").value || existing?.token || "", active: true }, editId); clearEdit("api"); await persistWorkspace(); });
document.getElementById("resourceForm").addEventListener("submit", async (event) => { event.preventDefault(); const editId = document.getElementById("resourceEditId").value; upsert("resources", { id: editId || uid("resource"), label: document.getElementById("resourceLabel").value.trim(), url: document.getElementById("resourceUrl").value.trim(), category: document.getElementById("resourceCategory").value.trim(), icon: document.getElementById("resourceIcon").value.trim(), active: true }, editId); clearEdit("resource"); await persistWorkspace(); });

document.getElementById("urlPatternAdd").addEventListener("click", () => addUrlPatternDraft());
document.getElementById("urlPatternInput").addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  addUrlPatternDraft();
});

// The founder's own request: drop the manual "URL principal" field entirely - the first pattern
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
  // A URL still sitting in the input (typed but not explicitly added) counts too - otherwise
  // submitting silently drops it, which is exactly the confusing "só salva o que já virou pill"
  // trap this rework is meant to fix.
  if (patternInput.value.trim()) addUrlPatternDraft();
  if (!urlSelectedEnvironmentIds.size) { patternInput.setCustomValidity(t("Selecione pelo menos um ambiente.")); patternInput.reportValidity(); return; }
  if (!urlSelectedProductIds.size) { patternInput.setCustomValidity(t("Selecione pelo menos um produto.")); patternInput.reportValidity(); return; }
  if (!urlPatternsDraft.length) { patternInput.setCustomValidity(t("Informe ao menos uma URL ou padrão válido.")); patternInput.reportValidity(); return; }
  patternInput.setCustomValidity("");
  const editId = document.getElementById("urlRelationEditId").value;
  const selectedProducts = [...urlSelectedProductIds];
  const firstProductId = selectedProducts.shift();
  upsert("urlBindings", { id: editId || uid("binding"), patterns: [...urlPatternsDraft], productId: firstProductId, environmentIds: [...urlSelectedEnvironmentIds], primaryUrl: derivePrimaryUrl(urlPatternsDraft[0]), active: true }, editId);
  for (const productId of selectedProducts) {
    workspace.urlBindings.push({ id: uid("binding"), patterns: [...urlPatternsDraft], productId, environmentIds: [...urlSelectedEnvironmentIds], primaryUrl: derivePrimaryUrl(urlPatternsDraft[0]), active: true });
  }
  clearEdit("urlRelation");
  await persistWorkspace();
});

// The composer dialog is shared between "Adicionar X" and editing an existing row, but its title
// used to stay "Adicionar X" in both cases - with no visual difference between a genuinely blank
// new-item form and an edit form that's just hiding a saved sensitive value, users read the blank
// number/CVV/senha/token fields as data loss. Swapping the title makes the mode unambiguous.
// Keyed through t() with explicit PT source strings (not a DOM string-replace) so it's correct
// regardless of which locale is currently displayed.
const COMPOSER_TITLES = {
  client: { add: "Adicionar cliente", edit: "Editar cliente" },
  project: { add: "Adicionar projeto", edit: "Editar projeto" },
  product: { add: "Adicionar produto", edit: "Editar produto" },
  environment: { add: "Adicionar ambiente", edit: "Editar ambiente" },
  urlRelation: { add: "Adicionar URL", edit: "Editar URL" },
  testAccount: { add: "Adicionar conta", edit: "Editar conta" },
  paymentMethod: { add: "Adicionar pagamento", edit: "Editar pagamento" },
  inspector: { add: "Adicionar Inspector", edit: "Editar Inspector" },
  api: { add: "Adicionar API", edit: "Editar API" },
  resource: { add: "Adicionar recurso", edit: "Editar recurso" },
};

function setComposerEditing(prefix, isEditing) {
  const title = document.getElementById(`${prefix}ComposerTitle`);
  const variants = COMPOSER_TITLES[prefix];
  if (!title || !variants) return;
  title.textContent = t(isEditing ? variants.edit : variants.add);
}

// Sensitive fields (card number, CVV, account password, API token) are never pre-filled when
// editing - same reasoning as never re-displaying a saved password - but a bare blank input with
// no context reads as "this got erased". Swap in a placeholder that says otherwise only when the
// item actually already has a value; a genuinely new/empty item keeps its normal placeholder.
function markSensitiveFieldSaved(elementId, hasExistingValue) {
  const element = document.getElementById(elementId);
  if (!element) return;
  if (!element.dataset.defaultPlaceholder) element.dataset.defaultPlaceholder = element.placeholder;
  element.placeholder = hasExistingValue ? t("Já salvo - deixe em branco para manter") : element.dataset.defaultPlaceholder;
}

function editItem(collection, item) {
  const prefix = COLLECTION_UI[collection].prefix;
  const workspaceTabs = { clients: "structure", projects: "structure", products: "structure", environments: "urls", urlBindings: "urls", testAccounts: "accounts", paymentMethods: "payments", inspectors: "integrations", apis: "integrations", resources: "integrations", operatingSystems: "devices", browsers: "devices", devices: "devices", accountTypes: "accounts", paymentMethodTypes: "payments" };
  activateWorkspaceTab(workspaceTabs[collection] || "structure", { syncNavigation: true });
  const composer = document.getElementById(`${prefix}Composer`);
  if (composer && !composer.open) composer.showModal();
  document.getElementById(`${prefix}EditId`).value = item.id;
  document.querySelector(`[data-cancel="${prefix}"]`).hidden = false;
  setComposerEditing(prefix, true);
  if (collection === "testAccounts") markSensitiveFieldSaved("testAccountPassword", Boolean(item.password));
  if (collection === "paymentMethods") { markSensitiveFieldSaved("paymentMethodValue", Boolean(item.value)); markSensitiveFieldSaved("paymentMethodCvv", Boolean(item.cvv)); }
  if (collection === "apis") markSensitiveFieldSaved("apiToken", Boolean(item.token));
  const values = {
    clients: { clientName: item.name, clientLogoUrl: item.logoUrl, clientAbbreviation: item.abbreviation, clientShowLabel: item.showLabel !== false },
    projects: { projectClient: item.clientId, projectName: item.name, projectLogoUrl: item.logoUrl, projectAbbreviation: item.abbreviation, projectShowLabel: item.showLabel !== false },
    products: { productProject: item.projectId, productName: item.name, productLogoUrl: item.logoUrl, productAbbreviation: item.abbreviation, productShowLabel: item.showLabel !== false },
    environments: { environmentName: item.name, environmentColor: item.color },
    urlBindings: { urlPatternInput: "" },
    testAccounts: { testAccountLabel: item.label, testAccountTypeId: item.accountTypeId, testAccountUsername: item.username, testAccountPassword: "", testAccountNotes: item.notes },
    paymentMethods: { paymentMethodLabel: item.label, paymentMethodTypeId: item.typeId, paymentMethodIcon: item.icon, paymentMethodValue: "", paymentMethodHolder: item.holder, paymentMethodExpiry: item.expiry, paymentMethodCvv: "", paymentMethodNotes: item.notes },
    inspectors: { inspectorLabel: item.label, inspectorPatterns: (item.patterns || []).join("\n") },
    apis: { apiLabel: item.label, apiBaseUrl: item.baseUrl, apiToken: "" },
    resources: { resourceLabel: item.label, resourceUrl: item.url, resourceCategory: item.category, resourceIcon: item.icon },
    operatingSystems: { operatingSystemName: item.name, operatingSystemIcon: item.icon },
    browsers: { browserName: item.name, browserIcon: item.icon },
    devices: { deviceLabel: item.label, deviceNotes: item.notes },
    accountTypes: { accountTypeName: item.name, accountTypeIcon: item.icon },
    paymentMethodTypes: { paymentMethodTypeName: item.name, paymentMethodTypeIcon: item.icon },
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
    urlSelectedProductIds = new Set([item.productId]);
    renderUrlEnvironmentPicker();
    renderUrlProductPicker();
    urlPatternsDraft = [...(item.patterns || [])];
    renderUrlPatternsPicker();
  }
  if (collection === "devices") {
    const checkedIds = new Set([...(item.operatingSystemIds || []), ...(item.browserIds || [])]);
    document.querySelectorAll("#deviceOperatingSystems input, #deviceBrowsers input").forEach((input) => { input.checked = checkedIds.has(input.value); });
  }
  document.getElementById(`${prefix}Form`).scrollIntoView({ behavior: "smooth", block: "center" });
}

// Environments are reusable across products now (see storage.js's normalizeUrlBindings), so
// removing a client/project/product no longer deletes environments - only the URL bindings and
// product-scoped test accounts/payment methods that actually belong to the removed product(s).
// An environment itself only goes away when removed directly from the "Ambientes" tab.
// Test accounts/payment methods can be scoped to several environments/products at once, so
// removing just one of those no longer has to delete the whole item - only when pruning the
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
  // Unlike environments (required, non-empty), a device is still a valid device with zero
  // systems/browsers left checked - only the reference is dropped, the device itself stays.
  if (collection === "operatingSystems") {
    workspace.devices = workspace.devices.map((item) => ({ ...item, operatingSystemIds: item.operatingSystemIds.filter((entryId) => entryId !== removeId) }));
  }
  if (collection === "browsers") {
    workspace.devices = workspace.devices.map((item) => ({ ...item, browserIds: item.browserIds.filter((entryId) => entryId !== removeId) }));
  }
  if (collection === "accountTypes") {
    workspace.testAccounts = workspace.testAccounts.map((item) => (item.accountTypeId === removeId ? { ...item, accountTypeId: "", accountType: "", accountTypeImage: "" } : item));
  }
  if (collection === "paymentMethodTypes") {
    workspace.paymentMethods = workspace.paymentMethods.map((item) => (item.typeId === removeId ? { ...item, typeId: "", type: "" } : item));
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
  if (action === "remove") { if (item.locked) return; if (!(await confirmDialog(t("Excluir este item? Itens dependentes também serão removidos.")))) return; cascadeRemove(collection, id); await persistWorkspace(); }
});

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Shared by the real export button and the "download template" button below - both need the same
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

// A minimal, generic (no real customer name) one-of-*everything* workspace - normalized the same
// way an import would be, so this is guaranteed to be a file that imports cleanly. Founder
// feedback: the old template only had structure/URL examples, so a hand-edited copy that also
// needed test accounts or payment methods had no shape to copy from and came out wrong (most
// often the old singular environmentId/productId instead of the current environmentIds[]/
// productIds[] arrays). Every importable collection gets a real example now. Shared by the
// "Baixar template" button and the "Copiar prompt para IA" button below, so both always show the
// exact same accepted shape.
function buildTemplateWorkspace() {
  return normalizeWorkspace({
    clients: [{ id: "client-exemplo", name: "Cliente Exemplo" }],
    projects: [{ id: "project-exemplo", clientId: "client-exemplo", name: "Projeto Exemplo" }],
    products: [{ id: "product-exemplo", projectId: "project-exemplo", name: "Produto Exemplo" }],
    environments: [{ id: "env-exemplo", name: "QA", color: "#7657ff" }],
    urlBindings: [{ id: "binding-exemplo", patterns: ["https://app.exemplo.com/*"], productId: "product-exemplo", environmentIds: ["env-exemplo"] }],
    // password/value/cvv are omitted here on purpose (not just left blank): buildExportEnvelope
    // strips them from every export anyway, real or template, so a placeholder here would never
    // actually reach the downloaded file - and a fake-looking secret string in source is exactly
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
}

document.getElementById("exportButton").addEventListener("click", () => buildExportEnvelope(workspace, "qa-toolbar-workspace"));
document.getElementById("downloadTemplateButton").addEventListener("click", () => {
  void buildExportEnvelope(buildTemplateWorkspace(), "qa-toolbar-template");
});
// Not run through t() on purpose: this is copied into an external AI chat, not rendered as app
// UI - an LLM reads instructions in any language fine, and keeping the JSON shape (the part that
// actually has to be exact) in a single canonical string avoids a 3-locale copy silently drifting
// out of sync with IMPORTABLE_COLLECTIONS/normalizeWorkspace over time.
function buildAiImportPrompt() {
  const shape = JSON.stringify(buildTemplateWorkspace(), null, 2);
  return `Gere um arquivo JSON de workspace para o QA Toolbar Sandbox (extensão de QA), pronto para importar em Configurações -> Importar/Exportar -> Importar JSON.

Regras obrigatórias:
- A saída deve ser SOMENTE o JSON (sem markdown, sem comentários, sem texto antes/depois).
- Preserve exatamente as chaves e o formato de arrays do exemplo abaixo (ex.: environmentIds e productIds são sempre arrays, mesmo com um único item).
- Cada client/project/product/environment/testAccount/paymentMethod/api/inspector/resource/macro precisa de um "id" único (string curta, sem espaços).
- projects[].clientId, products[].projectId, urlBindings[].productId e urlBindings[].environmentIds devem referenciar ids que realmente existem no mesmo arquivo.
- Não invente credenciais reais: use dados fictícios, claramente de teste/sandbox.
- Pode remover coleções vazias, mas nunca altere o nome dos campos.

Descreva para a IA, junto com este prompt, os clientes/projetos/produtos/ambientes reais que você quer (nomes, quantas URLs por ambiente, quais contas de teste e cartões sandbox precisa) - ela deve preencher a estrutura abaixo com esses dados.

Estrutura de exemplo (formato aceito pelo importador):
${shape}`;
}

document.getElementById("aiPromptButton").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(buildAiImportPrompt());
    document.getElementById("dataHint").textContent = t("Prompt copiado! Cole numa IA (ChatGPT, Claude etc.) junto com os dados que você quer, e ela devolve um JSON pronto para importar.");
  } catch {
    document.getElementById("dataHint").textContent = t("Não foi possível copiar automaticamente. Permita a permissão de área de transferência e tente de novo.");
  }
});
// normalizeWorkspace() is deliberately forgiving (it has to be - it's also what reads whatever's
// already in local storage across schema versions, and silently healing a slightly-off value
// there is the right call). An imported *file* is different: a junk entry here almost always
// means the file itself is wrong (hand-edited badly, wrong file picked, truncated download), and
// silently turning `"a string"` or `null` into a fake "Cliente 2" with zero indication is exactly
// the "imported with errors" the founder ran into. So the import path validates the raw shape
// first and refuses the whole file rather than normalizing garbage into phantom records.
const IMPORTABLE_COLLECTIONS = ["clients", "projects", "products", "environments", "urlBindings", "testAccounts", "paymentMethods", "apis", "inspectors", "resources", "macros", "operatingSystems", "browsers", "devices", "accountTypes", "paymentMethodTypes"];
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
    // Once this profile's demo Toolbar/Sandbox/STAGE entities exist, they must survive an import
    // too -- even one from a teammate's export (or an older export from before this flag existed)
    // that has no idea they exist. Carrying the flag forward from the workspace being replaced
    // (not from the file) is what makes normalizeWorkspace's lock below unconditional on import.
    candidate.preferences = { ...(candidate.preferences || {}), demoWorkspaceSeeded: candidate.preferences?.demoWorkspaceSeeded === true || previousWorkspace.preferences?.demoWorkspaceSeeded === true };
    workspace = normalizeWorkspace(candidate);
    await persistWorkspace();
    document.getElementById("dataHint").textContent = t("Importado: {clients} cliente(s), {environments} ambiente(s). URLs e vínculos foram normalizados.", { clients: workspace.clients.length, environments: workspace.environments.length });
  } catch (error) { workspace = previousWorkspace; renderWorkspace(); document.getElementById("dataHint").textContent = t("Falha ao importar: {error}. O workspace anterior foi preservado.", { error: t(error.message) }); }
  event.target.value = "";
});
// Tutorial + FAQ (Part B). Maps each tutorial-data.js module key to an icon already in
// window.QTS_ICONS (extension's own icon set, not the LP's bootstrap-icons names) -- falls back
// to no icon for the couple of keys without a dedicated one (jsonStudio) rather than guessing wrong.
const TUTORIAL_ICON_BY_KEY = {
  workspace: "settings", testStatus: "checkSquare", passFail: "checkSquare", notesShapes: "square",
  screenshot: "camera", recording: "recordStart", clickSpy: "mouse", freezeClock: "freezeClock",
  forceHttp: "warning", errorMonitor: "errorMonitor", inspectors: "braces", breakpoints: "breakpointViewer",
  characterCounter: "characterCounter", multiClick: "multiClick", inputLab: "inputLab", fakerFill: "fakerFill",
  macroStudio: "macroStudio", stepsRecorder: "stepsRecorder", keyView: "keyView", elementCapture: "elementCapture", testAccounts: "key",
  paymentMethods: "paymentMethods", resources: "resources",
};
let tutorialProgress = { completedSteps: [], dismissedBannerAt: null };

function renderTutorialPanel() {
  const modules = window.QTS_TUTORIAL_DATA || [];
  const groupLabels = window.QTS_TUTORIAL_GROUPS || {};
  const total = modules.length;
  const done = modules.filter((module) => tutorialProgress.completedSteps.includes(module.key)).length;
  document.getElementById("tutorialProgressLabel").textContent = t("{done} de {total} concluídos", { done, total });
  document.getElementById("tutorialProgressFill").style.width = total ? `${Math.round((done / total) * 100)}%` : "0%";
  const moduleCard = (module) => {
    const isDone = tutorialProgress.completedSteps.includes(module.key);
    const locked = module.planFeature && accessState?.features?.[module.planFeature] !== true;
    const iconName = TUTORIAL_ICON_BY_KEY[module.key];
    return `
      <article class="tutorialModule${isDone ? " isDone" : ""}" data-tutorial-module="${escapeHtml(module.key)}">
        <button type="button" class="tutorialModuleMedia" data-tutorial-play="${escapeHtml(module.key)}" ${module.video ? "" : "disabled"}>
          <img src="${escapeHtml(module.screenshot)}" alt="${escapeHtml(t(module.title))}" loading="lazy" />
          ${module.video ? `<span class="tutorialPlayBadge">${ICON("play")}</span>` : ""}
        </button>
        <div class="tutorialModuleBody">
          <div class="tutorialModuleHead">
            <h3>${iconName ? ICON(iconName) : ""} ${escapeHtml(t(module.title))}</h3>
            ${locked ? `<span class="tutorialLockBadge">${ICON("lock")} ${escapeHtml(t("Recurso do plano"))}</span>` : ""}
          </div>
          <p class="tutorialModuleShort">${escapeHtml(t(module.short))}</p>
          <p class="tutorialModuleInstructions">${escapeHtml(t(module.instructions))}</p>
          <div class="actions">
            ${module.key !== "workspace" ? `<button type="button" class="button" data-tutorial-try="${escapeHtml(module.key)}">${ICON("play")} ${escapeHtml(t("Tentar"))}</button>` : ""}
            <button type="button" class="button${isDone ? "" : " primary"}" data-tutorial-complete="${escapeHtml(module.key)}">${isDone ? `${ICON("pass")} ${escapeHtml(t("Concluído"))}` : escapeHtml(t("Marcar como concluído"))}</button>
          </div>
        </div>
      </article>
    `;
  };
  const groups = [];
  for (const module of modules) {
    let group = groups.find((entry) => entry.key === module.group);
    if (!group) { group = { key: module.group, modules: [] }; groups.push(group); }
    group.modules.push(module);
  }
  document.getElementById("tutorialModules").innerHTML = groups.map((group) => {
    const groupDone = group.modules.filter((module) => tutorialProgress.completedSteps.includes(module.key)).length;
    return `
      <details class="environmentAccordion tutorialGroupAccordion" open>
        <summary><b>${escapeHtml(t(groupLabels[group.key] || group.key))}</b><span class="tutorialGroupCount">${groupDone}/${group.modules.length}</span></summary>
        <div class="list tutorialModules">${group.modules.map(moduleCard).join("")}</div>
      </details>
    `;
  }).join("");
  document.querySelectorAll("[data-tutorial-complete]").forEach((button) => {
    button.addEventListener("click", () => completeTutorialStep(button.dataset.tutorialComplete));
  });
  document.querySelectorAll("[data-tutorial-play]").forEach((button) => {
    button.addEventListener("click", () => openTutorialVideo(button.dataset.tutorialPlay));
  });
  document.querySelectorAll("[data-tutorial-try]").forEach((button) => {
    button.addEventListener("click", () => chrome.runtime.sendMessage({ type: "qts:start-tutorial-tour", stepKey: button.dataset.tutorialTry }));
  });
}

let currentTutorialVideoKey = null;
function openTutorialVideo(key) {
  const module = (window.QTS_TUTORIAL_DATA || []).find((item) => item.key === key);
  if (!module || !module.video) return;
  currentTutorialVideoKey = key;
  document.getElementById("tutorialVideoTitle").textContent = t(module.title);
  document.getElementById("tutorialVideoInstructions").textContent = t(module.instructions);
  const player = document.getElementById("tutorialVideoPlayer");
  player.src = module.video;
  const isDone = tutorialProgress.completedSteps.includes(key);
  const completeButton = document.getElementById("tutorialVideoComplete");
  completeButton.innerHTML = isDone ? `${ICON("pass")} ${escapeHtml(t("Concluído"))}` : escapeHtml(t("Marcar como concluído"));
  completeButton.disabled = isDone;
  document.getElementById("tutorialVideoDialog").showModal();
}
document.getElementById("tutorialVideoDialog").addEventListener("close", () => {
  const player = document.getElementById("tutorialVideoPlayer");
  player.pause();
  player.removeAttribute("src");
  player.load();
});
document.getElementById("tutorialVideoComplete").addEventListener("click", async () => {
  if (!currentTutorialVideoKey) return;
  document.getElementById("tutorialVideoDialog").close();
  await completeTutorialStep(currentTutorialVideoKey);
});
document.getElementById("tutorialVideoTry").addEventListener("click", () => {
  if (!currentTutorialVideoKey) return;
  document.getElementById("tutorialVideoDialog").close();
  chrome.runtime.sendMessage({ type: "qts:start-tutorial-tour", stepKey: currentTutorialVideoKey });
});

async function completeTutorialStep(key) {
  const module = (window.QTS_TUTORIAL_DATA || []).find((item) => item.key === key);
  if (!module || tutorialProgress.completedSteps.includes(key)) return;
  await window.QTS_STORAGE.saveTutorialCompletedStep(key);
  tutorialProgress = await window.QTS_STORAGE.getTutorialProgress();
  window.QTS_SOUND.playSound("achievement", workspace);
  renderTutorialPanel();
  const row = document.querySelector(`[data-tutorial-module="${key}"]`);
  if (row) { row.classList.add("justCompleted"); setTimeout(() => row.classList.remove("justCompleted"), 500); }
  showTutorialStepDoneModal(key);
}

let currentTutorialStepDoneKey = null;
function showTutorialStepDoneModal(key) {
  const module = (window.QTS_TUTORIAL_DATA || []).find((item) => item.key === key);
  if (!module) return;
  currentTutorialStepDoneKey = key;
  document.getElementById("tutorialStepDoneTitle").textContent = `${t(module.title)} ${t("concluído!")}`;
  document.getElementById("tutorialStepDoneBody").textContent = module.tip ? `${t(module.short)} ${t("Dica")}: ${t(module.tip)}` : t(module.short);
  document.getElementById("tutorialStepDoneDialog").showModal();
}
document.getElementById("tutorialStepRepeat").addEventListener("click", () => {
  document.getElementById("tutorialStepDoneDialog").close();
  if (currentTutorialStepDoneKey) openTutorialVideo(currentTutorialStepDoneKey);
});
document.getElementById("tutorialStepNext").addEventListener("click", () => {
  document.getElementById("tutorialStepDoneDialog").close();
  const modules = window.QTS_TUTORIAL_DATA || [];
  const index = modules.findIndex((item) => item.key === currentTutorialStepDoneKey);
  const next = index >= 0 ? modules[index + 1] : null;
  if (next?.video) openTutorialVideo(next.key);
});
document.getElementById("tutorialStepClose").addEventListener("click", () => document.getElementById("tutorialStepDoneDialog").close());

function renderFaqPanel() {
  const general = window.QTS_FAQ_DATA?.general || [];
  const modules = (window.QTS_TUTORIAL_DATA || []).filter((module) => module.key !== "workspace");
  const groupLabels = window.QTS_TUTORIAL_GROUPS || {};
  const generalHtml = general.map((item) => `
    <details class="environmentAccordion faqAccordion"><summary><b>${escapeHtml(t(item.question))}</b></summary><div class="list"><p>${escapeHtml(t(item.answer))}</p></div></details>
  `).join("");
  const groups = [];
  for (const module of modules) {
    let group = groups.find((entry) => entry.key === module.group);
    if (!group) { group = { key: module.group, modules: [] }; groups.push(group); }
    group.modules.push(module);
  }
  const toolGroupsHtml = groups.map((group) => `
    <details class="environmentAccordion faqGroupAccordion" open>
      <summary><b>${escapeHtml(t(groupLabels[group.key] || group.key))}</b></summary>
      <div class="list">${group.modules.map((module) => `
        <details class="environmentAccordion faqAccordion"><summary><b>${escapeHtml(t("Para que serve {tool}?", { tool: t(module.title) }))}</b></summary><div class="list faqAnswer">${module.screenshot ? `<img src="${escapeHtml(module.screenshot)}" alt="${escapeHtml(t(module.title))}" loading="lazy" />` : ""}<p>${escapeHtml(t(module.short))} ${escapeHtml(t(module.instructions))}</p>${module.example ? `<p class="faqExample">${escapeHtml(t(module.example))}</p>` : ""}</div></details>
      `).join("")}</div>
    </details>
  `).join("");
  document.getElementById("faqAccordions").innerHTML = `
    <details class="environmentAccordion faqGroupAccordion" open><summary><b>${escapeHtml(t("Geral"))}</b></summary><div class="list">${generalHtml}</div></details>
    ${toolGroupsHtml}
  `;
  document.querySelectorAll(".faqAnswer img").forEach((img) => {
    img.addEventListener("click", () => openImageLightbox(img.src, img.alt));
  });
}

function openImageLightbox(src, alt) {
  document.getElementById("imageLightboxImg").src = src;
  document.getElementById("imageLightboxImg").alt = alt || "";
  document.getElementById("imageLightbox").hidden = false;
}
function closeImageLightbox() {
  document.getElementById("imageLightbox").hidden = true;
  document.getElementById("imageLightboxImg").src = "";
}
document.getElementById("imageLightbox").addEventListener("click", (event) => {
  if (event.target === event.currentTarget) closeImageLightbox();
});
document.getElementById("imageLightboxClose").addEventListener("click", closeImageLightbox);

function renderTutorialBanner() {
  document.getElementById("tutorialBanner").hidden = !accessState?.active || !!tutorialProgress.dismissedBannerAt;
}

document.getElementById("tutorialStartTour").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "qts:start-tutorial-tour" });
});

// Full settings onboarding. Each step can select a top-level panel and a Workspace subtab before
// highlighting the exact control the user will operate. The tour explains the real CRUD without
// creating sample records or changing the user's data.
const SETTINGS_TOUR_STEPS = [
  { tab: "account", selector: '.navItem[data-tab="account"]', title: "Minha conta", text: "Consulte seu acesso, plano e vouchers. Seus cadastros continuam locais no navegador." },
  { tab: "general", selector: "#appearanceThemeToggle", title: "Tema claro ou escuro", text: "Escolha Sol para o tema claro ou Lua para o escuro. A preferência é salva e também altera a toolbar." },
  { tab: "general", selector: "#barPreview", title: "Aparência da barra", text: "Use a prévia para conferir breadcrumb, imagens, modo compacto, formato e itens visíveis antes de salvar." },
  { tab: "general", selector: "#toolsMenuOrderList", title: "Ferramentas e ordem", text: "Escolha as ferramentas disponíveis e organize a ordem do menu Tools. Termine usando Salvar, no rodapé fixo." },
  { tab: "workspace", workspaceTab: "structure", selector: '[data-open-composer="clientComposer"]', title: "1. Criar cliente", text: "Clique em Adicionar cliente, informe nome e imagem opcional e salve. O cliente é o primeiro nível da estrutura." },
  { tab: "workspace", workspaceTab: "structure", selector: '[data-structure-view="project"]', title: "2. Criar projeto", text: "Expanda o cliente pai e clique em Adicionar projeto dentro dele. O cliente já fica selecionado no formulário." },
  { tab: "workspace", workspaceTab: "structure", selector: '[data-structure-view="product"]', title: "3. Criar produto", text: "Expanda o projeto pai e clique em Adicionar produto dentro dele. A hierarquia preserva o contexto correto." },
  { tab: "workspace", workspaceTab: "environments", selector: '[data-open-composer="environmentComposer"]', title: "4. Criar ambiente", text: "Cadastre DEV, QA, Beta ou Produção com nome e cor. Um ambiente pode ser reutilizado nas URLs." },
  { tab: "workspace", workspaceTab: "urls", selector: "[data-add-url-for-environment]", title: "5. Vincular URL", text: "Expanda o ambiente e adicione a URL no próprio contexto. Depois escolha o produto. Essa associação determina em quais páginas a toolbar aparece." },
  { tab: "workspace", workspaceTab: "accounts", selector: '[data-open-composer="testAccountComposer"]', title: "Contas de teste", text: "Adicione apenas credenciais sandbox, defina o escopo e salve. Valores sensíveis são mascarados e não entram na exportação." },
  { tab: "workspace", workspaceTab: "payments", selector: '[data-open-composer="paymentMethodComposer"]', title: "Meios de pagamento", text: "Cadastre cartões e métodos exclusivamente sandbox. Número, valor sensível e CVV recebem proteção especial." },
  { tab: "workspace", workspaceTab: "devices", selector: '[data-open-composer="deviceComposer"]', title: "Dispositivos", text: "Cadastre um dispositivo e marque quantos sistemas e navegadores quiser - útil para anexar ao reportar um bug." },
  { tab: "workspace", workspaceTab: "integrations", selector: '[data-open-composer="inspectorComposer"]', title: "Configurar Inspectors", text: "Adicione regras para reconhecer respostas de rede pelo nome, método ou URL. O monitor usa essas regras na página testada." },
  { tab: "workspace", workspaceTab: "integrations", selector: '[data-open-composer="apiComposer"]', title: "Cadastrar APIs", text: "Registre endpoints úteis do projeto para consulta rápida, sem executar JavaScript fornecido pelo usuário." },
  { tab: "workspace", workspaceTab: "integrations", selector: '[data-open-composer="resourceComposer"]', title: "Integrações, recursos e links", text: "Adicione documentação, dashboards e links da equipe. Ao salvar, o novo recurso fica disponível imediatamente na sidebar." },
  { tab: "data", selector: "#exportButton", title: "Exportar backup seguro", text: "Exporte o workspace em JSON com checksum. Segredos e valores sensíveis não são incluídos no arquivo." },
  { tab: "data", selector: "#importButton", title: "Importar e restaurar", text: "Importe um JSON válido ou baixe o template. A extensão valida e normaliza os vínculos antes de substituir os dados atuais." },
  { tab: "tutorial", selector: "#tutorialStartSettingsTour", title: "Tutorial sempre disponível", text: "Volte aqui quando quiser rever vídeos, acompanhar o progresso ou reiniciar este tour das Configurações." },
  { tab: "faq", selector: "#faqExpandAll", title: "FAQ e suporte", text: "Consulte respostas sobre Workspace, aparência, Inspectors, backup e cada ferramenta. Use Expandir tudo para pesquisar visualmente." },
];
let settingsTourIndex = -1;
let settingsTourTrustedHandoff = false;
function settingsTourHost() {
  let host = document.getElementById("settingsTourOverlay");
  if (!host) {
    host = document.createElement("div");
    host.id = "settingsTourOverlay";
    document.body.appendChild(host);
  }
  return host;
}
function startSettingsTour() {
  if (!accessState?.active && !settingsTourTrustedHandoff) return;
  settingsTourIndex = 0;
  renderSettingsTourStep();
}
function renderSettingsTourStep() {
  const step = SETTINGS_TOUR_STEPS[settingsTourIndex];
  const host = settingsTourHost();
  if (!step) { endSettingsTour(); return; }
  switchTab(step.tab, { allowInactive: settingsTourTrustedHandoff });
  if (step.workspaceTab) activateWorkspaceTab(step.workspaceTab, { syncNavigation: true });
  const target = document.querySelector(step.selector || `.navItem[data-tab="${step.tab}"]`);
  if (!target) { settingsTourIndex += 1; renderSettingsTourStep(); return; }
  target.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
  const rect = target.getBoundingClientRect();
  const pad = 5;
  const isLast = settingsTourIndex >= SETTINGS_TOUR_STEPS.length - 1;
  const balloonLeft = rect.right + 332 <= window.innerWidth ? rect.right + 16 : Math.max(12, rect.left - 316);
  const balloonTop = Math.min(Math.max(12, rect.top), Math.max(12, window.innerHeight - 260));
  host.innerHTML = `
    <div class="settingsTourSpotlight" style="top:${rect.top - pad}px;left:${rect.left - pad}px;width:${rect.width + pad * 2}px;height:${rect.height + pad * 2}px"></div>
    <div class="settingsTourBalloon" style="top:${balloonTop}px;left:${balloonLeft}px">
      <span class="settingsTourStepLabel">${t("Passo {current} de {total}", { current: settingsTourIndex + 1, total: SETTINGS_TOUR_STEPS.length })}</span>
      <b>${escapeHtml(t(step.title))}</b>
      <p>${escapeHtml(t(step.text))}</p>
      <div class="settingsTourActions">
        <button type="button" class="button" id="settingsTourSkip">${escapeHtml(t("Pular tutorial"))}</button>
        <button type="button" class="button primary" id="settingsTourNext">${isLast ? escapeHtml(t("Concluir")) : escapeHtml(t("Próximo"))}</button>
      </div>
    </div>
  `;
  document.getElementById("settingsTourSkip").addEventListener("click", endSettingsTour);
  document.getElementById("settingsTourNext").addEventListener("click", () => { settingsTourIndex += 1; renderSettingsTourStep(); });
}
function endSettingsTour() {
  settingsTourIndex = -1;
  document.getElementById("settingsTourOverlay")?.remove();
}
window.addEventListener("resize", () => { if (settingsTourIndex >= 0) renderSettingsTourStep(); });
document.getElementById("settingsTourStart").addEventListener("click", startSettingsTour);
document.getElementById("tutorialStartSettingsTour").addEventListener("click", startSettingsTour);
document.getElementById("tutorialSkipAll").addEventListener("click", async () => {
  const modules = window.QTS_TUTORIAL_DATA || [];
  for (const module of modules) {
    if (!tutorialProgress.completedSteps.includes(module.key)) await window.QTS_STORAGE.saveTutorialCompletedStep(module.key);
  }
  tutorialProgress = await window.QTS_STORAGE.getTutorialProgress();
  renderTutorialPanel();
});
document.getElementById("tutorialReset").addEventListener("click", async () => {
  if (!(await confirmDialog(t("Reiniciar o progresso do tutorial? Nenhum dado do seu workspace é afetado.")))) return;
  const current = await chrome.storage.local.get(STORAGE_KEYS.uiState);
  const uiState = current[STORAGE_KEYS.uiState] || {};
  await chrome.storage.local.set({ [STORAGE_KEYS.uiState]: { ...uiState, tutorial: { ...(uiState.tutorial || {}), completedSteps: [] } } });
  tutorialProgress = await window.QTS_STORAGE.getTutorialProgress();
  renderTutorialPanel();
});
document.getElementById("tutorialBannerOpen").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "qts:start-tutorial-tour" });
});
document.getElementById("tutorialBannerDismiss").addEventListener("click", async () => {
  await window.QTS_STORAGE.saveTutorialBannerDismissed();
  tutorialProgress = await window.QTS_STORAGE.getTutorialProgress();
  renderTutorialBanner();
});
document.getElementById("faqExpandAll").addEventListener("click", () => document.querySelectorAll(".faqAccordion, .faqGroupAccordion").forEach((details) => { details.open = true; }));
document.getElementById("faqCollapseAll").addEventListener("click", () => document.querySelectorAll(".faqAccordion").forEach((details) => { details.open = false; }));

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

async function showPendingReleaseNotes() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.uiState);
  const note = stored[STORAGE_KEYS.uiState]?.pendingReleaseNote;
  if (!note) return;
  const texts = currentLocale.startsWith("en")
    ? { title: `Updated to version ${note.version}`, intro: "Your previous data and settings were preserved.", done: "Got it", items: ["The device used now follows steps, reports, and the test session summary", "Sidebar forms reuse types, relationships, and images from Settings", "Catalog images are larger and easier to identify", "Maximize now sits next to close in sidebar headers", "Forms include discreet, accessible help in English"] }
    : currentLocale.startsWith("es")
      ? { title: `Actualizado a la versión ${note.version}`, intro: "Tus datos y configuraciones se conservaron.", done: "Entendido", items: ["El dispositivo utilizado ahora acompaña los pasos, informes y el resumen de la sesión", "Los formularios de los paneles laterales reutilizan tipos, relaciones e imágenes de Settings", "Las imágenes de los catálogos son más grandes y legibles", "Maximizar ahora está al lado de cerrar en los paneles laterales", "Los formularios tienen ayudas discretas y accesibles en español"] }
      : { title: `Atualizado para a versão ${note.version}`, intro: "Seus dados e configurações anteriores foram preservados.", done: "Entendi", items: ["O dispositivo usado agora acompanha passos, relatórios e o resumo da sessão", "Formulários dos sidebars reutilizam tipos, relações e imagens dos Settings", "Imagens dos catálogos estão maiores e mais fáceis de identificar", "Maximizar agora fica ao lado de fechar nos sidebars", "Formulários receberam ajudas discretas e acessíveis em português"] };
  const dialog = document.createElement("dialog");
  dialog.className = "composerDialog";
  dialog.innerHTML = `<div class="dialogHead"><h2>${escapeHtml(texts.title)}</h2></div><div class="dialogBody"><p>${escapeHtml(texts.intro)}</p><ul>${texts.items.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div><div class="dialogActions"><button class="primary" type="button">${escapeHtml(texts.done)}</button></div>`;
  document.body.appendChild(dialog);
  dialog.querySelector("button").addEventListener("click", async () => {
    const current = await chrome.storage.local.get(STORAGE_KEYS.uiState); const uiState = { ...(current[STORAGE_KEYS.uiState] || {}) };
    delete uiState.pendingReleaseNote; uiState.lastSeenReleaseVersion = note.version;
    await chrome.storage.local.set({ [STORAGE_KEYS.uiState]: uiState }); await chrome.action.setBadgeText({ text: "" });
    dialog.close(); dialog.remove();
  });
  dialog.showModal();
}

document.getElementById("resetButton").addEventListener("click", async () => {
  if (!(await confirmDialog(t("Apagar somente o workspace local? Sua conta e assinatura não serão removidas.")))) return;
  workspace = window.QTS_STORAGE.createEmptyWorkspace(); await persistWorkspace(); document.getElementById("dataHint").textContent = t("Workspace local resetado.");
});

(async () => {
  const launchParams = new URLSearchParams(window.location.search);
  settingsTourTrustedHandoff = launchParams.get("settingsTour") === "1";
  await loadLocale();
  workspace = await getWorkspace();
  tutorialProgress = await window.QTS_STORAGE.getTutorialProgress();
  await loadScopeUi();
  renderWorkspace();
  renderFaqPanel();
  // Opening Settings must use the access state already validated by the background worker. A
  // forced network refresh here can transiently demote an authenticated user and break deep links
  // (including the Workspace settings-tour handoff). The explicit refresh button still forces it.
  let activeOnLaunch = await loadAccess(false);
  // A settings-tour handoff can arrive just after the service worker restarted, before its access
  // cache was restored. Retry once against the backend instead of silently abandoning the tour.
  if (!activeOnLaunch && launchParams.get("settingsTour") === "1") activeOnLaunch = await loadAccess(true);
  await showPendingReleaseNotes();
  void loadLegalStatus();
  const requestedTab = launchParams.get("tab");
  if (requestedTab) {
    switchTab(requestedTab, { allowInactive: settingsTourTrustedHandoff });
  }
  if (launchParams.get("settingsTour") === "1") {
    startSettingsTour();
    // Keep the handoff deterministic even if an access refresh briefly selected My account while
    // this async initializer was running. Backend authorization remains enforced independently.
    switchTab("workspace", { allowInactive: true });
    activateWorkspaceTab("structure", { syncNavigation: true });
  }
  if (requestedTab || launchParams.has("settingsTour")) window.history.replaceState({}, "", window.location.pathname);
  onStorageChanged(async (changes) => {
    if (!changes[STORAGE_KEYS.workspace]) return;
    workspace = await getWorkspace();
    renderWorkspace();
  });
})();
