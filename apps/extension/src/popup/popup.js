const { getWorkspace, saveWorkspace } = window.QTS_STORAGE;
const el = Object.fromEntries([...document.querySelectorAll("[id]")].map((node) => [node.id, node]));
let workspace;
let sourceUrl;
let sourceTabId;
let popupLocale = "pt-BR";
const POPUP_TRANSLATIONS = {
  es: {
    "Abrir configurações":"Abrir configuración","Lendo a aba atual…":"Leyendo la pestaña actual…","Entre para salvar esta URL":"Inicia sesión para guardar esta URL","A toolbar precisa de uma conta ativa para editar o workspace.":"La barra necesita una cuenta activa para editar el workspace.","Entrar em Minha conta":"Entrar en Mi cuenta","Salvar URL no ambiente":"Guardar URL en el entorno","URL da aba ativa":"URL de la pestaña activa","Esta URL contém query ou hash. Eles serão removidos por segurança.":"Esta URL contiene query o hash. Se eliminarán por seguridad.","Manter query e hash mesmo assim":"Mantener query y hash","Cliente":"Cliente","Projeto":"Proyecto","Produto":"Producto","Ambientes":"Entornos","Nome ou descrição (opcional)":"Nombre o descripción (opcional)","Regra de correspondência":"Regla de coincidencia","Exata":"Exacta","Esta rota e abaixo":"Esta ruta y las inferiores","Domínio inteiro":"Dominio completo","Exibir como":"Mostrar como","URL completa":"URL completa","Somente caminho":"Solo ruta","Padrão salvo":"Patrón guardado","Exibição":"Visualización","Salvar e reconhecer agora":"Guardar y reconocer ahora","Selecione o cliente":"Selecciona el cliente","Selecione o projeto":"Selecciona el proyecto","Selecione o produto":"Selecciona el producto","Selecione produto e pelo menos um ambiente.":"Selecciona un producto y al menos un entorno.","URL salva. A toolbar reconhecerá este ambiente ao recarregar a aba.":"URL guardada. La barra reconocerá este entorno al recargar la pestaña.","Esta página interna não pode ser vinculada ao workspace.":"Esta página interna no se puede vincular al workspace.","Esta URL já está vinculada a outro produto ou ambiente. Edite o vínculo no Workspace.":"Esta URL ya está vinculada a otro producto o entorno. Edita el vínculo en Workspace.","Não foi possível abrir o workspace:":"No se pudo abrir el workspace:",
  },
  en: {
    "Abrir configurações":"Open settings","Lendo a aba atual…":"Reading the active tab…","Entre para salvar esta URL":"Sign in to save this URL","A toolbar precisa de uma conta ativa para editar o workspace.":"The toolbar needs an active account to edit the workspace.","Entrar em Minha conta":"Sign in under My account","Salvar URL no ambiente":"Save URL to environment","URL da aba ativa":"Active tab URL","Esta URL contém query ou hash. Eles serão removidos por segurança.":"This URL contains a query or hash. They will be removed for safety.","Manter query e hash mesmo assim":"Keep query and hash","Cliente":"Client","Projeto":"Project","Produto":"Product","Ambientes":"Environments","Nome ou descrição (opcional)":"Name or description (optional)","Regra de correspondência":"Matching rule","Exata":"Exact","Esta rota e abaixo":"This route and below","Domínio inteiro":"Entire domain","Exibir como":"Display as","URL completa":"Full URL","Somente caminho":"Path only","Padrão salvo":"Saved pattern","Exibição":"Display","Salvar e reconhecer agora":"Save and recognize now","Selecione o cliente":"Select the client","Selecione o projeto":"Select the project","Selecione o produto":"Select the product","Selecione produto e pelo menos um ambiente.":"Select a product and at least one environment.","URL salva. A toolbar reconhecerá este ambiente ao recarregar a aba.":"URL saved. The toolbar will recognize this environment after the tab reloads.","Esta página interna não pode ser vinculada ao workspace.":"This internal page cannot be linked to the workspace.","Esta URL já está vinculada a outro produto ou ambiente. Edite o vínculo no Workspace.":"This URL is already linked to another product or environment. Edit the link in Workspace.","Não foi possível abrir o workspace:":"Could not open the workspace:",
  },
};
function localizePopup(language) {
  const locale = language === "en" ? "en" : language === "es" ? "es" : "pt-BR";
  popupLocale = locale;
  document.documentElement.lang = locale;
  const translations = POPUP_TRANSLATIONS[locale];
  if (!translations) return;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let node = walker.currentNode;
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.nodeValue.trim();
      if (translations[value]) node.nodeValue = node.nodeValue.replace(value, translations[value]);
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      for (const attribute of ["aria-label","placeholder","title"]) {
        const value = node.getAttribute?.(attribute);
        if (translations[value]) node.setAttribute(attribute, translations[value]);
      }
    }
    node = walker.nextNode();
  }
}
const tr = (value) => POPUP_TRANSLATIONS[popupLocale]?.[value] || value;
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
  fill(el.product, items, tr("Selecione o produto")); environments();
}
function projects() {
  const items = workspace.projects.filter((item) => item.active !== false && item.clientId === value("client"));
  fill(el.project, items, tr("Selecione o projeto")); products();
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
    el.message.textContent = tr("Selecione produto e pelo menos um ambiente."); el.message.className = "message error"; return;
  }
  const pattern = patternFor();
  const duplicate = workspace.urlBindings.find((binding) => binding.patterns?.includes(pattern));
  if (duplicate && (duplicate.productId !== value("product") || !environmentIds.every((id) => duplicate.environmentIds.includes(id)))) {
    el.message.textContent = tr("Esta URL já está vinculada a outro produto ou ambiente. Edite o vínculo no Workspace."); el.message.className = "message error"; return;
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
  el.message.textContent = tr("URL salva. A toolbar reconhecerá este ambiente ao recarregar a aba."); el.message.className = "message";
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
  workspace = await getWorkspace();
  localizePopup(workspace.preferences?.language || (navigator.language.startsWith("es") ? "es" : navigator.language.startsWith("en") ? "en" : "pt-BR"));
  let parsed;
  try { parsed = new URL(sourceUrl); } catch {}
  if (!parsed || !["http:", "https:"].includes(parsed.protocol)) { el.loading.textContent = tr("Esta página interna não pode ser vinculada ao workspace."); return; }
  const access = await chrome.runtime.sendMessage({ type: "qts:get-access-state" });
  el.loading.hidden = true;
  if (!access?.active) { el.loggedOut.hidden = false; return; }
  el.activeUrl.value = sourceUrl;
  el.sensitiveWarning.hidden = !(parsed.search || parsed.hash);
  fill(el.client, workspace.clients.filter((item) => item.active !== false), tr("Selecione o cliente"));
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
init().catch((error) => { el.loading.textContent = `${tr("Não foi possível abrir o workspace:")} ${error.message}`; });
