"use strict";

// Self-contained demo data (no backend) -- reset to these three seed rows on every page load,
// so the tutorial/tour always starts from the same known state.
let users = [
  { id: "u1", firstName: "Ana", lastName: "Souza", email: "ana.souza@example.com", age: 29, department: "QA" },
  { id: "u2", firstName: "Bruno", lastName: "Lima", email: "bruno.lima@example.com", age: 34, department: "Desenvolvimento" },
  { id: "u3", firstName: "Carla", lastName: "Dias", email: "carla.dias@example.com", age: 26, department: "Produto" },
];
let editingId = null;

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
  usersBody.innerHTML = users.map((user) => `
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
  usersEmpty.hidden = users.length > 0;
  usersBody.querySelectorAll("[data-edit]").forEach((button) => button.addEventListener("click", () => openRecordDialog(button.dataset.edit)));
  usersBody.querySelectorAll("[data-delete]").forEach((button) => button.addEventListener("click", () => deleteUser(button.dataset.delete)));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
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

// Contact form -- same success/error banner pattern, plain client-side validation only.
const contactForm = document.getElementById("contactForm");
const formSuccess = document.getElementById("formSuccess");
const formError = document.getElementById("formError");
contactForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const valid = contactForm.checkValidity();
  if (!valid) {
    showBanner(formSuccess, formError, "error", "Erro: revise os campos obrigatórios do formulário.");
    return;
  }
  showBanner(formSuccess, formError, "success", "Formulário enviado com sucesso! Em breve entraremos em contato.");
});

// Ações e alertas -- toasts, a real console error and a real failed network request (useful for
// Error Monitor), plus a native <dialog> confirmation.
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
