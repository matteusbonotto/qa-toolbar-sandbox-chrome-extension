const { getWorkspace, saveWorkspace } = window.QTS_STORAGE;
const el = Object.fromEntries([...document.querySelectorAll("[id]")].map((node) => [node.id, node]));
let workspace;
let sourceUrl;
let sourceTabId;
const opt = (value, text) => Object.assign(document.createElement("option"), { value, textContent: text });
const value = (id) => el[id]?.value || "";
const fill = (select, items, placeholder) => {
  select.replaceChildren(opt("", placeholder), ...items.map((item) => opt(item.id, item.name)));
  if (items.length === 1) select.value = items[0].id;
};
const safeUrl = () => {
  const url = new URL(sourceUrl);
  if (!el.keepSensitive.checked) { url.search = ""; url.hash = ""; }
  return url;
};
const patternFor = () => {
  const url = safeUrl();
  const mode = document.querySelector('input[name="mode"]:checked')?.value;
  if (mode === "domain") return `${url.origin}/*`;
  if (mode === "exact") return url.href;
  return url.href.endsWith("/") ? `${url.href}*` : `${url.href}*`;
};
function preview() {
  const url = safeUrl();
  el.patternPreview.textContent = patternFor();
  el.displayPreview.textContent = el.displayMode.value === "relative" ? `${url.pathname || "/"}${url.search}${url.hash}` : url.href;
}
function environments() {
  const productId = value("product");
  const related = new Set(workspace.urlBindings.filter((binding) => binding.productId === productId).flatMap((binding) => binding.environmentIds || []));
  const items = workspace.environments.filter((item) => item.active !== false);
  el.environments.replaceChildren(...items.map((item) => {
    const label = document.createElement("label");
    const input = Object.assign(document.createElement("input"), { type: "checkbox", name: "environment", value: item.id, checked: items.length === 1 || related.has(item.id) });
    label.append(input, document.createTextNode(item.name));
    return label;
  }));
}
function products() {
  const items = workspace.products.filter((item) => item.active !== false && item.projectId === value("project"));
  fill(el.product, items, "Selecione o produto"); environments();
}
function projects() {
  const items = workspace.projects.filter((item) => item.active !== false && item.clientId === value("client"));
  fill(el.project, items, "Selecione o projeto"); products();
}
el.client.addEventListener("change", projects);
el.project.addEventListener("change", products);
el.product.addEventListener("change", environments);
el.keepSensitive.addEventListener("change", preview);
el.displayMode.addEventListener("change", preview);
document.querySelectorAll('input[name="mode"]').forEach((input) => input.addEventListener("change", preview));
el.login.addEventListener("click", () => chrome.runtime.sendMessage({ type: "qts:open-options", tab: "account" }));
el.settings.addEventListener("click", () => chrome.runtime.openOptionsPage());

el.urlForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const environmentIds = [...document.querySelectorAll('input[name="environment"]:checked')].map((input) => input.value);
  if (!value("product") || !environmentIds.length) {
    el.message.textContent = "Selecione produto e pelo menos um ambiente."; el.message.className = "message error"; return;
  }
  const pattern = patternFor();
  const duplicate = workspace.urlBindings.find((binding) => binding.patterns?.includes(pattern));
  if (duplicate && (duplicate.productId !== value("product") || !environmentIds.every((id) => duplicate.environmentIds.includes(id)))) {
    el.message.textContent = "Esta URL já está vinculada a outro produto ou ambiente. Edite o vínculo no Workspace."; el.message.className = "message error"; return;
  }
  const sameScope = workspace.urlBindings.find((binding) => binding.productId === value("product") && [...binding.environmentIds].sort().join("|") === [...environmentIds].sort().join("|"));
  if (sameScope) {
    if (!sameScope.patterns.includes(pattern)) sameScope.patterns.push(pattern);
    sameScope.primaryUrl ||= safeUrl().href;
    sameScope.displayMode = el.displayMode.value;
    if (el.label.value.trim()) sameScope.label = el.label.value.trim();
  } else {
    workspace.urlBindings.push({ id: `binding_${crypto.randomUUID()}`, patterns: [pattern], productId: value("product"), environmentIds, primaryUrl: safeUrl().href, displayMode: el.displayMode.value, label: el.label.value.trim(), active: true });
  }
  workspace = await saveWorkspace(workspace);
  el.message.textContent = "URL salva. A toolbar reconhecerá este ambiente ao recarregar a aba."; el.message.className = "message";
  if (sourceTabId) await chrome.tabs.reload(sourceTabId);
});

async function init() {
  el.version.textContent = `v${chrome.runtime.getManifest().version}`;
  const params = new URLSearchParams(location.search);
  const requestedTabId = Number(params.get("tabId"));
  const tab = Number.isInteger(requestedTabId) && requestedTabId > 0
    ? await chrome.tabs.get(requestedTabId)
    : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  sourceTabId = params.has("sourceUrl") ? null : tab?.id;
  sourceUrl = params.get("sourceUrl") || tab?.url || "";
  let parsed;
  try { parsed = new URL(sourceUrl); } catch {}
  if (!parsed || !["http:", "https:"].includes(parsed.protocol)) { el.loading.textContent = "Esta página interna não pode ser vinculada ao workspace."; return; }
  const access = await chrome.runtime.sendMessage({ type: "qts:get-access-state" });
  el.loading.hidden = true;
  if (!access?.active) { el.loggedOut.hidden = false; return; }
  workspace = await getWorkspace();
  el.activeUrl.value = sourceUrl;
  el.sensitiveWarning.hidden = !(parsed.search || parsed.hash);
  fill(el.client, workspace.clients.filter((item) => item.active !== false), "Selecione o cliente");
  const current = workspace.urlBindings.find((binding) => binding.patterns?.some((pattern) => {
    try { return new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`, "i").test(sourceUrl); } catch { return false; }
  }));
  const product = workspace.products.find((item) => item.id === current?.productId);
  const project = workspace.projects.find((item) => item.id === product?.projectId);
  if (project) el.client.value = project.clientId;
  projects();
  if (project) el.project.value = project.id;
  products();
  if (product) el.product.value = product.id;
  environments(); preview(); el.urlForm.hidden = false;
}
init().catch((error) => { el.loading.textContent = `Não foi possível abrir o workspace: ${error.message}`; });
