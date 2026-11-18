// Regression for Auto Fill (qa-tools-content.js): one coherent person, country-matched names,
// birth date in the right format, selects filled, marketing consent never ticked, unlabeled
// fields skipped, and only values that really stuck are reported.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

const code = await readFile(new URL("../apps/extension/src/lib/qa-tools-content.js", import.meta.url), "utf8");
const dom = new JSDOM(`<form>
  <label>Nombre <input name="nombre"></label>
  <label>Apellido <input name="apellido"></label>
  <label>Email <input name="email" type="email"></label>
  <label>Fecha de nacimiento <input name="nacimiento" type="date"></label>
  <label>Fecha <input name="fecha_nac" placeholder="dd/mm/aaaa"></label>
  <label>Complejo <select name="complejo"><option value="">Elegir</option><option value="7">Palermo</option></select></label>
  <label>Acepto terminos <input type="checkbox" name="terms"></label>
  <label>Quiero recibir promociones y novedades <input type="checkbox" name="marketing_optin"></label>
  <input name="">
</form>`, { url: "https://www-beta.cinemark.com.ar/", runScripts: "outside-only" });
const { window } = dom;
window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20 });
window.crypto ??= (await import("node:crypto")).webcrypto;
window.eval(code);

const result = window.QTS_QA_TOOLS.fillWithFakeData(window.document);
const v = (name) => window.document.querySelector(`[name="${name}"]`);
assert.ok(!v("nombre").value.includes(" "), "Nombre gets only the first name");
assert.ok(v("apellido").value.length > 0);
assert.ok(v("email").value.startsWith(`${v("nombre").value}.`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()), "e-mail matches the same person");
assert.match(v("nacimiento").value, /^(19[7-9]\d|2000)-\d\d-\d\d$/);
assert.match(v("fecha_nac").value, /^\d\d\/\d\d\/(19[7-9]\d|2000)$/);
assert.equal(v("complejo").value, "7", "selects are filled");
assert.equal(v("terms").checked, true);
assert.equal(v("marketing_optin").checked, false, "marketing consent is never ticked");
assert.ok(!result.fields.some((field) => /Teste QA/.test(field.value ?? "")), "unlabeled inputs are not filled with filler text");
console.log("autofill ok");
assert.match(window.QTS_QA_TOOLS.expandMacroTokens('a-{{email}}-{{ timestamp }}'), /^a-qa\+\d+@example\.com-\d+$/);
console.log('macro tokens ok');
