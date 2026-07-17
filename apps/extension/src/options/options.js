const { getWorkspace, saveWorkspace, getSiteScope, saveSiteScope } = window.QTS_STORAGE;

let t = null;

function applyStaticTranslations() {
  document.title = t.optionsTitle;
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t[el.dataset.i18n] ?? el.textContent;
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.setAttribute("placeholder", t[el.dataset.i18nPlaceholder] ?? el.getAttribute("placeholder"));
  });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.setAttribute("title", t[el.dataset.i18nTitle] ?? el.getAttribute("title"));
  });
  document.querySelectorAll("#langSwitch button").forEach((button) => {
    button.classList.toggle("isActive", button.dataset.locale === currentLocale);
  });
}

let currentLocale = "pt-BR";

async function loadLocale() {
  currentLocale = await window.QTS_I18N.getLocale();
  t = (await window.QTS_I18N.load());
  applyStaticTranslations();
}

document.querySelectorAll("#langSwitch button").forEach((button) => {
  button.addEventListener("click", async () => {
    await window.QTS_I18N.setLocale(button.dataset.locale);
    await loadLocale();
    renderWorkspace();
  });
});

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
  hint.textContent = t.optionsScopeSaved;
  window.setTimeout(() => { hint.textContent = ""; }, 3000);
});

// ---------- Workspace ----------
let workspace = null;

function renderList(listElementId, items, formatter) {
  const el = document.getElementById(listElementId);
  if (!items.length) {
    el.innerHTML = `<div class="listEmpty">${escapeHtml(t.optionsNothingYet)}</div>`;
    return;
  }
  el.innerHTML = items.map((item) => `
    <div class="listRow" data-id="${escapeHtml(item.id)}">
      <div>${formatter(item)}</div>
      <button type="button" data-remove="${escapeHtml(item.id)}">${escapeHtml(t.remove)}</button>
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

const revealedAccountIds = new Set();

function environmentDisplayName(environment) {
  const product = workspace.products.find((p) => p.id === environment.productId);
  return product ? `${product.name} · ${environment.name}` : environment.name;
}

function renderTestAccounts() {
  const accounts = workspace.testAccounts || [];
  document.getElementById("testAccountCount").textContent = String(accounts.length);
  const el = document.getElementById("testAccountList");
  if (!accounts.length) {
    el.innerHTML = `<div class="listEmpty">${escapeHtml(t.optionsNothingYet)}</div>`;
    return;
  }
  el.innerHTML = accounts.map((account) => {
    const environment = workspace.environments.find((e) => e.id === account.environmentId);
    const revealed = revealedAccountIds.has(account.id);
    const passwordDisplay = account.password ? (revealed ? escapeHtml(account.password) : "•".repeat(Math.min(10, account.password.length))) : "—";
    return `
      <div class="listRow" data-id="${escapeHtml(account.id)}">
        <div>
          <b>${escapeHtml(account.label)}${account.accountType ? ` <span class="accountType">${escapeHtml(account.accountType)}</span>` : ""}</b>
          <small>${escapeHtml(environment ? environmentDisplayName(environment) : "—")} · ${escapeHtml(account.username || "—")} · ${passwordDisplay}</small>
        </div>
        <div class="rowActions">
          ${account.username ? `<button type="button" data-copy-username="${escapeHtml(account.id)}" title="${escapeHtml(t.optionsCopyUsername)}">⧉</button>` : ""}
          ${account.password ? `<button type="button" data-reveal="${escapeHtml(account.id)}" title="${escapeHtml(revealed ? t.optionsHidePassword : t.optionsRevealPassword)}">${revealed ? "🙈" : "👁"}</button>` : ""}
          <button type="button" data-remove="${escapeHtml(account.id)}">${escapeHtml(t.remove)}</button>
        </div>
      </div>
    `;
  }).join("");
}

function renderWorkspace() {
  workspace.testAccounts = workspace.testAccounts || [];

  document.getElementById("clientCount").textContent = String(workspace.clients.length);
  document.getElementById("projectCount").textContent = String(workspace.projects.length);
  document.getElementById("productCount").textContent = String(workspace.products.length);
  document.getElementById("environmentCount").textContent = String(workspace.environments.length);

  const badge = (entity) => window.QTS_AVATAR.buildEntityHtml(entity, { size: 22 });

  renderList("clientList", workspace.clients, (client) => `<b>${badge(client)}</b>`);
  renderList("projectList", workspace.projects, (project) => {
    const client = workspace.clients.find((c) => c.id === project.clientId);
    return `<b>${badge(project)}</b><small>${escapeHtml(client?.name || "—")}</small>`;
  });
  renderList("productList", workspace.products, (product) => {
    const project = workspace.projects.find((p) => p.id === product.projectId);
    return `<b>${badge(product)}</b><small>${escapeHtml(project?.name || "—")}</small>`;
  });
  renderList("environmentList", workspace.environments, (environment) => {
    const product = workspace.products.find((p) => p.id === environment.productId);
    return `<b style="color:${escapeHtml(environment.color)}">● ${escapeHtml(environment.name)}</b><small>${escapeHtml(product?.name || "—")} · ${escapeHtml((environment.urlPatterns || []).join(", "))}</small>`;
  });
  renderTestAccounts();

  renderSelect("projectClient", workspace.clients, t.optionsSelectClient);
  renderSelect("productProject", workspace.projects, t.optionsSelectProject);
  renderSelect("environmentProduct", workspace.products, t.optionsSelectProduct);
  renderSelect(
    "testAccountEnvironment",
    workspace.environments.map((environment) => ({ id: environment.id, name: environmentDisplayName(environment) })),
    t.optionsSelectEnvironment,
  );
}

async function persistWorkspace() {
  workspace = await saveWorkspace(workspace);
  renderWorkspace();
}

document.addEventListener("click", async (event) => {
  const revealId = event.target?.dataset?.reveal;
  if (revealId) {
    if (revealedAccountIds.has(revealId)) revealedAccountIds.delete(revealId);
    else revealedAccountIds.add(revealId);
    renderTestAccounts();
    return;
  }

  const copyId = event.target?.dataset?.copyUsername;
  if (copyId) {
    const account = (workspace.testAccounts || []).find((item) => item.id === copyId);
    if (account?.username) {
      await navigator.clipboard.writeText(account.username).catch(() => {});
      const original = event.target.textContent;
      event.target.textContent = "✓";
      window.setTimeout(() => { event.target.textContent = original; }, 1200);
    }
    return;
  }

  const removeId = event.target?.dataset?.remove;
  if (!removeId) return;
  const row = event.target.closest(".listRow");
  const listId = row?.parentElement?.id;
  const collectionByList = { clientList: "clients", projectList: "projects", productList: "products", environmentList: "environments", testAccountList: "testAccounts" };
  const collectionKey = collectionByList[listId];
  if (!collectionKey) return;
  workspace[collectionKey] = workspace[collectionKey].filter((item) => item.id !== removeId);
  await persistWorkspace();
});

function readAppearanceFields(prefix) {
  const logoUrl = document.getElementById(`${prefix}LogoUrl`).value.trim();
  const abbreviation = document.getElementById(`${prefix}Abbreviation`).value.trim();
  const showLabel = document.getElementById(`${prefix}ShowLabel`).checked;
  return {
    ...(logoUrl ? { logoUrl } : {}),
    ...(abbreviation ? { abbreviation } : {}),
    showLabel,
  };
}

function clearAppearanceFields(prefix) {
  document.getElementById(`${prefix}LogoUrl`).value = "";
  document.getElementById(`${prefix}Abbreviation`).value = "";
  document.getElementById(`${prefix}ShowLabel`).checked = true;
}

document.getElementById("clientForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = document.getElementById("clientName").value.trim();
  if (!name) return;
  workspace.clients.push({ id: uid("client"), name, ...readAppearanceFields("client") });
  document.getElementById("clientName").value = "";
  clearAppearanceFields("client");
  await persistWorkspace();
});

document.getElementById("projectForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const clientId = document.getElementById("projectClient").value;
  const name = document.getElementById("projectName").value.trim();
  if (!clientId || !name) return;
  workspace.projects.push({ id: uid("project"), clientId, name, ...readAppearanceFields("project") });
  document.getElementById("projectName").value = "";
  clearAppearanceFields("project");
  await persistWorkspace();
});

document.getElementById("productForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const projectId = document.getElementById("productProject").value;
  const name = document.getElementById("productName").value.trim();
  if (!projectId || !name) return;
  workspace.products.push({ id: uid("product"), projectId, name, ...readAppearanceFields("product") });
  document.getElementById("productName").value = "";
  clearAppearanceFields("product");
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

document.getElementById("testAccountForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const environmentId = document.getElementById("testAccountEnvironment").value;
  const label = document.getElementById("testAccountLabel").value.trim();
  if (!environmentId || !label) return;
  const accountType = document.getElementById("testAccountType").value.trim();
  const username = document.getElementById("testAccountUsername").value.trim();
  const password = document.getElementById("testAccountPassword").value;
  const notes = document.getElementById("testAccountNotes").value.trim();
  workspace.testAccounts = workspace.testAccounts || [];
  workspace.testAccounts.push({
    id: uid("account"),
    environmentId,
    label,
    ...(accountType ? { accountType } : {}),
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
    ...(notes ? { notes } : {}),
  });
  event.target.reset();
  await persistWorkspace();
});

// ---------- Import / export / reset ----------
// Passwords never leave this browser: they're stripped from the exported JSON,
// matching the same sandbox-only handling used for payment data.
document.getElementById("exportButton").addEventListener("click", () => {
  const exportable = {
    ...workspace,
    testAccounts: (workspace.testAccounts || []).map(({ password, ...rest }) => rest),
  };
  const blob = new Blob([JSON.stringify(exportable, null, 2)], { type: "application/json" });
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
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.clients)) throw new Error(t.optionsImportInvalidFormat);
    workspace = { ...window.QTS_STORAGE.createEmptyWorkspace(), ...parsed };
    await persistWorkspace();
    hint.textContent = t.optionsImportSuccess;
  } catch (error) {
    hint.textContent = `${t.optionsImportFailurePrefix}: ${error.message}`;
  }
  event.target.value = "";
});

document.getElementById("resetButton").addEventListener("click", async () => {
  if (!window.confirm(t.optionsResetConfirm)) return;
  workspace = window.QTS_STORAGE.createEmptyWorkspace();
  await persistWorkspace();
  document.getElementById("dataHint").textContent = t.optionsResetDone;
});

// ---------- Boot ----------
(async () => {
  await loadLocale();
  await loadScopeUi();
  workspace = await getWorkspace();
  renderWorkspace();
})();
