// Classic-script twin of apps/landing/src/legal/legalRegistration.ts -- fetches the same public
// legal_registration row (via the legal-registration edge function, since this options page has
// no Supabase client of its own) and resolves it to display text. Local-first like the rest of
// the extension: caches the last known record so the section still renders if the backend is
// briefly unreachable, and never blocks the options page on this call.
(() => {
  const FUNCTIONS_BASE_URL = "https://xhusvkylbouwtpcevgri.supabase.co/functions/v1";
  const CACHE_KEY = "qtsLegalRegistrationV1";

  const STATUS_TEXT = {
    "pt-BR": {
      preparation: { title: "Registro de software em preparação", body: (r) => `O processo de registro de programa de computador da ${r.softwareName} está sendo preparado perante o INPI.` },
      payment_pending: { title: "Registro de software em andamento", body: (r) => `O processo de registro de programa de computador da ${r.softwareName} está em andamento perante o Instituto Nacional da Propriedade Industrial (INPI).` },
      protocolled: { title: "Pedido protocolado no INPI", body: (r, fmt) => `O pedido de registro de programa de computador da ${r.softwareName} foi protocolado no INPI sob o processo nº ${r.protocolNumber}, em ${fmt(r.protocolDate)}.` },
      registered: { title: "Programa de computador registrado no INPI", body: (r, fmt) => `${r.softwareName} é um programa de computador registrado no INPI sob o nº ${r.registrationNumber}, concedido em ${fmt(r.grantDate)}.`, disclaimer: "O registro refere-se à proteção jurídica do programa de computador e não representa certificação, homologação ou aprovação técnica pelo INPI." },
    },
    es: {
      preparation: { title: "Registro de software en preparación", body: (r) => `El proceso de registro de programa de computador de ${r.softwareName} está siendo preparado ante el INPI.` },
      payment_pending: { title: "Registro de software en curso", body: (r) => `El proceso de registro de programa de computador de ${r.softwareName} está en curso ante el INPI (Brasil).` },
      protocolled: { title: "Solicitud protocolada en el INPI", body: (r, fmt) => `La solicitud de registro de programa de computador de ${r.softwareName} fue protocolada en el INPI bajo el proceso nº ${r.protocolNumber}, el ${fmt(r.protocolDate)}.` },
      registered: { title: "Programa de computador registrado en el INPI", body: (r, fmt) => `${r.softwareName} es un programa de computador registrado en el INPI bajo el nº ${r.registrationNumber}, concedido el ${fmt(r.grantDate)}.`, disclaimer: "El registro se refiere a la protección jurídica del programa de computador y no representa certificación, homologación o aprobación técnica por parte del INPI." },
    },
    en: {
      preparation: { title: "Software registration in preparation", body: (r) => `The computer program registration process for ${r.softwareName} is being prepared with INPI (Brazil).` },
      payment_pending: { title: "Software registration in progress", body: (r) => `The computer program registration process for ${r.softwareName} is in progress with INPI (Brazil).` },
      protocolled: { title: "Application filed with INPI", body: (r, fmt) => `The registration application for ${r.softwareName} was filed with INPI under process no. ${r.protocolNumber}, on ${fmt(r.protocolDate)}.` },
      registered: { title: "Computer program registered with INPI", body: (r, fmt) => `${r.softwareName} is a computer program registered with INPI under no. ${r.registrationNumber}, granted on ${fmt(r.grantDate)}.`, disclaimer: "This registration concerns the legal protection of the computer program and does not represent certification, approval, or technical endorsement by INPI." },
    },
  };

  function formatDate(iso, locale) {
    if (!iso) return "";
    const tag = locale === "en" ? "en-US" : locale === "es" ? "es-ES" : "pt-BR";
    return new Date(`${iso}T00:00:00`).toLocaleDateString(tag);
  }

  function resolveStatusText(record, locale) {
    const dict = STATUS_TEXT[locale] || STATUS_TEXT["pt-BR"];
    const entry = dict[record.status] || dict.preparation;
    const fmt = (iso) => formatDate(iso, locale);
    return { title: entry.title, body: entry.body(record, fmt), disclaimer: entry.disclaimer };
  }

  async function fetchLegalRegistration({ force = false } = {}) {
    if (!force) {
      const stored = await chrome.storage.local.get(CACHE_KEY);
      const cached = stored[CACHE_KEY];
      if (cached && Date.now() - Number(cached.cachedAt || 0) < 6 * 60 * 60_000) return { ...cached.record, stale: false };
    }
    try {
      const response = await fetch(`${FUNCTIONS_BASE_URL}/legal-registration`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
        redirect: "error",
        credentials: "omit",
        referrerPolicy: "no-referrer",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.available) throw new Error("unavailable");
      await chrome.storage.local.set({ [CACHE_KEY]: { record: payload, cachedAt: Date.now() } });
      return { ...payload, stale: false };
    } catch {
      const stored = await chrome.storage.local.get(CACHE_KEY);
      const cached = stored[CACHE_KEY];
      return cached ? { ...cached.record, stale: true } : null;
    }
  }

  window.QTS_LEGAL = Object.freeze({ fetchLegalRegistration, resolveStatusText, formatDate });
})();
