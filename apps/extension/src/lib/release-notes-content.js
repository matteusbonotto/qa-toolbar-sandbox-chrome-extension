// What changed in each version, shown once after Chrome updates the extension (badge "NEW", toolbar
// bell and a one-time modal, plus the Settings dialog). Shared by toolbar.js and options.js as a
// classic script, like the other *-content.js files.
//
// Why a registry instead of one fixed text: the update notice used to be a single hardcoded list
// written for an old version, so every later update showed the same stale sentences (founder report
// 2026-10-23). Every release that changes something the user can see adds its entry here; a user who
// skipped versions sees the notes of every version after the one they had.
window.QTS_RELEASE_NOTES = (() => {
  const NOTES = Object.freeze([
    {
      version: "1.4.48",
      "pt-BR": [
        "Multi Testador: o convidado segue a página do host, e os cursores de todos aparecem na mesma tela, como no Figma e no Miro.",
        "Multi Testador: a confirmação de todos só é pedida em ações reais (botões, links e envios), não ao clicar em qualquer parte da página.",
        "Cursor personalizado mais leve: o ponteiro desenhado não trava mais o mouse.",
        "Depois de cada atualização, esta lista do que mudou abre sozinha uma vez.",
      ],
      en: [
        "Multi Tester: guests follow the host's page, and everyone's cursors show on the same screen, like in Figma and Miro.",
        "Multi Tester: everyone's confirmation is only asked for real actions (buttons, links and submits), not for a click anywhere on the page.",
        "Lighter custom cursor: the drawn pointer no longer makes the mouse lag.",
        "After each update, this list of what changed opens by itself once.",
      ],
      es: [
        "Multi Tester: el invitado sigue la página del anfitrión, y los cursores de todos aparecen en la misma pantalla, como en Figma y Miro.",
        "Multi Tester: la confirmación de todos solo se pide en acciones reales (botones, enlaces y envíos), no al hacer clic en cualquier parte de la página.",
        "Cursor personalizado más liviano: el puntero dibujado ya no traba el ratón.",
        "Después de cada actualización, esta lista de cambios se abre sola una vez.",
      ],
    },
    {
      version: "1.4.46",
      "pt-BR": [
        "Cursor personalizado: as cores do clique esquerdo, direito e do meio agora aparecem na prévia e no clique real.",
        "Novas cores de corpo e de linhas do mouse, para combinar do seu jeito, e o botão Restaurar padrão.",
        "Simulador de dispositivos: a tela de celular sempre se identifica como celular, inclusive ao navegar dentro dela.",
        "Com a barra em todos os sites, o logo do QA Toolbar Sandbox aparece no lugar do ambiente.",
      ],
      en: [
        "Custom cursor: left, right and middle click colors now show in the preview and on real clicks.",
        "New mouse body and line colors to mix your own look, plus a Restore defaults button.",
        "Device simulator: the phone view always identifies as a phone, even when you navigate inside it.",
        "With the toolbar on all sites, the QA Toolbar Sandbox logo shows in place of the environment.",
      ],
      es: [
        "Cursor personalizado: los colores del clic izquierdo, derecho y central ahora aparecen en la vista previa y en el clic real.",
        "Nuevos colores de cuerpo y líneas del ratón para combinar a tu manera, y el botón Restaurar predeterminado.",
        "Simulador de dispositivos: la vista de celular siempre se identifica como celular, incluso al navegar dentro de ella.",
        "Con la barra en todos los sitios, el logo de QA Toolbar Sandbox aparece en lugar del entorno.",
      ],
    },
    {
      version: "1.4.45",
      "pt-BR": [
        "O login lembra os e-mails que já entraram neste navegador.",
        "Com a barra em todos os sites, ela usa a cor do tema escolhido em Configurações.",
      ],
      en: [
        "Sign-in remembers the e-mails that already signed in on this browser.",
        "With the toolbar on all sites, it uses the theme color chosen in Settings.",
      ],
      es: [
        "El inicio de sesión recuerda los correos que ya entraron en este navegador.",
        "Con la barra en todos los sitios, usa el color del tema elegido en Configuración.",
      ],
    },
    {
      version: "1.4.44",
      "pt-BR": [
        "Multi Testador: cliques e envios dos convidados viram propostas para o host, e ações que salvam ou excluem esperam a aprovação de todos.",
      ],
      en: [
        "Multi Tester: guest clicks and submits become proposals for the host, and actions that save or delete wait for everyone's approval.",
      ],
      es: [
        "Multi Tester: los clics y envíos de los invitados se vuelven propuestas para el anfitrión, y las acciones que guardan o eliminan esperan la aprobación de todos.",
      ],
    },
  ]);

  const parse = (version) => String(version || "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const compare = (a, b) => {
    const left = parse(a);
    const right = parse(b);
    for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
      const diff = (left[index] || 0) - (right[index] || 0);
      if (diff) return diff;
    }
    return 0;
  };
  const localeKey = (locale) => {
    const value = String(locale || "pt-BR").toLowerCase();
    if (value.startsWith("en")) return "en";
    if (value.startsWith("es")) return "es";
    return "pt-BR";
  };

  const COPY = Object.freeze({
    "pt-BR": { title: (version) => `Atualizado para a versão ${version}`, intro: "Seus dados e configurações anteriores foram preservados. O que mudou:", fallback: "Melhorias de estabilidade e correções.", action: "Entendi" },
    en: { title: (version) => `Updated to version ${version}`, intro: "Your existing data and settings were preserved. What changed:", fallback: "Stability improvements and fixes.", action: "Got it" },
    es: { title: (version) => `Actualizado a la versión ${version}`, intro: "Tus datos y configuraciones anteriores se conservaron. Qué cambió:", fallback: "Mejoras de estabilidad y correcciones.", action: "Entendido" },
  });
  // A cap only so a user many versions behind does not get an endless list; 8 already cut the notes
  // of a user coming from 1.4.44 (1.4.46 and 1.4.47 filled it). The drawer scrolls.
  const MAX_ITEMS = 15;

  // Notes of every version after `previousVersion` up to `currentVersion`, newest first. Without a
  // previous version (unknown), only the current version's notes.
  function copyFor({ version, previousVersion, locale }) {
    const key = localeKey(locale);
    const copy = COPY[key];
    const entries = NOTES.filter((entry) => compare(entry.version, version) <= 0 && (previousVersion ? compare(entry.version, previousVersion) > 0 : compare(entry.version, version) === 0));
    const items = entries.flatMap((entry) => entry[key] || entry["pt-BR"]).slice(0, MAX_ITEMS);
    return { title: copy.title(version || ""), intro: copy.intro, items: items.length ? items : [copy.fallback], action: copy.action };
  }

  return Object.freeze({ notes: NOTES, copyFor, compare });
})();
