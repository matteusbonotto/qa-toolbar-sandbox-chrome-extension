"use strict";

// ---------------------------------------------------------------------------
// Navigation: a demoqa-style left sidebar (category -> pages) with client-side
// show/hide of <section class="page" data-page="..."> blocks already in index.html.
// No router/history changes -- keeps this a single real page (so the toolbar/tour's
// fixed sandbox/index.html URL binding keeps working exactly as before), just a
// different section visible at a time.
// ---------------------------------------------------------------------------
const NAV = [
  { category: "Elements", items: [
    ["text-box", "Text Box"], ["check-box", "Check Box"], ["radio-button", "Radio Button"],
    ["web-tables", "Web Tables"], ["buttons", "Buttons"], ["links", "Links"],
    ["broken-links-images", "Broken Links - Images"], ["upload-download", "Upload and Download"],
    ["dynamic-properties", "Dynamic Properties"],
  ] },
  { category: "Forms", items: [["practice-form", "Practice Form"]] },
  { category: "Alerts, Frame & Windows", items: [
    ["browser-windows", "Browser Windows"], ["alerts", "Alerts"], ["frames", "Frames"],
    ["nested-frames", "Nested Frames"], ["modal-dialogs", "Modal Dialogs"],
  ] },
  { category: "Widgets", items: [
    ["accordion", "Accordion"], ["auto-complete", "Auto Complete"], ["date-picker", "Date Picker"],
    ["slider", "Slider"], ["progress-bar", "Progress Bar"], ["tabs", "Tabs"], ["tool-tips", "Tool Tips"],
    ["menu", "Menu"], ["select-menu", "Select Menu"],
  ] },
  { category: "Interactions", items: [
    ["sortable", "Sortable"], ["selectable", "Selectable"], ["resizable", "Resizable"],
    ["droppable", "Droppable"], ["draggable", "Draggable"],
  ] },
  { category: "QA Utilities", items: [["eventos-e-erros", "Eventos, alertas e erros"]] },
];

const sideNav = document.getElementById("sideNav");
sideNav.innerHTML = NAV.map((group, groupIndex) => `
  <div class="nav-category${groupIndex === 0 ? " isOpen" : ""}" data-category="${escapeHtml(group.category)}">
    <button type="button" class="nav-category-btn" data-testid="nav-category-${slugify(group.category)}">${escapeHtml(group.category)}<span class="chevron">›</span></button>
    <div class="nav-items">
      ${group.items.map(([id, label]) => `<button type="button" class="nav-item" data-page-link="${id}" data-testid="nav-${id}">${escapeHtml(label)}</button>`).join("")}
    </div>
  </div>
`).join("");

function slugify(value) {
  return String(value).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

sideNav.querySelectorAll(".nav-category-btn").forEach((button) => button.addEventListener("click", () => {
  button.closest(".nav-category").classList.toggle("isOpen");
}));

function showPage(pageId) {
  document.querySelectorAll("main#pageHost .page").forEach((section) => section.classList.toggle("isActive", section.dataset.page === pageId));
  sideNav.querySelectorAll("[data-page-link]").forEach((link) => link.classList.toggle("isActive", link.dataset.pageLink === pageId));
  const activeLink = sideNav.querySelector(`[data-page-link="${pageId}"]`);
  activeLink?.closest(".nav-category")?.classList.add("isOpen");
  document.getElementById("sideNav").classList.remove("isOpen");
  history.replaceState(null, "", `#${pageId}`);
}
sideNav.querySelectorAll("[data-page-link]").forEach((link) => link.addEventListener("click", () => showPage(link.dataset.pageLink)));
document.getElementById("navToggle").addEventListener("click", () => sideNav.classList.toggle("isOpen"));

const allPageIds = NAV.flatMap((group) => group.items.map(([id]) => id));
const initialPage = allPageIds.includes(location.hash.slice(1)) ? location.hash.slice(1) : "text-box";
showPage(initialPage);

// ---------------------------------------------------------------------------
// Text Box
// ---------------------------------------------------------------------------
document.getElementById("textBoxForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const output = document.getElementById("textBoxOutput");
  output.hidden = false;
  output.innerHTML = `
    <p id="output-name"><b>Nome:</b> ${escapeHtml(document.getElementById("userName").value)}</p>
    <p id="output-email"><b>E-mail:</b> ${escapeHtml(document.getElementById("userEmail").value)}</p>
    <p id="output-current-address"><b>Endereço atual:</b> ${escapeHtml(document.getElementById("currentAddress").value)}</p>
    <p id="output-permanent-address"><b>Endereço permanente:</b> ${escapeHtml(document.getElementById("permanentAddress").value)}</p>
  `;
});

// ---------------------------------------------------------------------------
// Check Box (tree with cascading selection)
// ---------------------------------------------------------------------------
const CHECK_TREE = [
  { id: "home", label: "Home", children: [
    { id: "desktop", label: "Desktop", children: [
      { id: "notes", label: "Notes" }, { id: "commands", label: "Commands" },
    ] },
    { id: "documents", label: "Documents", children: [
      { id: "workspace", label: "WorkSpace" }, { id: "office", label: "Office" },
    ] },
    { id: "downloads", label: "Downloads" },
  ] },
];
function renderCheckNode(node, depth) {
  const hasChildren = Array.isArray(node.children) && node.children.length;
  return `
    <li>
      <div class="tree-row">
        ${hasChildren ? `<button type="button" class="tree-toggle" data-tree-toggle="${node.id}">▾</button>` : `<span class="tree-toggle"></span>`}
        <label><input type="checkbox" id="check-${node.id}" data-testid="check-${node.id}" data-check-node="${node.id}" /> ${escapeHtml(node.label)}</label>
      </div>
      ${hasChildren ? `<ul data-tree-children="${node.id}">${node.children.map((child) => renderCheckNode(child, depth + 1)).join("")}</ul>` : ""}
    </li>`;
}
const checkTree = document.getElementById("checkTree");
checkTree.innerHTML = CHECK_TREE.map((node) => renderCheckNode(node, 0)).join("");
function flattenCheckNodes(nodes) {
  return nodes.flatMap((node) => [node, ...(node.children ? flattenCheckNodes(node.children) : [])]);
}
const flatCheckNodes = flattenCheckNodes(CHECK_TREE);
function findCheckNode(id) { return flatCheckNodes.find((node) => node.id === id); }
function descendantIds(node) {
  if (!node.children) return [];
  return node.children.flatMap((child) => [child.id, ...descendantIds(child)]);
}
function updateCheckOutput() {
  const checked = flatCheckNodes.filter((node) => document.getElementById(`check-${node.id}`)?.checked).map((node) => node.label);
  const output = document.getElementById("checkBoxOutput");
  if (!checked.length) { output.hidden = true; return; }
  output.hidden = false;
  output.innerHTML = `<p><b>Selecionado:</b> ${checked.map(escapeHtml).join(", ")}</p>`;
}
checkTree.addEventListener("change", (event) => {
  const nodeId = event.target.dataset.checkNode;
  if (!nodeId) return;
  const node = findCheckNode(nodeId);
  descendantIds(node).forEach((id) => { const input = document.getElementById(`check-${id}`); if (input) input.checked = event.target.checked; });
  updateCheckOutput();
});
checkTree.addEventListener("click", (event) => {
  const toggle = event.target.closest("[data-tree-toggle]");
  if (!toggle) return;
  const childList = checkTree.querySelector(`[data-tree-children="${toggle.dataset.treeToggle}"]`);
  if (!childList) return;
  childList.hidden = !childList.hidden;
  toggle.textContent = childList.hidden ? "▸" : "▾";
});
document.getElementById("checkExpandAll").addEventListener("click", () => checkTree.querySelectorAll("[data-tree-children]").forEach((list) => { list.hidden = false; }));
document.getElementById("checkCollapseAll").addEventListener("click", () => checkTree.querySelectorAll("[data-tree-children]").forEach((list) => { list.hidden = true; }));

// ---------------------------------------------------------------------------
// Radio Button
// ---------------------------------------------------------------------------
document.getElementById("radioGroup").addEventListener("change", (event) => {
  const output = document.getElementById("radioOutput");
  output.hidden = false;
  output.innerHTML = `<p>Você selecionou: <b>${escapeHtml(event.target.value)}</b></p>`;
});

// ---------------------------------------------------------------------------
// Web Tables (existing CRUD, now with a search filter)
// ---------------------------------------------------------------------------
let users = [
  { id: "u1", firstName: "Ana", lastName: "Souza", email: "ana.souza@example.com", age: 29, department: "QA" },
  { id: "u2", firstName: "Bruno", lastName: "Lima", email: "bruno.lima@example.com", age: 34, department: "Desenvolvimento" },
  { id: "u3", firstName: "Carla", lastName: "Dias", email: "carla.dias@example.com", age: 26, department: "Produto" },
];
let editingId = null;
let usersQuery = "";

const usersBody = document.getElementById("usersBody");
const usersEmpty = document.getElementById("usersEmpty");
const usersSuccess = document.getElementById("usersSuccess");
const usersError = document.getElementById("usersError");
const recordDialog = document.getElementById("recordDialog");
const recordForm = document.getElementById("recordForm");
const recordDialogTitle = document.getElementById("recordDialogTitle");

function showBanner(successEl, errorEl, kind, message) {
  successEl.hidden = kind !== "success";
  errorEl.hidden = kind !== "error";
  (kind === "success" ? successEl : errorEl).textContent = message;
  window.setTimeout(() => { successEl.hidden = true; errorEl.hidden = true; }, 6000);
}

function renderUsers() {
  const query = usersQuery.trim().toLowerCase();
  const filtered = !query ? users : users.filter((user) => `${user.firstName} ${user.lastName} ${user.email} ${user.department}`.toLowerCase().includes(query));
  usersBody.innerHTML = filtered.map((user) => `
    <tr data-row-id="${user.id}">
      <td>${escapeHtml(user.firstName)}</td>
      <td>${escapeHtml(user.lastName)}</td>
      <td>${escapeHtml(user.email)}</td>
      <td>${user.age}</td>
      <td>${escapeHtml(user.department)}</td>
      <td class="row-actions">
        <button type="button" class="icon-btn" data-edit="${user.id}" title="Editar" aria-label="Editar">✎</button>
        <button type="button" class="icon-btn danger" data-delete="${user.id}" title="Excluir" aria-label="Excluir">🗑</button>
      </td>
    </tr>`).join("");
  usersEmpty.hidden = filtered.length > 0;
  usersBody.querySelectorAll("[data-edit]").forEach((button) => button.addEventListener("click", () => openRecordDialog(button.dataset.edit)));
  usersBody.querySelectorAll("[data-delete]").forEach((button) => button.addEventListener("click", () => deleteUser(button.dataset.delete)));
}

function openRecordDialog(userId) {
  editingId = userId || null;
  const user = users.find((item) => item.id === userId);
  recordDialogTitle.textContent = user ? "Editar registro" : "Novo registro";
  recordForm.firstName.value = user?.firstName || "";
  recordForm.lastName.value = user?.lastName || "";
  recordForm.email.value = user?.email || "";
  recordForm.age.value = user?.age || "";
  recordForm.department.value = user?.department || "QA";
  recordDialog.showModal();
}

function deleteUser(userId) {
  users = users.filter((user) => user.id !== userId);
  renderUsers();
  showBanner(usersSuccess, usersError, "success", "Registro removido com sucesso.");
}

document.getElementById("addUserBtn").addEventListener("click", () => openRecordDialog(null));
document.getElementById("recordCancel").addEventListener("click", () => recordDialog.close());
recordDialog.addEventListener("cancel", () => { editingId = null; });
document.getElementById("usersSearch").addEventListener("input", (event) => { usersQuery = event.target.value; renderUsers(); });

recordForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const firstName = recordForm.firstName.value.trim();
  const lastName = recordForm.lastName.value.trim();
  const email = recordForm.email.value.trim();
  const age = Number(recordForm.age.value);
  const department = recordForm.department.value;
  if (!firstName || !lastName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !age) {
    showBanner(usersSuccess, usersError, "error", "Erro: preencha nome, sobrenome, e-mail válido e idade.");
    return;
  }
  if (editingId) {
    const user = users.find((item) => item.id === editingId);
    Object.assign(user, { firstName, lastName, email, age, department });
    showBanner(usersSuccess, usersError, "success", "Registro atualizado com sucesso.");
  } else {
    users.push({ id: `u${Date.now()}`, firstName, lastName, email, age, department });
    showBanner(usersSuccess, usersError, "success", "Registro cadastrado com sucesso.");
  }
  editingId = null;
  recordDialog.close();
  renderUsers();
});
renderUsers();

// ---------------------------------------------------------------------------
// Buttons (click / double-click / right-click)
// ---------------------------------------------------------------------------
function showButtonsOutput(text) {
  const output = document.getElementById("buttonsOutput");
  output.hidden = false;
  output.textContent = text;
}
document.getElementById("clickMeBtn").addEventListener("click", () => showButtonsOutput("Você deu um clique simples."));
document.getElementById("doubleClickBtn").addEventListener("dblclick", () => showButtonsOutput("Você deu um clique duplo."));
document.getElementById("rightClickBtn").addEventListener("contextmenu", (event) => { event.preventDefault(); showButtonsOutput("Você clicou com o botão direito."); });

// ---------------------------------------------------------------------------
// Links (simulated API status codes)
// ---------------------------------------------------------------------------
document.getElementById("dynamicLink").addEventListener("click", (event) => { event.preventDefault(); });
const API_LINK_STATUS = { created: 201, "no-content": 204, moved: 301, "bad-request": 400, unauthorized: 401, forbidden: 403, "not-found": 404, "server-error": 500 };
document.querySelectorAll("[data-api-link]").forEach((button) => button.addEventListener("click", () => {
  const status = API_LINK_STATUS[button.dataset.apiLink];
  const output = document.getElementById("linksOutput");
  output.hidden = false;
  output.textContent = `Link chamado — resposta simulada: ${status}`;
}));

// ---------------------------------------------------------------------------
// Upload and Download
// ---------------------------------------------------------------------------
document.getElementById("uploadInput").addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  document.getElementById("uploadPath").textContent = file ? `Arquivo selecionado: ${file.name} (${file.size} bytes)` : "";
});
document.getElementById("downloadBtn").addEventListener("click", () => {
  const blob = new Blob(["Arquivo de teste gerado pela QA Toolbar Sandbox.\n"], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "qa-toolbar-sandbox-teste.txt";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
});

// ---------------------------------------------------------------------------
// Dynamic Properties
// ---------------------------------------------------------------------------
window.setTimeout(() => { document.getElementById("enableAfterBtn").disabled = false; }, 5000);
window.setTimeout(() => { document.getElementById("colorChangeBtn").style.background = "linear-gradient(135deg, #33d6b0 0%, #7c5cff 100%)"; }, 5000);
window.setTimeout(() => { document.getElementById("visibleAfterText").style.visibility = "visible"; }, 5000);

// ---------------------------------------------------------------------------
// Practice Form (state -> city dependent select, then submit banner)
// ---------------------------------------------------------------------------
const CITIES_BY_STATE = { SP: ["São Paulo", "Campinas", "Santos"], RJ: ["Rio de Janeiro", "Niterói", "Petrópolis"], MG: ["Belo Horizonte", "Uberlândia", "Juiz de Fora"] };
const contactState = document.getElementById("contactState");
const contactCity = document.getElementById("contactCity");
contactState.addEventListener("change", () => {
  const cities = CITIES_BY_STATE[contactState.value];
  contactCity.disabled = !cities;
  contactCity.innerHTML = cities ? cities.map((city) => `<option value="${escapeHtml(city)}">${escapeHtml(city)}</option>`).join("") : `<option value="">Selecione o estado primeiro</option>`;
});

const contactForm = document.getElementById("contactForm");
const formSuccess = document.getElementById("formSuccess");
const formError = document.getElementById("formError");
contactForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!contactForm.checkValidity()) {
    showBanner(formSuccess, formError, "error", "Erro: revise os campos obrigatórios do formulário.");
    return;
  }
  showBanner(formSuccess, formError, "success", "Formulário enviado com sucesso! Em breve entraremos em contato.");
});

// ---------------------------------------------------------------------------
// Browser Windows
// ---------------------------------------------------------------------------
document.getElementById("newTabBtn").addEventListener("click", () => window.open(location.href, "_blank"));
document.getElementById("newWindowBtn").addEventListener("click", () => window.open(location.href, "_blank", "width=480,height=360"));

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------
function showAlertsOutput(text) {
  const output = document.getElementById("alertsOutput");
  output.hidden = false;
  output.textContent = text;
}
document.getElementById("alertBtn").addEventListener("click", () => { window.alert("Isto é um alerta simples."); showAlertsOutput("Alerta simples exibido."); });
document.getElementById("timerAlertBtn").addEventListener("click", () => {
  showAlertsOutput("Aguardando 5 segundos...");
  window.setTimeout(() => { window.alert("Alerta depois de 5 segundos."); showAlertsOutput("Alerta com tempo exibido."); }, 5000);
});
document.getElementById("confirmBtn").addEventListener("click", () => showAlertsOutput(`Você ${window.confirm("Confirma a ação de teste?") ? "confirmou" : "cancelou"} o alerta.`));
document.getElementById("promptBtn").addEventListener("click", () => {
  const value = window.prompt("Digite algo:", "QA Toolbar Sandbox");
  showAlertsOutput(value === null ? "Prompt cancelado." : `Você digitou: ${value}`);
});

// ---------------------------------------------------------------------------
// Modal Dialogs
// ---------------------------------------------------------------------------
const smallModal = document.getElementById("smallModal");
const largeModal = document.getElementById("largeModal");
document.getElementById("smallModalBtn").addEventListener("click", () => smallModal.showModal());
document.getElementById("largeModalBtn").addEventListener("click", () => largeModal.showModal());

// ---------------------------------------------------------------------------
// Accordion
// ---------------------------------------------------------------------------
const ACCORDION_ITEMS = [
  { id: "what", title: "O que é a QA Toolbar Sandbox", body: "Uma extensão de Chrome com ferramentas de apoio a testes manuais e exploratórios, com barra de contexto, evidências e inspetores de rede." },
  { id: "why", title: "Por que usar este sandbox", body: "Pra praticar seletores, XPath e fluxos de automação num ambiente estável, sem depender de sites de terceiros que podem mudar sem aviso." },
  { id: "how", title: "Como usar", body: "Navegue pelo menu lateral, escolha uma categoria de elementos e interaja com os controles — cada um tem id e data-testid pra facilitar a automação." },
];
const accordionEl = document.getElementById("accordion");
accordionEl.innerHTML = ACCORDION_ITEMS.map((item) => `
  <div class="accordion-item" data-accordion-item="${item.id}">
    <button type="button" class="accordion-header" id="accordion-${item.id}-header" data-testid="accordion-${item.id}-header">${escapeHtml(item.title)}</button>
    <div class="accordion-body" id="accordion-${item.id}-body">${escapeHtml(item.body)}</div>
  </div>
`).join("");
accordionEl.querySelectorAll(".accordion-header").forEach((header) => header.addEventListener("click", () => {
  const item = header.closest(".accordion-item");
  const wasOpen = item.classList.contains("isOpen");
  accordionEl.querySelectorAll(".accordion-item").forEach((node) => node.classList.remove("isOpen"));
  if (!wasOpen) item.classList.add("isOpen");
}));

// ---------------------------------------------------------------------------
// Auto Complete (tag input)
// ---------------------------------------------------------------------------
const autoCompleteInput = document.getElementById("autoCompleteInput");
const colorTags = document.getElementById("colorTags");
let selectedColors = [];
function renderColorTags() {
  colorTags.innerHTML = selectedColors.map((color, index) => `<span class="tag" data-testid="color-tag-${index}">${escapeHtml(color)}<button type="button" data-remove-color="${index}" aria-label="Remover">✕</button></span>`).join("");
  colorTags.querySelectorAll("[data-remove-color]").forEach((button) => button.addEventListener("click", () => {
    selectedColors.splice(Number(button.dataset.removeColor), 1);
    renderColorTags();
  }));
}
autoCompleteInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  const value = autoCompleteInput.value.trim();
  if (value && !selectedColors.includes(value)) { selectedColors.push(value); renderColorTags(); }
  autoCompleteInput.value = "";
});

// ---------------------------------------------------------------------------
// Slider
// ---------------------------------------------------------------------------
const sliderInput = document.getElementById("sliderInput");
const sliderValue = document.getElementById("sliderValue");
sliderInput.addEventListener("input", () => { sliderValue.textContent = sliderInput.value; });

// ---------------------------------------------------------------------------
// Progress Bar
// ---------------------------------------------------------------------------
const progressBar = document.getElementById("progressBar");
let progressTimer = null;
document.getElementById("progressStart").addEventListener("click", () => {
  if (progressTimer) return;
  progressTimer = window.setInterval(() => {
    progressBar.value = Math.min(100, progressBar.value + 2);
    if (progressBar.value >= 100) { window.clearInterval(progressTimer); progressTimer = null; }
  }, 100);
});
document.getElementById("progressStop").addEventListener("click", () => { window.clearInterval(progressTimer); progressTimer = null; });
document.getElementById("progressReset").addEventListener("click", () => { window.clearInterval(progressTimer); progressTimer = null; progressBar.value = 0; });

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
document.querySelectorAll(".tab-btn").forEach((tabButton) => tabButton.addEventListener("click", () => {
  document.querySelectorAll(".tab-btn").forEach((button) => button.classList.toggle("isActive", button === tabButton));
  document.querySelectorAll("[data-tab-panel]").forEach((panel) => { panel.hidden = panel.dataset.tabPanel !== tabButton.dataset.tab; });
}));

// ---------------------------------------------------------------------------
// Sortable
// ---------------------------------------------------------------------------
const SORTABLE_ITEMS = ["Um", "Dois", "Três", "Quatro", "Cinco"];
const sortableList = document.getElementById("sortableList");
sortableList.innerHTML = SORTABLE_ITEMS.map((label, index) => `<li draggable="true" data-testid="sortable-${index}">${escapeHtml(label)}</li>`).join("");
let sortableDragged = null;
sortableList.addEventListener("dragstart", (event) => { sortableDragged = event.target; event.target.classList.add("isDragging"); });
sortableList.addEventListener("dragend", (event) => { event.target.classList.remove("isDragging"); sortableList.querySelectorAll("li").forEach((li) => li.classList.remove("dragOver")); });
sortableList.addEventListener("dragover", (event) => {
  event.preventDefault();
  const target = event.target.closest("li");
  if (!target || target === sortableDragged) return;
  sortableList.querySelectorAll("li").forEach((li) => li.classList.remove("dragOver"));
  target.classList.add("dragOver");
});
sortableList.addEventListener("drop", (event) => {
  event.preventDefault();
  const target = event.target.closest("li");
  if (!target || target === sortableDragged) return;
  const items = [...sortableList.children];
  if (items.indexOf(sortableDragged) < items.indexOf(target)) target.after(sortableDragged);
  else target.before(sortableDragged);
});

// ---------------------------------------------------------------------------
// Selectable
// ---------------------------------------------------------------------------
const SELECTABLE_ITEMS = ["Item A", "Item B", "Item C", "Item D"];
const selectableList = document.getElementById("selectableList");
selectableList.innerHTML = SELECTABLE_ITEMS.map((label, index) => `<li data-testid="selectable-${index}">${escapeHtml(label)}</li>`).join("");
selectableList.addEventListener("click", (event) => {
  const item = event.target.closest("li");
  if (!item) return;
  if (!event.ctrlKey && !event.metaKey) selectableList.querySelectorAll("li").forEach((li) => li !== item && li.classList.remove("isSelected"));
  item.classList.toggle("isSelected");
});

// ---------------------------------------------------------------------------
// Resizable (pointer-based, mirrors the extension's own corner-resize pattern)
// ---------------------------------------------------------------------------
document.querySelectorAll("[data-resize-target]").forEach((grip) => {
  grip.addEventListener("mousedown", (event) => {
    event.preventDefault();
    const box = document.getElementById(grip.dataset.resizeTarget);
    const startX = event.clientX; const startY = event.clientY;
    const startWidth = box.offsetWidth; const startHeight = box.offsetHeight;
    const onMove = (moveEvent) => {
      box.style.width = `${Math.max(80, startWidth + (moveEvent.clientX - startX))}px`;
      box.style.height = `${Math.max(60, startHeight + (moveEvent.clientY - startY))}px`;
    };
    const onUp = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
});

// ---------------------------------------------------------------------------
// Droppable (native HTML5 drag and drop)
// ---------------------------------------------------------------------------
const dragBox = document.getElementById("dragBox");
const dropBox = document.getElementById("dropBox");
dragBox.addEventListener("dragstart", (event) => event.dataTransfer.setData("text/plain", "dragBox"));
dropBox.addEventListener("dragover", (event) => { event.preventDefault(); dropBox.classList.add("isOver"); });
dropBox.addEventListener("dragleave", () => dropBox.classList.remove("isOver"));
dropBox.addEventListener("drop", (event) => {
  event.preventDefault();
  dropBox.classList.remove("isOver");
  dropBox.classList.add("isDropped");
  dropBox.textContent = "Solto!";
});

// ---------------------------------------------------------------------------
// Draggable (pointer-based free drag, one unrestricted + one X-axis-only)
// ---------------------------------------------------------------------------
function makeFreeDraggable(box, { axis } = {}) {
  box.addEventListener("mousedown", (event) => {
    event.preventDefault();
    const field = box.parentElement;
    const startX = event.clientX; const startY = event.clientY;
    const startLeft = box.offsetLeft; const startTop = box.offsetTop;
    box.classList.add("isDragging");
    const onMove = (moveEvent) => {
      const bounds = field.getBoundingClientRect();
      let nextLeft = startLeft + (moveEvent.clientX - startX);
      let nextTop = axis === "x" ? startTop : startTop + (moveEvent.clientY - startY);
      nextLeft = Math.max(0, Math.min(nextLeft, bounds.width - box.offsetWidth));
      nextTop = Math.max(0, Math.min(nextTop, bounds.height - box.offsetHeight));
      box.style.left = `${nextLeft}px`;
      box.style.top = `${nextTop}px`;
    };
    const onUp = () => { box.classList.remove("isDragging"); document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
}
makeFreeDraggable(document.getElementById("freeDragBox"));
makeFreeDraggable(document.getElementById("axisDragBox"), { axis: "x" });

// ---------------------------------------------------------------------------
// Eventos, alertas e erros -- toasts, a real console error and a real failed network
// request (useful for Error Monitor), plus a native <dialog> confirmation.
// ---------------------------------------------------------------------------
const toastStack = document.getElementById("toastStack");
function pushToast(kind, message) {
  const toast = document.createElement("div");
  toast.className = `toast ${kind}`;
  toast.setAttribute("role", kind === "error" ? "alert" : "status");
  toast.textContent = message;
  toastStack.appendChild(toast);
  window.setTimeout(() => toast.remove(), 5000);
}
document.getElementById("triggerSuccess").addEventListener("click", () => pushToast("success", "Ação concluída com sucesso!"));
document.getElementById("triggerError").addEventListener("click", () => pushToast("error", "Erro: não foi possível concluir a ação."));
document.getElementById("triggerConsoleError").addEventListener("click", () => console.error("[QA Toolbar Sandbox] erro simulado para teste do Error Monitor"));
document.getElementById("triggerNetworkError").addEventListener("click", () => {
  fetch("/rota-inexistente-para-teste").catch(() => pushToast("error", "Falha de rede simulada (veja o Error Monitor)."));
});
const confirmDialog = document.getElementById("confirmDialog");
document.getElementById("triggerModal").addEventListener("click", () => confirmDialog.showModal());
document.getElementById("confirmCancel").addEventListener("click", () => confirmDialog.close());
confirmDialog.addEventListener("close", () => {
  if (confirmDialog.returnValue === "ok") pushToast("success", "Ação confirmada.");
});
