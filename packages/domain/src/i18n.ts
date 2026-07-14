export type Locale = "pt-BR" | "en" | "es";
type Catalog = Record<string, string>;
const ptBR: Catalog = {
  "common.language": "Idioma", "common.settings": "Configuração", "common.account": "Minha conta", "common.plans": "Planos", "common.cancel": "Cancelar", "common.save": "Salvar", "common.delete": "Excluir", "common.edit": "Editar", "common.loading": "Aguarde...", "common.external": "Abrir externamente",
  "navigation.features": "Recursos", "navigation.security": "Segurança", "navigation.install": "Como instalar", "navigation.data": "Dados e reset", "navigation.breakpoints": "Breakpoints", "navigation.convertio": "Convertio e GIF",
  "landing.heroTitle": "Teste páginas reais com seu workspace de QA no navegador.", "landing.heroAction": "Verificar acesso e instalar", "landing.plansTitle": "Comece livre. Evolua quando fizer sentido.", "landing.monthly": "Mensal", "landing.yearly": "Anual", "landing.faq": "Perguntas frequentes", "landing.about": "Sobre",
  "auth.signIn": "Entrar", "auth.signUp": "Criar conta", "auth.email": "E-mail", "auth.password": "Senha", "auth.signOut": "Sair",
  "toolbar.ready": "PRONTO PARA TESTAR", "toolbar.tools": "Ferramentas", "toolbar.screenshot": "Capturar screenshot", "toolbar.record": "Iniciar gravação", "toolbar.stop": "Parar gravação", "toolbar.restore": "Mostrar QA Toolbar", "toolbar.hide": "Ocultar toolbar",
  "recording.paused": "Gravação pausada.", "recording.resumed": "Gravação retomada.", "recording.saved": "Evidência {format} salva.",
  "breakpoints.notice": "Esta visualização simula dimensões no navegador atual. Hardware, sistema operacional e navegador móvel podem se comportar de forma diferente em um dispositivo real.",
  "errors.items": "{count} erro", "errors.items_plural": "{count} erros", "plans.perMonth": "/ mês", "plans.discount": "economize {percent}%",
};
const en: Catalog = {
  "common.language": "Language", "common.settings": "Settings", "common.account": "My account", "common.plans": "Plans", "common.cancel": "Cancel", "common.save": "Save", "common.delete": "Delete", "common.edit": "Edit", "common.loading": "Please wait...", "common.external": "Open externally",
  "navigation.features": "Features", "navigation.security": "Security", "navigation.install": "How to install", "navigation.data": "Data and reset", "navigation.breakpoints": "Breakpoints", "navigation.convertio": "Convertio and GIF",
  "landing.heroTitle": "Test real pages with your QA workspace in the browser.", "landing.heroAction": "Verify access and install", "landing.plansTitle": "Start free. Upgrade when it makes sense.", "landing.monthly": "Monthly", "landing.yearly": "Yearly", "landing.faq": "Frequently asked questions", "landing.about": "About",
  "auth.signIn": "Sign in", "auth.signUp": "Create account", "auth.email": "Email", "auth.password": "Password", "auth.signOut": "Sign out",
  "toolbar.ready": "READY TO TEST", "toolbar.tools": "Tools", "toolbar.screenshot": "Capture screenshot", "toolbar.record": "Start recording", "toolbar.stop": "Stop recording", "toolbar.restore": "Show QA Toolbar", "toolbar.hide": "Hide toolbar",
  "recording.paused": "Recording paused.", "recording.resumed": "Recording resumed.", "recording.saved": "{format} evidence saved.",
  "breakpoints.notice": "This view simulates responsive dimensions in the current browser. Hardware, operating system and mobile browser behavior may differ on a real device.",
  "errors.items": "{count} error", "errors.items_plural": "{count} errors", "plans.perMonth": "/ month", "plans.discount": "save {percent}%",
};
const es: Catalog = {
  "common.language": "Idioma", "common.settings": "Configuración", "common.account": "Mi cuenta", "common.plans": "Planes", "common.cancel": "Cancelar", "common.save": "Guardar", "common.delete": "Eliminar", "common.edit": "Editar", "common.loading": "Espera...", "common.external": "Abrir externamente",
  "navigation.features": "Funciones", "navigation.security": "Seguridad", "navigation.install": "Cómo instalar", "navigation.data": "Datos y restablecimiento", "navigation.breakpoints": "Breakpoints", "navigation.convertio": "Convertio y GIF",
  "landing.heroTitle": "Prueba páginas reales con tu espacio de QA en el navegador.", "landing.heroAction": "Verificar acceso e instalar", "landing.plansTitle": "Empieza gratis. Evoluciona cuando tenga sentido.", "landing.monthly": "Mensual", "landing.yearly": "Anual", "landing.faq": "Preguntas frecuentes", "landing.about": "Acerca de",
  "auth.signIn": "Entrar", "auth.signUp": "Crear cuenta", "auth.email": "Correo", "auth.password": "Contraseña", "auth.signOut": "Salir",
  "toolbar.ready": "LISTO PARA PROBAR", "toolbar.tools": "Herramientas", "toolbar.screenshot": "Capturar pantalla", "toolbar.record": "Iniciar grabación", "toolbar.stop": "Detener grabación", "toolbar.restore": "Mostrar QA Toolbar", "toolbar.hide": "Ocultar toolbar",
  "recording.paused": "Grabación pausada.", "recording.resumed": "Grabación reanudada.", "recording.saved": "Evidencia {format} guardada.",
  "breakpoints.notice": "Esta vista simula dimensiones responsivas en el navegador actual. El hardware, sistema operativo y navegador móvil pueden comportarse diferente en un dispositivo real.",
  "errors.items": "{count} error", "errors.items_plural": "{count} errores", "plans.perMonth": "/ mes", "plans.discount": "ahorra {percent}%",
};
export const translationCatalog: Record<Locale, Catalog> = { "pt-BR": ptBR, en, es };
export function isLocale(value: unknown): value is Locale { return value === "pt-BR" || value === "en" || value === "es"; }
export function translate(locale: Locale, key: string, values: Record<string, string | number> = {}): string { const pluralKey = typeof values.count === "number" && values.count !== 1 ? `${key}_plural` : key; const template = translationCatalog[locale][pluralKey] ?? translationCatalog["pt-BR"][pluralKey] ?? key; return template.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? `{${name}}`)); }
export function formatCurrency(locale: Locale, value: number, currency = "BRL"): string { return new Intl.NumberFormat(locale, { style: "currency", currency }).format(value); }
export function formatDate(locale: Locale, value: Date | string): string { return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
export function formatDuration(locale: Locale, seconds: number): string { const minutes = Math.floor(seconds / 60); const remaining = Math.max(0, Math.floor(seconds % 60)); return new Intl.NumberFormat(locale, { minimumIntegerDigits: 2 }).format(minutes) + ":" + new Intl.NumberFormat(locale, { minimumIntegerDigits: 2 }).format(remaining); }

const visiblePhrases: Record<Exclude<Locale, "pt-BR">, Record<string, string>> = {
  en: {
    "Configuração": "Settings", "Minha conta": "My account", "Planos": "Plans", "Idioma": "Language", "Dados e reset": "Data and reset", "Workspace e CRUDs": "Workspace and CRUD", "Dados locais validados pelo schema v2.": "Local data validated by schema v2.",
    "Clientes": "Clients", "Projetos": "Projects", "Produtos": "Products", "Ambientes": "Environments", "Tipos de conta": "Account types", "Contas": "Accounts", "Métodos sandbox": "Sandbox methods",
    "Todos": "All", "Ativos": "Active", "Inativos": "Inactive", "Criar": "Create", "Editar": "Edit", "Excluir": "Delete", "Duplicar": "Duplicate", "Ativar": "Enable", "Desativar": "Disable", "+ imagem": "+ image", "Principal": "Primary",
    "Começar agora": "Get started", "Conhecer os planos": "View plans", "Como instalar": "How to install", "Recursos": "Features", "Segurança": "Security", "Sobre": "About", "Sobre o produto": "About the product", "Perguntas frequentes": "Frequently asked questions", "Antes de instalar.": "Before installing.",
    "Sua rotina de QA, direto no navegador.": "Your QA workflow, right in the browser.", "Testes manuais com sabor automático": "Manual testing with an automation boost", "Menos troca de contexto.": "Less context switching.", "Mais clareza para testar.": "More clarity for testing.",
    "Mensal": "Monthly", "Anual": "Yearly", "Grátis": "Free", "Recomendado": "Recommended", "Começar trial grátis": "Start free trial", "Cobrança anual com desconto maior.": "Annual billing with a larger discount.", "Tem um voucher?": "Have a voucher?", "Resgatar": "Redeem",
    "Criar conta": "Create account", "Entrar": "Sign in", "Sair": "Sign out", "E-mail": "Email", "Senha": "Password", "Aguarde...": "Please wait...", "Resgatar voucher": "Redeem voucher", "Gerenciar assinatura": "Manage subscription", "SESSÃO ATIVA": "ACTIVE SESSION",
    "Importar e exportar": "Import and export", "Exportação segura": "Safe export", "Exportação completa": "Complete export", "Selecionar JSON": "Select JSON", "Aplicar importação": "Apply import", "Mesclar": "Merge", "Substituir": "Replace", "Cancelar": "Cancel", "Reset local": "Local reset", "Resetar escopo": "Reset scope", "Tudo local": "All local data",
    "Convertio para GIF": "Convertio for GIF", "Chave configurada:": "Configured key:", "Validar, salvar e continuar": "Validate, save and continue", "Documentação oficial": "Official documentation", "Remover": "Remove",
    "Simulação responsiva": "Responsive simulation", "Mesma URL": "Same URL", "Sincronizar scroll": "Sync scrolling", "Recarregar": "Reload", "Comparativo": "Comparison", "Novo preset": "New preset",
    "Ferramentas": "Tools", "Ocultar toolbar": "Hide toolbar", "Mostrar QA Toolbar": "Show QA Toolbar", "Pronto para testar": "Ready to test", "Capturar screenshot": "Capture screenshot", "Iniciar gravação": "Start recording", "Parar gravação": "Stop recording",
    "Itens fixados": "Pinned items", "Contexto atual": "Current context", "Abrir configuração completa": "Open full settings", "Documento sintético local": "Local synthetic document", "Gerar outro": "Generate another", "Copiar": "Copy",
    "Privacidade": "Privacy", "Termos": "Terms", "Suporte": "Support", "Versão": "Version", "Build": "Build", "Desenvolvedor": "Developer", "Conexão": "Connection", "Licença": "License", "Copiar diagnóstico seguro": "Copy safe diagnostics", "Nenhuma resposta encontrada.": "No answer found.",
    "Próximo": "Next", "Voltar": "Back", "Pular guia": "Skip guide", "Pular por enquanto": "Skip for now", "Começar a testar": "Start testing", "Adicionar": "Add", "opcional": "optional", "obrigatório": "required",
  },
  es: {
    "Configuração": "Configuración", "Minha conta": "Mi cuenta", "Planos": "Planes", "Idioma": "Idioma", "Dados e reset": "Datos y restablecimiento", "Workspace e CRUDs": "Espacio de trabajo y CRUD", "Dados locais validados pelo schema v2.": "Datos locales validados por el esquema v2.",
    "Clientes": "Clientes", "Projetos": "Proyectos", "Produtos": "Productos", "Ambientes": "Entornos", "Tipos de conta": "Tipos de cuenta", "Contas": "Cuentas", "Métodos sandbox": "Métodos sandbox", "Recursos": "Recursos",
    "Todos": "Todos", "Ativos": "Activos", "Inativos": "Inactivos", "Criar": "Crear", "Editar": "Editar", "Excluir": "Eliminar", "Duplicar": "Duplicar", "Ativar": "Activar", "Desativar": "Desactivar", "+ imagem": "+ imagen", "Principal": "Principal",
    "Começar agora": "Comenzar ahora", "Conhecer os planos": "Ver planes", "Como instalar": "Cómo instalar", "Segurança": "Seguridad", "Sobre": "Acerca de", "Sobre o produto": "Sobre el producto", "Perguntas frequentes": "Preguntas frecuentes", "Antes de instalar.": "Antes de instalar.",
    "Sua rotina de QA, direto no navegador.": "Tu rutina de QA, directamente en el navegador.", "Testes manuais com sabor automático": "Pruebas manuales con impulso automático", "Menos troca de contexto.": "Menos cambios de contexto.", "Mais clareza para testar.": "Más claridad para probar.",
    "Mensal": "Mensual", "Anual": "Anual", "Grátis": "Gratis", "Recomendado": "Recomendado", "Começar trial grátis": "Iniciar prueba gratuita", "Cobrança anual com desconto maior.": "Facturación anual con mayor descuento.", "Tem um voucher?": "¿Tienes un voucher?", "Resgatar": "Canjear",
    "Criar conta": "Crear cuenta", "Entrar": "Entrar", "Sair": "Salir", "E-mail": "Correo", "Senha": "Contraseña", "Aguarde...": "Espera...", "Resgatar voucher": "Canjear voucher", "Gerenciar assinatura": "Gestionar suscripción", "SESSÃO ATIVA": "SESIÓN ACTIVA",
    "Importar e exportar": "Importar y exportar", "Exportação segura": "Exportación segura", "Exportação completa": "Exportación completa", "Selecionar JSON": "Seleccionar JSON", "Aplicar importação": "Aplicar importación", "Mesclar": "Combinar", "Substituir": "Reemplazar", "Cancelar": "Cancelar", "Reset local": "Restablecimiento local", "Resetar escopo": "Restablecer ámbito", "Tudo local": "Todos los datos locales",
    "Convertio para GIF": "Convertio para GIF", "Chave configurada:": "Clave configurada:", "Validar, salvar e continuar": "Validar, guardar y continuar", "Documentação oficial": "Documentación oficial", "Remover": "Eliminar",
    "Simulação responsiva": "Simulación responsiva", "Mesma URL": "Misma URL", "Sincronizar scroll": "Sincronizar desplazamiento", "Recarregar": "Recargar", "Comparativo": "Comparación", "Novo preset": "Nuevo preset",
    "Ferramentas": "Herramientas", "Ocultar toolbar": "Ocultar toolbar", "Mostrar QA Toolbar": "Mostrar QA Toolbar", "Pronto para testar": "Listo para probar", "Capturar screenshot": "Capturar pantalla", "Iniciar gravação": "Iniciar grabación", "Parar gravação": "Detener grabación",
    "Itens fixados": "Elementos fijados", "Contexto atual": "Contexto actual", "Abrir configuração completa": "Abrir configuración completa", "Documento sintético local": "Documento sintético local", "Gerar outro": "Generar otro", "Copiar": "Copiar",
    "Privacidade": "Privacidad", "Termos": "Términos", "Suporte": "Soporte", "Versão": "Versión", "Build": "Build", "Desenvolvedor": "Desarrollador", "Conexão": "Conexión", "Licença": "Licencia", "Copiar diagnóstico seguro": "Copiar diagnóstico seguro", "Nenhuma resposta encontrada.": "No se encontró respuesta.",
    "Próximo": "Siguiente", "Voltar": "Volver", "Pular guia": "Omitir guía", "Pular por enquanto": "Omitir por ahora", "Começar a testar": "Comenzar a probar", "Adicionar": "Añadir", "opcional": "opcional", "obrigatório": "obligatorio",
  },
};

export function translateVisibleText(locale: Locale, value: string): string { if (locale === "pt-BR") return value; const trimmed = value.trim(); const translated = visiblePhrases[locale][trimmed]; return translated ? value.replace(trimmed, translated) : value; }

const originalText = new WeakMap<Text, string>();
const originalAttributes = new WeakMap<Element, Map<string, string>>();
export function localizeDom(root: Node, locale: Locale): () => void {
  const apply = (scope: Node) => {
    const documentOwner = scope.ownerDocument ?? document;
    const walker = documentOwner.createTreeWalker(scope, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let node: Node | null = scope;
    while (node) {
      if (node.nodeType === Node.TEXT_NODE) { const text = node as Text; const parent = text.parentElement; if (parent && !/^(SCRIPT|STYLE|CODE|PRE)$/.test(parent.tagName) && text.data.trim()) { let source = originalText.get(text) ?? text.data; const knownRenderings = (["pt-BR", "en", "es"] as const).map((candidate) => translateVisibleText(candidate, source)); if (!knownRenderings.includes(text.data)) source = text.data; originalText.set(text, source); const translated = translateVisibleText(locale, source); if (text.data !== translated) text.data = translated; } }
      else if (node instanceof Element) for (const attribute of ["aria-label", "title", "placeholder"]) { const current = node.getAttribute(attribute); if (!current) continue; let values = originalAttributes.get(node); if (!values) { values = new Map(); originalAttributes.set(node, values); } let source = values.get(attribute) ?? current; const knownRenderings = (["pt-BR", "en", "es"] as const).map((candidate) => translateVisibleText(candidate, source)); if (!knownRenderings.includes(current)) source = current; values.set(attribute, source); const translated = translateVisibleText(locale, source); if (current !== translated) node.setAttribute(attribute, translated); }
      node = walker.nextNode();
    }
  };
  apply(root);
  const observer = new MutationObserver((records) => records.forEach((record) => { if (record.type === "characterData") apply(record.target); else record.addedNodes.forEach(apply); }));
  observer.observe(root, { subtree: true, childList: true, characterData: true });
  return () => observer.disconnect();
}
