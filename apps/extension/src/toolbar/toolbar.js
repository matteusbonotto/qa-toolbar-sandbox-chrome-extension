const { getWorkspace, onStorageChanged, STORAGE_KEYS } = window.QTS_STORAGE;

const TOOLBAR_HEIGHT = 34;
const HOST_ID = "qts-toolbar-host";
const SPACER_ID = "qts-toolbar-spacer";

const state = {
  workspace: null,
  environment: null,
  minimized: false,
  shadowRoot: null,
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function wildcardToRegExp(pattern) {
  const escaped = String(pattern || "")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

function matchesAnyPattern(patterns, href) {
  if (!Array.isArray(patterns) || !patterns.length) return false;
  return patterns.some((pattern) => {
    try {
      return wildcardToRegExp(pattern).test(href);
    } catch {
      return false;
    }
  });
}

function findActiveEnvironment(workspace) {
  const href = window.location.href;
  return (workspace.environments || []).find((environment) => matchesAnyPattern(environment.urlPatterns, href)) ?? null;
}

function findById(collection, id) {
  return (collection || []).find((item) => item.id === id) ?? null;
}

function contrastTextColor(hexColor) {
  const hex = String(hexColor || "").replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(hex)) return "#ffffff";
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#111111" : "#ffffff";
}

function getCurrentHeight() {
  return state.minimized ? 0 : TOOLBAR_HEIGHT;
}

function setSpacerHeight() {
  document.documentElement.style.setProperty("--qts-toolbar-height", `${getCurrentHeight()}px`);
}

function buildBreadcrumb(workspace, environment) {
  if (!environment) {
    return { label: "Nenhum ambiente configurado para esta URL", color: "#3a3a3a", text: "#ffffff" };
  }
  const client = findById(workspace.clients, environment.clientId);
  const project = findById(workspace.projects, environment.projectId);
  const product = findById(workspace.products, environment.productId);
  const parts = [client?.name, project?.name, product?.name].filter(Boolean);
  const color = environment.color || "#ef3340";
  return {
    label: parts.length ? `${parts.join(" · ")} — ${environment.name}` : environment.name,
    color,
    text: contrastTextColor(color),
  };
}

function render() {
  const root = state.shadowRoot;
  if (!root) return;

  const breadcrumb = buildBreadcrumb(state.workspace, state.environment);
  const bar = root.getElementById("bar");
  bar.style.setProperty("--qts-bg", breadcrumb.color);
  bar.style.setProperty("--qts-text", breadcrumb.text);
  bar.classList.toggle("isMinimized", state.minimized);

  root.getElementById("breadcrumb").textContent = breadcrumb.label;
  root.getElementById("restoreButton").classList.toggle("isVisible", state.minimized);

  setSpacerHeight();
}

function buildShadowHost() {
  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.all = "initial";
  const shadow = host.attachShadow({ mode: "open" });

  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; }
      #bar {
        position: fixed; top: 0; left: 0; right: 0; z-index: 2147483647;
        height: ${TOOLBAR_HEIGHT}px; display: flex; align-items: center; justify-content: space-between;
        gap: 10px; padding: 0 12px; background: var(--qts-bg, #ef3340); color: var(--qts-text, #fff);
        font: 700 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        box-shadow: 0 2px 10px rgba(0,0,0,.25); transition: transform 160ms ease;
      }
      #bar.isMinimized { transform: translateY(-110%); }
      #left, #right { display: flex; align-items: center; gap: 8px; min-width: 0; }
      #breadcrumb { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 46vw; }
      button {
        all: unset; box-sizing: border-box; cursor: pointer; height: 24px; padding: 0 10px;
        display: inline-flex; align-items: center; gap: 6px; border-radius: 7px;
        background: rgba(0,0,0,.2); color: inherit; font: inherit; font-weight: 800;
        border: 1px solid rgba(255,255,255,.35);
      }
      button:hover { background: rgba(0,0,0,.32); }
      #restoreButton {
        all: unset; box-sizing: border-box; position: fixed; top: 6px; right: 8px; z-index: 2147483647;
        width: 30px; height: 26px; display: none; align-items: center; justify-content: center;
        border: 1px solid rgba(255,215,0,.55); border-radius: 9px; background: #0b0b0b; color: #ffd700;
        font: 900 13px sans-serif; cursor: pointer; box-shadow: 0 8px 18px rgba(0,0,0,.34);
      }
      #restoreButton.isVisible { display: inline-flex; }
      .brand { opacity: .85; font-weight: 900; letter-spacing: .04em; }
    </style>
    <div id="bar" role="toolbar" aria-label="QA Toolbar Sandbox">
      <div id="left">
        <span class="brand">QA Sandbox</span>
        <span id="breadcrumb"></span>
      </div>
      <div id="right">
        <button id="settingsButton" type="button" title="Configurações">⚙ Configurações</button>
        <button id="minimizeButton" type="button" title="Minimizar">▲</button>
      </div>
    </div>
    <button id="restoreButton" type="button" title="Mostrar QA Toolbar Sandbox">▼</button>
  `;

  shadow.getElementById("settingsButton").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "qts:open-options" });
  });
  shadow.getElementById("minimizeButton").addEventListener("click", () => setMinimized(true));
  shadow.getElementById("restoreButton").addEventListener("click", () => setMinimized(false));

  return { host, shadow };
}

function setMinimized(value) {
  state.minimized = value;
  render();
}

function isToolbarHealthy() {
  const host = document.documentElement.querySelector(`#${HOST_ID}`);
  const spacer = document.body?.querySelector(`#${SPACER_ID}`);
  return Boolean(host?.isConnected && host.shadowRoot?.getElementById("bar") && (!document.body || spacer?.isConnected));
}

function mountToolbar() {
  const { host, shadow } = buildShadowHost();
  state.shadowRoot = shadow;
  document.documentElement.appendChild(host);

  const spacer = document.createElement("div");
  spacer.id = SPACER_ID;
  if (document.body) document.body.insertBefore(spacer, document.body.firstChild);

  render();
}

function scheduleRepair() {
  if (scheduleRepair.timer) return;
  scheduleRepair.timer = window.setTimeout(() => {
    scheduleRepair.timer = null;
    if (!isToolbarHealthy()) mountToolbar();
  }, 80);
}

function installIntegrityMonitor() {
  const observer = new MutationObserver((mutations) => {
    const relevant = mutations.some((mutation) =>
      [...mutation.removedNodes].some((node) => node.nodeType === 1 && (node.id === HOST_ID || node.id === SPACER_ID)),
    );
    if (relevant || !isToolbarHealthy()) scheduleRepair();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.setInterval(() => {
    if (!isToolbarHealthy()) scheduleRepair();
  }, 1500);
}

async function boot() {
  if (!document.body) {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
    return;
  }

  state.workspace = await getWorkspace();
  state.environment = findActiveEnvironment(state.workspace);

  mountToolbar();
  installIntegrityMonitor();

  onStorageChanged(async (changes) => {
    if (!changes[STORAGE_KEYS.workspace]) return;
    state.workspace = await getWorkspace();
    state.environment = findActiveEnvironment(state.workspace);
    render();
  });
}

void boot();
