// Safe, local QA primitives shared by the toolbar tools and Macro Studio.
// Macros are declarative: this file never evaluates user-provided JavaScript.
(() => {
  const SENSITIVE_HINT = /(?:passw(?:or)?d|senha|secret|token|authorization|auth[_-]?key|api[_-]?key|card|cart[aã]o|credit|debit|cc(?:num|number)?|cvv|cvc|security[_-]?code)/i;
  const EDITABLE_SELECTOR = "input:not([type=hidden]):not([type=file]):not([type=button]):not([type=submit]):not([type=reset]):not([type=image]):not([disabled]), textarea:not([disabled]), select:not([disabled])";
  const delay = (ms) => new Promise((resolve) => window.setTimeout(resolve, Math.max(0, Math.min(30_000, Number(ms) || 0))));

  function countCharacters(value) {
    const text = String(value ?? "");
    return {
      withSpaces: [...text].length,
      withoutSpaces: [...text.replace(/\s/g, "")].length,
      words: text.trim() ? text.trim().split(/\s+/).length : 0,
      lines: text ? text.split(/\r?\n/).length : 0,
      bytes: new TextEncoder().encode(text).length,
    };
  }

  function sensitiveFingerprint(element) {
    if (!(element instanceof Element)) return "";
    const label = element.labels ? [...element.labels].map((item) => item.textContent).join(" ") : "";
    return [element.getAttribute("type"), element.id, element.getAttribute("name"), element.getAttribute("autocomplete"), element.getAttribute("aria-label"), element.getAttribute("placeholder"), label].filter(Boolean).join(" ");
  }

  function isSensitiveElement(element) {
    return (element instanceof HTMLInputElement && element.type === "password")
      || SENSITIVE_HINT.test(sensitiveFingerprint(element));
  }

  function isSensitiveSelector(selector) {
    return SENSITIVE_HINT.test(String(selector || ""));
  }

  function cssEscape(value) {
    return window.CSS?.escape ? window.CSS.escape(String(value)) : String(value).replace(/[^a-z0-9_-]/gi, (character) => `\\${character}`);
  }

  function uniqueSelector(element) {
    if (!(element instanceof Element)) return "";
    for (const attribute of ["data-testid", "data-test", "data-qa", "name"]) {
      const value = element.getAttribute(attribute);
      if (!value || SENSITIVE_HINT.test(value)) continue;
      const selector = `${element.tagName.toLowerCase()}[${attribute}="${cssEscape(value)}"]`;
      try { if (document.querySelectorAll(selector).length === 1) return selector; } catch {}
    }
    if (element.id && !SENSITIVE_HINT.test(element.id)) {
      const selector = `#${cssEscape(element.id)}`;
      try { if (document.querySelectorAll(selector).length === 1) return selector; } catch {}
    }
    const parts = [];
    let current = element;
    while (current && current !== document.documentElement && parts.length < 6) {
      let part = current.tagName.toLowerCase();
      const siblings = current.parentElement ? [...current.parentElement.children].filter((candidate) => candidate.tagName === current.tagName) : [];
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      parts.unshift(part);
      const selector = parts.join(" > ");
      try { if (document.querySelectorAll(selector).length === 1) return selector; } catch {}
      current = current.parentElement;
    }
    return parts.join(" > ");
  }

  function setNativeValue(element, value) {
    if (element instanceof HTMLSelectElement) {
      element.value = String(value);
    } else {
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      if (setter) setter.call(element, String(value)); else element.value = String(value);
    }
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function visible(element) {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
  }

  function fakeValueFor(element, seed = Date.now()) {
    const hint = sensitiveFingerprint(element).toLowerCase();
    const suffix = String(seed).slice(-6);
    if (element instanceof HTMLSelectElement) return [...element.options].find((option) => !option.disabled && option.value)?.value ?? "";
    if (element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type)) return true;
    if (element instanceof HTMLInputElement && element.type === "email" || /e-?mail/.test(hint)) return `qa.teste+${suffix}@example.com`;
    if (/first|primeiro|nome/.test(hint) && !/user|login/.test(hint)) return "Pessoa Teste";
    if (/last|sobrenome/.test(hint)) return "Automação";
    if (/phone|tel|celular|telefone/.test(hint)) return "11999990000";
    if (/cep|postal|zip/.test(hint)) return "01001000";
    if (/city|cidade/.test(hint)) return "São Paulo";
    if (/state|estado|uf/.test(hint)) return "SP";
    if (/country|pa[ií]s/.test(hint)) return "Brasil";
    if (/address|endere[cç]o|street|rua/.test(hint)) return "Rua de Teste, 100";
    if (/company|empresa/.test(hint)) return "Empresa Sandbox QA";
    if (/url|site|website/.test(hint)) return "https://example.com/qa";
    if (element instanceof HTMLInputElement && ["number", "range"].includes(element.type)) {
      const min = Number.isFinite(element.minAsNumber) ? element.minAsNumber : 1;
      const max = Number.isFinite(element.maxAsNumber) ? element.maxAsNumber : min + 100;
      return String(Math.round(Math.min(max, min + Math.max(1, (max - min) / 2))));
    }
    if (element instanceof HTMLInputElement && element.type === "date") return "2030-06-15";
    if (element instanceof HTMLInputElement && element.type === "datetime-local") return "2030-06-15T10:30";
    if (element instanceof HTMLInputElement && element.type === "month") return "2030-06";
    if (element instanceof HTMLInputElement && element.type === "time") return "10:30";
    if (element instanceof HTMLInputElement && element.type === "week") return "2030-W24";
    if (element instanceof HTMLInputElement && element.type === "color") return "#7357ff";
    return `Teste QA ${suffix}`;
  }

  function fillWithFakeData(root = document) {
    const fields = [...root.querySelectorAll(EDITABLE_SELECTOR)].filter((element) => visible(element) && !element.readOnly && !isSensitiveElement(element));
    let filled = 0;
    let protectedCount = 0;
    for (const element of [...root.querySelectorAll("input,textarea,select")]) if (isSensitiveElement(element)) protectedCount += 1;
    for (const [index, element] of fields.entries()) {
      const value = fakeValueFor(element, Date.now() + index);
      if (element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type)) {
        if (!element.checked) element.click();
      } else if (value !== "") setNativeValue(element, value);
      filled += 1;
    }
    return { filled, protectedCount };
  }

  // Single-field counterpart to fillWithFakeData, used by the right-click "Preencher com dado
  // fake" context menu action, which targets exactly the element the user clicked rather than an
  // entire form/page.
  function fillSingleField(element) {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) return { filled: 0, protectedCount: 0 };
    if (isSensitiveElement(element)) return { filled: 0, protectedCount: 1 };
    if (element.readOnly || element.disabled) return { filled: 0, protectedCount: 0 };
    if (element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type)) {
      if (!element.checked) element.click();
      return { filled: 1, protectedCount: 0 };
    }
    const value = fakeValueFor(element);
    if (value !== "") setNativeValue(element, value);
    return { filled: 1, protectedCount: 0 };
  }

  function inspectInput(element) {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) return null;
    return {
      selector: uniqueSelector(element),
      tag: element.tagName.toLowerCase(),
      type: element instanceof HTMLInputElement ? element.type : element.tagName.toLowerCase(),
      required: element.required,
      readOnly: element.readOnly,
      minLength: element.minLength >= 0 ? element.minLength : null,
      maxLength: element.maxLength >= 0 ? element.maxLength : null,
      min: element.getAttribute("min"),
      max: element.getAttribute("max"),
      step: element.getAttribute("step"),
      pattern: element.getAttribute("pattern"),
      inputMode: element.getAttribute("inputmode"),
      sensitive: isSensitiveElement(element),
    };
  }

  function validationCases(element) {
    const overLimit = element.maxLength > 0 ? "A".repeat(Math.min(2_100, element.maxLength + 1)) : "A".repeat(257);
    return [
      ["vazio", ""], ["texto", "Texto QA"], ["número", "12345"],
      ["especial", "!@#$%&*"], ["unicode", "ação 🚀"], ["acima do limite", overLimit],
    ];
  }

  async function runInputValidation(element) {
    if (!inspectInput(element) || isSensitiveElement(element)) throw new Error("sensitive_or_invalid_input");
    const original = { value: element.value, checked: element.checked };
    const results = [];
    for (const [name, value] of validationCases(element)) {
      setNativeValue(element, value);
      const tooLong = element.maxLength >= 0 && element.value.length > element.maxLength;
      const tooShort = element.minLength >= 0 && element.value.length > 0 && element.value.length < element.minLength;
      const valueWasAccepted = value === "" || element.value !== "";
      const accepted = element.checkValidity() && valueWasAccepted && !tooLong && !tooShort;
      const message = element.validationMessage || (tooLong ? `excede maxlength=${element.maxLength}` : tooShort ? `abaixo de minlength=${element.minLength}` : !valueWasAccepted ? "tipo de valor rejeitado" : "");
      results.push({ name, attemptedLength: [...value].length, actualLength: [...element.value].length, accepted, message });
      await delay(25);
    }
    setNativeValue(element, original.value);
    if ("checked" in element) element.checked = original.checked;
    return results;
  }

  async function waitForSelector(selector, timeout = 5_000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const element = document.querySelector(selector);
      if (element) return element;
      await delay(100);
    }
    throw new Error(`Elemento não encontrado: ${selector}`);
  }

  async function executeStep(step) {
    if (!step || isSensitiveSelector(step.selector)) throw new Error("Ação sensível bloqueada");
    if (step.action === "wait") return delay(step.ms);
    if (step.action === "scroll") { window.scrollTo({ top: Number(step.y) || 0, behavior: "smooth" }); return delay(250); }
    if (step.action === "fakerFill") { fillWithFakeData(step.scope === "form" ? document.querySelector("form") || document : document); return delay(100); }
    const element = await waitForSelector(step.selector);
    if (isSensitiveElement(element)) throw new Error("Campo sensível bloqueado");
    element.scrollIntoView({ block: "center", behavior: "smooth" });
    await delay(150);
    if (step.action === "click") element.click();
    else if (step.action === "fill" || step.action === "select") setNativeValue(element, step.value ?? "");
    else if (step.action === "check") { if (Boolean(element.checked) !== Boolean(step.checked)) element.click(); }
    else if (step.action === "press") element.dispatchEvent(new KeyboardEvent("keydown", { key: step.value || "Enter", bubbles: true }));
    else if (step.action === "multiClick") for (let index = 0; index < Math.min(100, Math.max(2, Number(step.count) || 2)); index += 1) { element.click(); await delay(step.interval); }
    else throw new Error(`Ação não permitida: ${step.action}`);
    await delay(100);
  }

  async function executeMacro(macro, onProgress = () => {}) {
    const steps = Array.isArray(macro?.steps) ? macro.steps.slice(0, 200) : [];
    for (const [index, step] of steps.entries()) { onProgress(index, step); await executeStep(step); }
    return { completed: steps.length };
  }

  function codeString(value) { return JSON.stringify(String(value ?? "")); }
  function generatePlaywrightCode(macro) {
    const lines = ["import { test, expect } from '@playwright/test';", "", `test(${codeString(macro?.name || "Macro QA")}, async ({ page }) => {`, `  await page.goto(${codeString(location.href)});`];
    for (const step of macro?.steps || []) {
      const locator = `page.locator(${codeString(step.selector)})`;
      if (step.action === "click") lines.push(`  await ${locator}.click();`);
      else if (step.action === "fill") lines.push(`  await ${locator}.fill(${codeString(step.value)});`);
      else if (step.action === "select") lines.push(`  await ${locator}.selectOption(${codeString(step.value)});`);
      else if (step.action === "check") lines.push(`  await ${locator}.${step.checked === false ? "uncheck" : "check"}();`);
      else if (step.action === "press") lines.push(`  await ${locator}.press(${codeString(step.value || "Enter")});`);
      else if (step.action === "wait") lines.push(`  await page.waitForTimeout(${Number(step.ms) || 500});`);
      else if (step.action === "scroll") lines.push(`  await page.evaluate((y) => window.scrollTo(0, y), ${Number(step.y) || 0});`);
      else if (step.action === "multiClick") lines.push(`  for (let i = 0; i < ${Number(step.count) || 2}; i++) { await ${locator}.click(); await page.waitForTimeout(${Number(step.interval) || 100}); }`);
      else if (step.action === "fakerFill") {
        lines.push("  // Faker Fill equivalente, local e sem campos sensíveis.");
        lines.push("  for (const field of await page.locator('input:not([type=hidden]):not([type=password]):not([type=file]):visible, textarea:visible').all()) {");
        lines.push("    const hint = `${await field.getAttribute('name') || ''} ${await field.getAttribute('type') || ''}`.toLowerCase();");
        lines.push("    if (/card|token|secret|cvv|cvc/.test(hint)) continue;");
        lines.push("    await field.fill(hint.includes('email') ? 'qa.teste@example.com' : 'Teste QA');");
        lines.push("  }");
      }
    }
    lines.push("});");
    return lines.join("\n");
  }

  window.QTS_QA_TOOLS = Object.freeze({ countCharacters, isSensitiveElement, isSensitiveSelector, uniqueSelector, inspectInput, runInputValidation, fillWithFakeData, fillSingleField, executeStep, executeMacro, generatePlaywrightCode, delay });
})();
