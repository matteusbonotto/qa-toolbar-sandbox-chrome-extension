// Classic-script storage/normalization twin used by options and content pages.
(() => {
  const STORAGE_KEYS = Object.freeze({
    workspace: "qtsWorkspaceV1",
    siteScope: "qtsSiteScopeV1",
    uiState: "qtsUiStateV1",
    authSession: "qtsAuthSessionV1",
    accessStatus: "qtsAccessStatusV1",
  });
  const FEATURE_REGISTRY = Object.freeze([
    ["testStatus","Status do teste","statusMenuItem","checkSquare",""],
    ["clickSpy","Clique espião","clickSpyMenuItem","mouse",""],["freezeClock","Parar tempo","freezeClockMenuItem","freezeClock",""],
    ["forceHttp","Simular HTTP","forceHttpMenuItem","forceHttp",""],["errorMonitor","Monitor de erros","errorMonitorMenuItem","errorMonitor",""],
    ["inspectors","Monitor de endpoint","inspectorsMenuItem","inspectors",""],["jsonStudio","JSON Studio","jsonStudioMenuItem","braces",""],
    ["breakpoints","Simulador de dispositivos","breakpointMenuItem","breakpointViewer",""],["testAccounts","Usuários e contas","testAccountsMenuItem","key",""],
    ["paymentMethods","Meios de pagamento","paymentMethodsMenuItem","paymentMethods",""],["resources","Recursos e links","resourcesMenuItem","resources",""],
    ["characterCounter","Contador de caracteres","characterCounterMenuItem","characterCounter","characterCounter.enabled"],
    ["macroStudio","Macros","macroStudioMenuItem","macroStudio","macroStudio.enabled"],
    ["multiClick","Multiclick","multiClickMenuItem","multiClick","multiClick.enabled"],["inputLab","Validador de campos","inputLabMenuItem","inputLab","inputLab.enabled"],
    ["fakerFill","Auto preenchimento","fakerFillMenuItem","fakerFill","fakerFill.enabled"],["keyView","Teclas e mouse","keyViewMenuItem","keyView","keyView.enabled"],
    ["elementCapture","Elementos da página","elementCaptureMenuItem","elementCapture","elementCapture.enabled"],
    ["blurElements","Borrar elementos","blurElementsMenuItem","eyeSlash",""],["holofote","Holofote","holofoteMenuItem","lightbulb",""],
    ["stepsRecorder","Roteiros de teste","stepsRecorderMenuItem","stepsRecorder","stepsRecorder.enabled"],
    ["languageValidator","Validador de textos/i18n","languageValidatorMenuItem","braces",""],
    ["qrCode","QR Code","qrCodeMenuItem","qrCode",""],
    ["pixelPerfect","Régua","pixelPerfectMenuItem","ruler",""],
    ["testSession","Sessões de teste","testSessionMenuItem","wait",""],
    ["reportBuilder","Relatórios","reportBuilderMenuItem","edit",""],
  ].map(([key,label,menuItemId,icon,planFeature]) => Object.freeze({ key,label,menuItemId,icon,planFeature:planFeature || null,pinnable:true })));
  const DEFAULT_ENABLED_TOOLS = Object.freeze(FEATURE_REGISTRY.map((feature) => feature.key));
  const PINNABLE_TOOLS = new Set(DEFAULT_ENABLED_TOOLS);
  const SCHEMA_3_TOOLS = ["characterCounter", "macroStudio", "multiClick", "inputLab", "fakerFill"];
  const SCHEMA_4_TOOLS = ["keyView"];
  const SCHEMA_5_TOOLS = ["errorMonitor"];
  const SCHEMA_6_TOOLS = ["elementCapture"];
  const SCHEMA_7_TOOLS = ["blurElements"];
  const SCHEMA_8_TOOLS = ["holofote"];
  const SCHEMA_11_TOOLS = ["stepsRecorder"];
  const SCHEMA_12_TOOLS = ["pixelPerfect"];
  const SCHEMA_13_TOOLS = ["testStatus"];
  const SCHEMA_14_TOOLS = ["testSession"];
  const SCHEMA_15_TOOLS = ["reportBuilder"];
  const DEMO_CLIENT_ID = "qts-demo-client";
  const DEMO_PROJECT_ID = "qts-demo-project";
  const DEMO_PRODUCT_ID = "qts-demo-product";
  const DEMO_ENVIRONMENT_ID = "qts-demo-env";
  const DEMO_URL_BINDING_ID = "qts-demo-url-binding";
  const DEMO_SITE_URL_PATTERN = "https://matteusbonotto.github.io/qa-toolbar-sandbox-chrome-extension/sandbox/*";
  const KEY_VIEW_POSITIONS = new Set(["top-left", "top-center", "top-right", "middle-left", "middle-center", "middle-right", "bottom-left", "bottom-center", "bottom-right"]);
  const KEY_VIEW_SIZES = new Set(["small", "medium", "large"]);
  const MACRO_ACTIONS = new Set(["click", "fill", "select", "check", "press", "wait", "scroll", "multiClick", "fakerFill"]);
  const SENSITIVE_HINT = /(?:passw(?:or)?d|senha|secret|token|authorization|auth[_-]?key|api[_-]?key|card|cart[aã]o|credit|debit|cc(?:num|number)?|cvv|cvc|security[_-]?code)/i;
  const STEP_ACTIONS = new Set(["start", "click", "contextmenu", "input", "submit", "navigation", "manual"]);
  const STEP_KEYWORDS = new Set(["given", "and", "when", "then"]);
  const STEP_LOCALES = new Set(["pt-BR", "es", "en"]);
  const text = (value, maximum = 500) =>
    String(value ?? "")
      .trim()
      .slice(0, maximum);
  const id = (value, prefix, index) => text(value, 120).replace(/[^a-z0-9_-]/gi, "_") || `${prefix}_${index + 1}`;
  const IMAGE_VALUE_MAX_CHARS = 300000;
  const appearance = (item) => {
    const logoUrl = text(item?.logoUrl ?? item?.logo ?? item?.imageUrl, IMAGE_VALUE_MAX_CHARS);
    const abbreviation = text(item?.abbreviation ?? item?.shortName ?? item?.code, 4).toUpperCase();
    return {
      ...(logoUrl ? { logoUrl } : {}),
      ...(abbreviation ? { abbreviation } : {}),
      showLabel: item?.showLabel !== false,
      active: item?.active !== false,
    };
  };
  // See storage.js's twin of this function for the full rationale: re-asserted on every
  // normalization pass (edit, delete attempt, or a whole-workspace import) so the demo
  // Toolbar/Sandbox/STAGE entities can never actually disappear once seeded.
  const ensureLockedEntity = (list, entityId, fields) => {
    const existing = list.find((item) => item.id === entityId);
    if (existing) Object.assign(existing, fields, { locked: true });
    else list.unshift({ id: entityId, ...appearance({}), ...fields, locked: true });
  };
  const CUSTOM_FIELD_TYPES = new Set(["string", "boolean", "number"]);
  function normalizeCustomFields(input) {
    return (Array.isArray(input) ? input : [])
      .slice(0, 20)
      .map((field, index) => {
        const type = CUSTOM_FIELD_TYPES.has(field?.type) ? field.type : "string";
        const key = text(field?.key ?? field?.label, 40) || `campo_${index + 1}`;
        let value;
        if (type === "boolean") value = field?.value === true;
        else if (type === "number") value = Number.isFinite(Number(field?.value)) ? Number(field.value) : 0;
        else value = text(field?.value, 200);
        return { key, type, value };
      })
      .filter((field) => field.key);
  }
  function normalizeIdArray(rawArray, rawSingular, validEntities) {
    const source = Array.isArray(rawArray) ? rawArray : rawSingular != null ? [rawSingular] : [];
    const validIds = new Set(validEntities.map((entity) => entity.id));
    return [...new Set(source.map((value) => text(value, 120)))].filter((value) => validIds.has(value));
  }
  // Keep in sync with storage.js's twin of these - "sistema operacional"/"navegador" catalogs and
  // "dispositivo" records that pick freely from both (schemaVersion 17).
  function normalizeCatalogEntries(input, prefix) {
    return (Array.isArray(input) ? input : []).slice(0, 200).map((item, index) => ({
      id: id(item?.id, prefix, index),
      name: text(item?.name ?? item?.label, 60) || `Item ${index + 1}`,
      icon: text(item?.icon, IMAGE_VALUE_MAX_CHARS),
      active: item?.active !== false,
    }));
  }
  const platformIcon = (name) => globalThis.chrome?.runtime?.getURL?.(`src/assets/platforms/${name}.png`) || `/src/assets/platforms/${name}.png`;
  const DEFAULT_OPERATING_SYSTEMS = Object.freeze([
    Object.freeze({ id: "operatingSystem_windows", name: "Windows", icon: platformIcon("windows"), active: true }),
    Object.freeze({ id: "operatingSystem_macos", name: "macOS", icon: platformIcon("macos"), active: true }),
    Object.freeze({ id: "operatingSystem_linux", name: "Linux", icon: platformIcon("linux"), active: true }),
    Object.freeze({ id: "operatingSystem_android", name: "Android", icon: platformIcon("android"), active: true }),
    Object.freeze({ id: "operatingSystem_ios", name: "iOS", icon: platformIcon("ios"), active: true }),
  ]);
  const DEFAULT_BROWSERS = Object.freeze([
    Object.freeze({ id: "browser_chrome", name: "Chrome", icon: platformIcon("chrome"), active: true }),
    Object.freeze({ id: "browser_firefox", name: "Firefox", icon: platformIcon("firefox"), active: true }),
    Object.freeze({ id: "browser_safari", name: "Safari", icon: platformIcon("safari"), active: true }),
    Object.freeze({ id: "browser_edge", name: "Edge", icon: platformIcon("edge"), active: true }),
  ]);
  const DEFAULT_PAYMENT_METHOD_TYPES = Object.freeze([
    Object.freeze({ id: "paymentMethodType_card", name: "Cartão", icon: "", active: true }),
    Object.freeze({ id: "paymentMethodType_pix", name: "PIX", icon: "", active: true }),
    Object.freeze({ id: "paymentMethodType_bank", name: "Conta bancária", icon: "", active: true }),
    Object.freeze({ id: "paymentMethodType_other", name: "Outro", icon: "", active: true }),
  ]);
  const LEGACY_PAYMENT_METHOD_TYPE_IDS = Object.freeze({
    card: "paymentMethodType_card",
    pix: "paymentMethodType_pix",
    bank: "paymentMethodType_bank",
    other: "paymentMethodType_other",
  });
  function resolveCatalogId(catalog, name) {
    const needle = text(name, 60).toLowerCase();
    if (!needle) return "";
    return catalog.find((entry) => entry.name.toLowerCase() === needle)?.id || "";
  }
  function deriveAccountTypesFromLegacyTestAccounts(rawTestAccounts) {
    const seen = new Map();
    for (const item of Array.isArray(rawTestAccounts) ? rawTestAccounts : []) {
      const name = text(item?.accountType, 60);
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.set(name.toLowerCase(), {
        id: id(null, "accountType", seen.size),
        name,
        icon: text(item?.accountTypeImage, IMAGE_VALUE_MAX_CHARS),
        active: true,
      });
    }
    return [...seen.values()];
  }
  function normalizeDevice(item, index, operatingSystems, browsers) {
    return {
      id: id(item?.id, "device", index),
      label: text(item?.label, 120) || `Dispositivo ${index + 1}`,
      operatingSystemIds: normalizeIdArray(item?.operatingSystemIds, null, operatingSystems),
      browserIds: normalizeIdArray(item?.browserIds, null, browsers),
      notes: text(item?.notes, 1000),
      active: item?.active !== false,
    };
  }
  function normalizeTestAccount(item, index, environments, products, accountTypes) {
    const environmentIds = normalizeIdArray(item?.environmentIds, item?.environmentId, environments);
    if (!environmentIds.length) return null;
    const accountTypeId = accountTypes.some((entry) => entry.id === item?.accountTypeId)
      ? item.accountTypeId
      : resolveCatalogId(accountTypes, item?.accountType);
    return {
      id: id(item?.id, "testAccount", index),
      environmentIds,
      productIds: normalizeIdArray(item?.productIds, item?.productId ?? item?.product_id, products),
      label: text(item?.label, 120) || `Conta ${index + 1}`,
      accountType: text(item?.accountType, 60),
      accountTypeImage: text(item?.accountTypeImage, IMAGE_VALUE_MAX_CHARS),
      accountTypeId,
      username: text(item?.username, 200),
      password: text(item?.password, 200),
      notes: text(item?.notes, 1000),
      customFields: normalizeCustomFields(item?.customFields),
      active: item?.active !== false,
    };
  }
  function normalizeUrlPatterns(input) {
    const values = Array.isArray(input) ? input : String(input ?? "").split(/[\n,]/);
    const output = [];
    for (const raw of values.flat(3)) {
      let value = text(raw, 2048);
      if (!value) continue;
      if (!value.includes("://") && !value.startsWith("*")) value = `*://${value.replace(/^\/+/, "")}`;
      if (!value.includes("*")) {
        try {
          const url = new URL(value);
          url.hash = "";
          url.search = "";
          value = url.pathname === "/" ? `${url.origin}/*` : `${url.href.replace(/\/$/, "")}*`;
        } catch {}
      } else if (/^(?:[a-z]+|\*):\/\/[^/]+$/i.test(value)) value += "/*";
      if (!output.includes(value)) output.push(value);
    }
    return output.slice(0, 100);
  }
  function createEmptyWorkspace() {
    return {
      schemaVersion: 18,
      updatedAt: new Date().toISOString(),
      clients: [],
      projects: [],
      products: [],
      environments: [],
      urlBindings: [],
      testAccounts: [],
      paymentMethods: [],
      apis: [],
      inspectors: [],
      resources: [],
      macros: [],
      stepRecordings: [],
      operatingSystems: DEFAULT_OPERATING_SYSTEMS.map((entry) => ({ ...entry })),
      browsers: DEFAULT_BROWSERS.map((entry) => ({ ...entry })),
      devices: [],
      accountTypes: [],
      paymentMethodTypes: DEFAULT_PAYMENT_METHOD_TYPES.map((entry) => ({ ...entry })),
      preferences: {
        language: "pt-BR",
        appearanceTheme: "light",
        colorTheme: "blue-light",
        drawerPosition: "right",
        toolbarPosition: "top",
        mobileDrawerPosition: "bottom",
        mobileToolbarPosition: "top",
        pushSiteContent: true,
        pushSiteContentForDrawer: false,
        compactMode: false,
        compactEntities: { client: false, project: false, product: false },
        avatarShape: "square",
        pinnedTools: [],
        pinnedMacroIds: [],
        enabledTools: [...DEFAULT_ENABLED_TOOLS],
        toolsMenuOrder: [...DEFAULT_ENABLED_TOOLS],
        toolsSortMode: "custom",
        toolUsageCounts: {},
        customShortcuts: {},
        demoWorkspaceSeeded: false,
        soundEffects: true,
        remindTestStatusOnRecording: false,
        breadcrumbVisibility: {
          client: true,
          project: true,
          product: true,
          environment: true,
        },
        breadcrumbOrder: ["client", "project", "product"],
        keyView: {
          enabled: false,
          typingMode: false,
          theme: "dark",
          position: "bottom-center",
          mouseEffects: true,
          keySize: "medium",
          mouseSize: "medium",
        },
      },
    };
  }
  // Environment used to require exactly one Product (name+color+urlPatterns+productId), so a
  // multi-country import created "DEV AR", "DEV BO"... instead of one reusable "DEV". Now the
  // Product association lives on each URL binding instead (see normalizeUrlBindings below).
  function normalizeUrlBinding(item, index, products, environments) {
    const patterns = normalizeUrlPatterns(Array.isArray(item?.patterns) ? item.patterns : item?.pattern != null ? [item.pattern] : []);
    if (!patterns.length) return null;
    const productId = id(item?.productId ?? item?.product_id, "product", 0);
    if (!products.some((product) => product.id === productId)) return null;
    const environmentIds = [...new Set((Array.isArray(item?.environmentIds) ? item.environmentIds : []).map((value) => text(value, 120)))].filter((environmentId) => environments.some((environment) => environment.id === environmentId));
    if (!environmentIds.length) return null;
    return {
      id: id(item?.id, "binding", index),
      patterns,
      productId,
      environmentIds,
      primaryUrl: /^https?:\/\//i.test(text(item?.primaryUrl, 2048)) ? text(item?.primaryUrl, 2048) : "",
      displayMode: item?.displayMode === "relative" ? "relative" : "full",
      label: text(item?.label, 120),
      active: item?.active !== false,
    };
  }
  function migrateLegacyEnvironmentUrls(source, products, environments) {
    const rows = [];
    for (const rawEnvironment of Array.isArray(source.environments) ? source.environments : []) {
      const legacyProductId = id(rawEnvironment?.productId ?? rawEnvironment?.product_id, "product", 0);
      if (!products.some((product) => product.id === legacyProductId)) continue;
      const legacyEnvironmentId = id(rawEnvironment?.id, "env", 0);
      if (!environments.some((environment) => environment.id === legacyEnvironmentId)) continue;
      const legacyPatterns = normalizeUrlPatterns(rawEnvironment?.urlPatterns ?? rawEnvironment?.urls ?? rawEnvironment?.domains ?? rawEnvironment?.url ?? rawEnvironment?.baseUrl);
      if (!legacyPatterns.length) continue;
      const legacyPrimaryUrl = text(rawEnvironment?.primaryUrl, 2048);
      rows.push({
        patterns: legacyPatterns,
        productId: legacyProductId,
        environmentIds: [legacyEnvironmentId],
        primaryUrl: legacyPatterns.length === 1 ? legacyPrimaryUrl : "",
      });
    }
    return rows;
  }
  function normalizeUrlBindings(source, products, environments) {
    const bindings = [];
    const byKey = new Map();
    const rawRows = [...(Array.isArray(source.urlBindings) ? source.urlBindings : []), ...(Number(source.schemaVersion || 0) < 7 ? migrateLegacyEnvironmentUrls(source, products, environments) : [])];
    for (const rawRow of rawRows) {
      const binding = normalizeUrlBinding(rawRow, bindings.length, products, environments);
      if (!binding) continue;
      const key = `${binding.productId}|${[...binding.environmentIds].sort().join(",")}`;
      const existing = byKey.get(key);
      if (existing) {
        for (const pattern of binding.patterns) if (!existing.patterns.includes(pattern)) existing.patterns.push(pattern);
        if (!existing.primaryUrl && binding.primaryUrl) existing.primaryUrl = binding.primaryUrl;
        continue;
      }
      byKey.set(key, binding);
      bindings.push(binding);
    }
    return bindings;
  }
  const BREADCRUMB_ORDER_KEYS = ["client", "project", "product"];
  function normalizeBreadcrumbOrder(value) {
    const seen = new Set();
    const order = (Array.isArray(value) ? value : []).filter((key) => BREADCRUMB_ORDER_KEYS.includes(key) && !seen.has(key) && seen.add(key));
    for (const key of BREADCRUMB_ORDER_KEYS) if (!order.includes(key)) order.push(key);
    return order;
  }
  function normalizeToolsMenuOrder(value) {
    const seen = new Set();
    const order = (Array.isArray(value) ? value : []).filter((key) => DEFAULT_ENABLED_TOOLS.includes(key) && !seen.has(key) && seen.add(key));
    for (const key of DEFAULT_ENABLED_TOOLS) if (!order.includes(key)) order.push(key);
    return order;
  }
  const TOOLS_SORT_MODES = new Set(["custom", "az", "za", "mostUsed"]);
  function normalizeToolsSortMode(value) {
    return TOOLS_SORT_MODES.has(value) ? value : "custom";
  }
  function normalizeToolUsageCounts(value) {
    const source = value && typeof value === "object" ? value : {};
    const counts = {};
    for (const key of DEFAULT_ENABLED_TOOLS) {
      const count = Number(source[key]);
      if (Number.isFinite(count) && count > 0) counts[key] = Math.min(Math.floor(count), 1_000_000);
    }
    return counts;
  }
  function normalizeKeyView(value) {
    const source = value && typeof value === "object" ? value : {};
    return {
      enabled: source.enabled === true,
      typingMode: source.typingMode === true,
      theme: source.theme === "light" ? "light" : "dark",
      position: KEY_VIEW_POSITIONS.has(source.position) ? source.position : "bottom-center",
      mouseEffects: source.mouseEffects !== false,
      keySize: KEY_VIEW_SIZES.has(source.keySize) ? source.keySize : "medium",
      mouseSize: KEY_VIEW_SIZES.has(source.mouseSize) ? source.mouseSize : "medium",
    };
  }
  function normalizeStep(item) {
    if (!item || typeof item !== "object" || !MACRO_ACTIONS.has(item.action)) return null;
    const selector = text(item.selector, 1000);
    if (selector && SENSITIVE_HINT.test(selector)) return null;
    const step = { action: item.action };
    if (selector) step.selector = selector;
    if (["fill", "select", "press"].includes(item.action)) {
      const value = text(item.value, 2000);
      if (SENSITIVE_HINT.test(value) && item.action !== "press") return null;
      step.value = value;
    }
    if (item.action === "check") step.checked = item.checked !== false;
    if (item.action === "wait") step.ms = Math.min(30000, Math.max(0, Number(item.ms) || 500));
    if (item.action === "scroll") step.y = Math.min(100000, Math.max(-100000, Number(item.y) || 0));
    if (item.action === "multiClick") {
      step.count = Math.min(100, Math.max(2, Number(item.count) || 2));
      step.interval = Math.min(5000, Math.max(0, Number(item.interval) || 100));
    }
    if (item.action === "fakerFill") step.scope = item.scope === "form" ? "form" : "page";
    return step;
  }
  function normalizeMacros(input) {
    return (Array.isArray(input) ? input : []).slice(0, 100).map((item, index) => ({
      id: id(item?.id, "macro", index),
      name: text(item?.name, 100) || `Macro ${index + 1}`,
      description: text(item?.description, 500),
      createdAt: text(item?.createdAt, 40) || new Date().toISOString(),
      updatedAt: text(item?.updatedAt, 40) || new Date().toISOString(),
      steps: (Array.isArray(item?.steps) ? item.steps : []).slice(0, 200).map(normalizeStep).filter(Boolean),
    }));
  }
  function normalizeStepRecordingStep(item, index) {
    if (!item || typeof item !== "object") return null;
    const action = STEP_ACTIONS.has(item.action) ? item.action : "manual";
    const target = text(item.target ?? item.selector, 1000);
    const targetKey = text(item.targetKey, 1000);
    const sensitive = item.sensitive === true || SENSITIVE_HINT.test(target);
    const value = sensitive ? "" : text(item.value, 2000);
    return {
      id: id(item.id, "step", index),
      keyword: STEP_KEYWORDS.has(item.keyword) ? item.keyword : index === 0 ? "given" : "and",
      action,
      text: sensitive && action === "input" ? "[valor protegido]" : text(item.text, 2000),
      expectedResult: text(item.expectedResult, 2000),
      url: text(item.url, 2048),
      createdAt: text(item.createdAt, 40) || new Date().toISOString(),
      ...(target ? { target } : {}),
      ...(targetKey ? { targetKey } : {}),
      ...(value ? { value } : {}),
      ...(typeof item.checked === "boolean" ? { checked: item.checked } : {}),
      ...(sensitive ? { sensitive: true } : {}),
    };
  }
  function normalizeStepRecordings(input) {
    return (Array.isArray(input) ? input : []).slice(0, 100).map((item, index) => {
      const rawContext = item?.context && typeof item.context === "object" ? item.context : {};
      const context = Object.fromEntries(["client", "project", "product", "environment", "url"]
        .map((key) => [key, text(rawContext[key], key === "url" ? 2048 : 160)])
        .filter(([, value]) => value));
      return {
        id: id(item?.id, "stepRecording", index),
        name: text(item?.name, 120) || `Roteiro ${index + 1}`,
        mode: item?.mode === "gherkin" ? "gherkin" : "numbered",
        locale: STEP_LOCALES.has(item?.locale) ? item.locale : "pt-BR",
        createdAt: text(item?.createdAt, 40) || new Date().toISOString(),
        updatedAt: text(item?.updatedAt, 40) || new Date().toISOString(),
        deviceId: text(item?.deviceId, 160),
        mediaMode: ["video", "gif"].includes(item?.mediaMode) ? item.mediaMode : "",
        ...(Object.keys(context).length ? { context } : {}),
        steps: (Array.isArray(item?.steps) ? item.steps : []).slice(0, 200).map(normalizeStepRecordingStep).filter(Boolean),
      };
    });
  }
  function normalizeWorkspace(rawWorkspace) {
    const source = rawWorkspace && typeof rawWorkspace === "object" ? rawWorkspace : {};
    const empty = createEmptyWorkspace();
    const clients = (Array.isArray(source.clients) ? source.clients : []).map((item, index) => ({
      id: id(item?.id, "client", index),
      name: text(item?.name ?? item?.label, 120) || `Cliente ${index + 1}`,
      ...appearance(item),
    }));
    const projects = (Array.isArray(source.projects) ? source.projects : [])
      .map((item, index) => ({
        id: id(item?.id, "project", index),
        clientId: id(item?.clientId ?? item?.client_id, "client", 0),
        name: text(item?.name ?? item?.label, 120) || `Projeto ${index + 1}`,
        ...appearance(item),
      }))
      .filter((item) => clients.some((client) => client.id === item.clientId));
    const products = (Array.isArray(source.products) ? source.products : [])
      .map((item, index) => ({
        id: id(item?.id, "product", index),
        projectId: id(item?.projectId ?? item?.project_id, "project", 0),
        name: text(item?.name ?? item?.label, 120) || `Produto ${index + 1}`,
        ...appearance(item),
      }))
      .filter((item) => projects.some((project) => project.id === item.projectId));
    if (source.preferences?.demoWorkspaceSeeded === true) {
      ensureLockedEntity(clients, DEMO_CLIENT_ID, { name: "Toolbar" });
      ensureLockedEntity(projects, DEMO_PROJECT_ID, { name: "Sandbox", clientId: DEMO_CLIENT_ID });
      ensureLockedEntity(products, DEMO_PRODUCT_ID, { name: "STAGE", projectId: DEMO_PROJECT_ID });
    }
    const environments = (Array.isArray(source.environments) ? source.environments : []).map((item, index) => {
      const rawColor = text(item?.color ?? item?.backgroundColor, 7);
      return {
        id: id(item?.id, "env", index),
        name: text(item?.name ?? item?.label ?? item?.environment, 80) || `Ambiente ${index + 1}`,
        color: /^#[0-9a-f]{6}$/i.test(rawColor) ? rawColor : "#3a3a3a",
        active: item?.active !== false,
      };
    });
    if (source.preferences?.demoWorkspaceSeeded === true) {
      ensureLockedEntity(environments, DEMO_ENVIRONMENT_ID, { name: "QA", color: "#5b21b6" });
    }
    const urlBindings = normalizeUrlBindings(source, products, environments);
    if (source.preferences?.demoWorkspaceSeeded === true) {
      ensureLockedEntity(urlBindings, DEMO_URL_BINDING_ID, { patterns: [DEMO_SITE_URL_PATTERN], productId: DEMO_PRODUCT_ID, environmentIds: [DEMO_ENVIRONMENT_ID], primaryUrl: "" });
    }
    const copy = (key) =>
      (Array.isArray(source[key]) ? source[key] : []).map((item, index) => ({
        ...item,
        id: id(item?.id, key.replace(/s$/, ""), index),
        active: item?.active !== false,
      }));
    const preferences = source.preferences && typeof source.preferences === "object" ? source.preferences : {};
    const normalizedEnabledTools = Array.isArray(preferences.enabledTools) ? preferences.enabledTools.map((value) => text(value, 40)).filter((value) => DEFAULT_ENABLED_TOOLS.includes(value)) : [...empty.preferences.enabledTools];
    if (Number(source.schemaVersion || 0) < 3) for (const tool of SCHEMA_3_TOOLS) if (!normalizedEnabledTools.includes(tool)) normalizedEnabledTools.push(tool);
    if (Number(source.schemaVersion || 0) < 4) for (const tool of SCHEMA_4_TOOLS) if (!normalizedEnabledTools.includes(tool)) normalizedEnabledTools.push(tool);
    if (Number(source.schemaVersion || 0) < 5) for (const tool of SCHEMA_5_TOOLS) if (!normalizedEnabledTools.includes(tool)) normalizedEnabledTools.push(tool);
    if (Number(source.schemaVersion || 0) < 6) for (const tool of SCHEMA_6_TOOLS) if (!normalizedEnabledTools.includes(tool)) normalizedEnabledTools.push(tool);
    if (Number(source.schemaVersion || 0) < 7) for (const tool of SCHEMA_7_TOOLS) if (!normalizedEnabledTools.includes(tool)) normalizedEnabledTools.push(tool);
    if (Number(source.schemaVersion || 0) < 8) for (const tool of SCHEMA_8_TOOLS) if (!normalizedEnabledTools.includes(tool)) normalizedEnabledTools.push(tool);
    if (Number(source.schemaVersion || 0) < 11) for (const tool of SCHEMA_11_TOOLS) if (!normalizedEnabledTools.includes(tool)) normalizedEnabledTools.push(tool);
    if (Number(source.schemaVersion || 0) < 12) for (const tool of SCHEMA_12_TOOLS) if (!normalizedEnabledTools.includes(tool)) normalizedEnabledTools.push(tool);
    if (Number(source.schemaVersion || 0) < 13) for (const tool of SCHEMA_13_TOOLS) if (!normalizedEnabledTools.includes(tool)) normalizedEnabledTools.push(tool);
    if (Number(source.schemaVersion || 0) < 14) for (const tool of SCHEMA_14_TOOLS) if (!normalizedEnabledTools.includes(tool)) normalizedEnabledTools.push(tool);
    if (Number(source.schemaVersion || 0) < 15) for (const tool of SCHEMA_15_TOOLS) if (!normalizedEnabledTools.includes(tool)) normalizedEnabledTools.push(tool);
    let operatingSystems = normalizeCatalogEntries(source.operatingSystems, "operatingSystem");
    let browsers = normalizeCatalogEntries(source.browsers, "browser");
    if (Number(source.schemaVersion || 0) < 17) {
      if (!operatingSystems.length) operatingSystems = DEFAULT_OPERATING_SYSTEMS.map((entry) => ({ ...entry }));
      if (!browsers.length) browsers = DEFAULT_BROWSERS.map((entry) => ({ ...entry }));
    }
    operatingSystems = operatingSystems.map((item) => item.icon && !item.icon.startsWith("data:image/svg+xml") ? item : { ...item, icon: DEFAULT_OPERATING_SYSTEMS.find((value) => value.id === item.id)?.icon || item.icon || "" });
    browsers = browsers.map((item) => item.icon && !item.icon.startsWith("data:image/svg+xml") ? item : { ...item, icon: DEFAULT_BROWSERS.find((value) => value.id === item.id)?.icon || item.icon || "" });
    let accountTypes = normalizeCatalogEntries(source.accountTypes, "accountType");
    let paymentMethodTypes = normalizeCatalogEntries(source.paymentMethodTypes, "paymentMethodType");
    if (Number(source.schemaVersion || 0) < 17) {
      for (const derived of deriveAccountTypesFromLegacyTestAccounts(source.testAccounts)) {
        if (!accountTypes.some((entry) => entry.name.toLowerCase() === derived.name.toLowerCase())) accountTypes.push(derived);
      }
      if (!paymentMethodTypes.length) paymentMethodTypes = DEFAULT_PAYMENT_METHOD_TYPES.map((entry) => ({ ...entry }));
    }
    return {
      ...empty,
      schemaVersion: 17,
      updatedAt: text(source.updatedAt, 40) || empty.updatedAt,
      clients,
      projects,
      products,
      environments,
      urlBindings,
      operatingSystems,
      browsers,
      accountTypes,
      paymentMethodTypes,
      devices: (Array.isArray(source.devices) ? source.devices : []).map((item, index) => normalizeDevice(item, index, operatingSystems, browsers)),
      testAccounts: (Array.isArray(source.testAccounts) ? source.testAccounts : []).map((item, index) => normalizeTestAccount(item, index, environments, products, accountTypes)).filter(Boolean),
      paymentMethods: copy("paymentMethods").map((item) => {
        // "number" was never a real field in this schema (the composers always write "value") -
        // it only shows up in records created outside the composer UI (a hand-built seed/import
        // file, for instance). Without this alias those cards silently render with no "Número" row
        // and nothing to copy, with no error to explain why. Keep in sync with storage.js.
        const { environmentId, productId, product_id, number, ...rest } = item;
        const legacyTypeId = LEGACY_PAYMENT_METHOD_TYPE_IDS[item?.type] || "";
        const typeId = paymentMethodTypes.some((entry) => entry.id === item?.typeId)
          ? item.typeId
          : (paymentMethodTypes.some((entry) => entry.id === legacyTypeId) ? legacyTypeId : "");
        return {
          ...rest,
          value: text(item?.value, 240) || text(number, 240),
          environmentIds: normalizeIdArray(item?.environmentIds, environmentId, environments),
          productIds: normalizeIdArray(item?.productIds, productId ?? product_id, products),
          typeId,
        };
      }),
      apis: copy("apis"),
      inspectors: copy("inspectors"),
      resources: copy("resources").map((item) => ({
        ...item,
        category: text(item?.category, 60),
      })),
      macros: normalizeMacros(source.macros),
      stepRecordings: normalizeStepRecordings(source.stepRecordings),
      preferences: {
        ...empty.preferences,
        ...preferences,
        compactMode: preferences.compactMode === true,
        compactEntities: {
          client: preferences.compactEntities?.client === true,
          project: preferences.compactEntities?.project === true || (!preferences.compactEntities && preferences.compactMode === true),
          product: preferences.compactEntities?.product === true || (!preferences.compactEntities && preferences.compactMode === true),
        },
        pushSiteContent: preferences.pushSiteContent !== false,
        pushSiteContentForDrawer: preferences.pushSiteContentForDrawer === true,
        avatarShape: preferences.avatarShape === "round" ? "round" : "square",
        appearanceTheme: ["light", "dark"].includes(preferences.appearanceTheme) ? preferences.appearanceTheme : empty.preferences.appearanceTheme,
        colorTheme: text(preferences.colorTheme, 30) || empty.preferences.colorTheme,
        drawerPosition: ["left", "right", "top", "bottom"].includes(preferences.drawerPosition) ? preferences.drawerPosition : empty.preferences.drawerPosition,
        toolbarPosition: ["top", "bottom", "left", "right"].includes(preferences.toolbarPosition) ? preferences.toolbarPosition : empty.preferences.toolbarPosition,
        mobileDrawerPosition: ["left", "right", "top", "bottom"].includes(preferences.mobileDrawerPosition) ? preferences.mobileDrawerPosition : empty.preferences.mobileDrawerPosition,
        mobileToolbarPosition: ["top", "bottom", "left", "right"].includes(preferences.mobileToolbarPosition) ? preferences.mobileToolbarPosition : empty.preferences.mobileToolbarPosition,
        pinnedTools: Array.isArray(preferences.pinnedTools)
          ? [...new Set(preferences.pinnedTools.map((value) => text(value, 40)).map((value) => ({ blurMode: "blurElements", holofoteMode: "holofote" })[value] || value).filter((value) => PINNABLE_TOOLS.has(value)))].slice(0, 4)
          : empty.preferences.pinnedTools,
        pinnedMacroIds: Array.isArray(preferences.pinnedMacroIds)
          ? preferences.pinnedMacroIds
              .map((value) => text(value, 120))
              .filter(Boolean)
              .slice(0, 20)
          : [],
        enabledTools: normalizedEnabledTools,
        toolsMenuOrder: normalizeToolsMenuOrder(preferences.toolsMenuOrder),
        toolsSortMode: normalizeToolsSortMode(preferences.toolsSortMode),
        toolUsageCounts: normalizeToolUsageCounts(preferences.toolUsageCounts),
        customShortcuts: Object.fromEntries(Object.entries(preferences.customShortcuts && typeof preferences.customShortcuts === "object" ? preferences.customShortcuts : {}).filter(([key, shortcut]) => DEFAULT_ENABLED_TOOLS.includes(key) && /^(?:(?:Ctrl|Alt|Shift|Meta)\+)*[^+]{1,24}$/.test(String(shortcut))).slice(0, DEFAULT_ENABLED_TOOLS.length)),
        demoWorkspaceSeeded: preferences.demoWorkspaceSeeded === true,
        soundEffects: preferences.soundEffects !== false,
        remindTestStatusOnRecording: preferences.remindTestStatusOnRecording === true,
        breadcrumbVisibility: {
          client: preferences.breadcrumbVisibility?.client !== false,
          project: preferences.breadcrumbVisibility?.project !== false,
          product: preferences.breadcrumbVisibility?.product !== false,
          environment: preferences.breadcrumbVisibility?.environment !== false,
        },
        breadcrumbOrder: normalizeBreadcrumbOrder(preferences.breadcrumbOrder),
        keyView: normalizeKeyView(preferences.keyView),
      },
    };
  }
  const createDefaultSiteScope = () => ({ mode: "environments", patterns: [] });
  async function getWorkspace() {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.workspace);
    return normalizeWorkspace(stored[STORAGE_KEYS.workspace]);
  }
  async function saveWorkspace(workspace) {
    const next = normalizeWorkspace({
      ...workspace,
      updatedAt: new Date().toISOString(),
    });
    await chrome.storage.local.set({ [STORAGE_KEYS.workspace]: next });
    return next;
  }
  async function getSiteScope() {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.siteScope);
    const scope = stored[STORAGE_KEYS.siteScope];
    return scope && typeof scope === "object"
      ? {
          mode: ["custom", "all"].includes(scope.mode) ? scope.mode : "environments",
          patterns: normalizeUrlPatterns(scope.patterns),
        }
      : createDefaultSiteScope();
  }
  async function saveSiteScope(scope) {
    const next = {
      mode: ["custom", "all"].includes(scope?.mode) ? scope.mode : "environments",
      patterns: normalizeUrlPatterns(scope?.patterns),
    };
    await chrome.storage.local.set({ [STORAGE_KEYS.siteScope]: next });
    return next;
  }
  function onStorageChanged(callback) {
    const listener = (changes, areaName) => {
      if (areaName === "local") callback(changes);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }
  async function getTutorialProgress() {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.uiState);
    const tutorial = stored[STORAGE_KEYS.uiState]?.tutorial;
    return {
      completedSteps: Array.isArray(tutorial?.completedSteps) ? tutorial.completedSteps : [],
      dismissedBannerAt: text(tutorial?.dismissedBannerAt, 40) || null,
    };
  }
  async function saveTutorialCompletedStep(stepKey) {
    const current = await chrome.storage.local.get(STORAGE_KEYS.uiState);
    const uiState = current[STORAGE_KEYS.uiState] || {};
    const tutorial = uiState.tutorial || {};
    const completedSteps = Array.isArray(tutorial.completedSteps) ? tutorial.completedSteps : [];
    const nextCompletedSteps = completedSteps.includes(stepKey) ? completedSteps : [...completedSteps, stepKey];
    const nextTutorial = { ...tutorial, completedSteps: nextCompletedSteps };
    await chrome.storage.local.set({
      [STORAGE_KEYS.uiState]: { ...uiState, tutorial: nextTutorial },
    });
    return nextTutorial;
  }
  async function saveTutorialBannerDismissed() {
    const current = await chrome.storage.local.get(STORAGE_KEYS.uiState);
    const uiState = current[STORAGE_KEYS.uiState] || {};
    const nextTutorial = {
      ...(uiState.tutorial || {}),
      dismissedBannerAt: new Date().toISOString(),
    };
    await chrome.storage.local.set({
      [STORAGE_KEYS.uiState]: { ...uiState, tutorial: nextTutorial },
    });
    return nextTutorial;
  }
  window.QTS_STORAGE = Object.freeze({
    STORAGE_KEYS,
    FEATURE_REGISTRY,
    DEFAULT_ENABLED_TOOLS,
    createEmptyWorkspace,
    normalizeWorkspace,
    normalizeUrlPatterns,
    getWorkspace,
    saveWorkspace,
    createDefaultSiteScope,
    getSiteScope,
    saveSiteScope,
    onStorageChanged,
    getTutorialProgress,
    saveTutorialCompletedStep,
    saveTutorialBannerDismissed,
  });
})();
