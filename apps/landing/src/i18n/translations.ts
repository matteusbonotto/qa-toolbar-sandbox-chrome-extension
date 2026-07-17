export type Locale = "pt-BR" | "es" | "en";

export const LOCALES: { id: Locale; label: string }[] = [
  { id: "pt-BR", label: "PT" },
  { id: "es", label: "ES" },
  { id: "en", label: "EN" },
];

export const DEFAULT_LOCALE: Locale = "pt-BR";

interface PlanTranslation {
  name: string;
  tagline: string;
  features: string[];
}

export interface Dictionary {
  nav: {
    home: string;
    about: string;
    simulator: string;
    semiauto: string;
    pricing: string;
    support: string;
    install: string;
  };
  hero: {
    eyebrow: string;
    titleLine1: string;
    titleGradient: string;
    lead: string;
    ctaPricing: string;
    ctaSimulate: string;
  };
  simulator: {
    hint: string;
    illustrationBadge: string;
    client: string;
    project: string;
    product: string;
    environment: string;
  };
  mockToolbar: {
    testStatus: string;
    testStatusTitle: string;
    pass: string;
    fail: string;
    note: string;
    shape: string;
    clearAll: string;
    screenshot: string;
    recordStart: string;
    recordStop: string;
    tools: string;
    clickSpy: string;
    freezeClock: string;
    forceHttp: string;
    inspectors: string;
    jsonStudio: string;
    breakpointViewer: string;
    simulateRequest: string;
    newNote: string;
    frozenSuffix: string;
    minimize: string;
    restore: string;
    remove: string;
    edit: string;
    save: string;
    notePlaceholder: string;
    statusPass: string;
    statusFail: string;
    statusBlocked: string;
    statusLimitation: string;
  };
  toast: {
    screenshotCaptured: string;
    recorded: (elapsed: string) => string;
    clickSpyOn: string;
    clickSpyOff: string;
    freezeOn: string;
    freezeOff: string;
    forceHttp: string;
    requestCaptured: string;
    statusRecorded: (label: string) => string;
    inspectorsCount: (count: number) => string;
    inspectorsEmpty: string;
    jsonStudio: string;
    breakpointViewer: string;
  };
  about: {
    eyebrow: string;
    title: string;
    lead: string;
    mission: { title: string; body: string };
    vision: { title: string; body: string };
    values: { title: string; body: string };
  };
  semiauto: {
    eyebrow: string;
    titleLine1: string;
    titleGradient: string;
    body: string;
    gifAlt: string;
  };
  pricing: {
    eyebrow: string;
    title: string;
    lead: string;
    voucherPlaceholder: string;
    voucherApply: string;
    voucherAppliedSuffix: string;
    voucherErrorEmpty: string;
    voucherErrorInvalid: string;
    recommendedBadge: string;
    perMonth: string;
    perYear: string;
    billingMonthly: string;
    billingYearly: string;
    billingYearlySavings: string;
    free: string;
    freeNote: string;
    ctaFree: string;
    ctaPaid: string;
    checkoutPending: string;
    accountTitle: string;
    accountLead: string;
    emailLabel: string;
    passwordLabel: string;
    signIn: string;
    signUp: string;
    signOut: string;
    signedInAs: string;
    acceptTerms: string;
    privacyLink: string;
    authRequired: string;
    confirmationSent: string;
    emailLink: string;
    emailLinkSent: string;
    invalidCredentials: string;
    signupFailed: string;
    termsRequired: string;
    closeModal: string;
    configUnavailable: string;
    pricingUnavailable: string;
    voucherQueued: string;
    accessActive: string;
    accessPermanent: string;
    accessExpires: string;
    installExtension: string;
    paymentProcessing: string;
    paymentCanceled: string;
    checkoutFailed: string;
    working: string;
    forgotPassword: string;
    forgotPasswordEmailRequired: string;
    forgotPasswordSent: string;
    forgotPasswordFailed: string;
    alreadySubscribed: string;
    currentPlanBadge: string;
    currentPlanCta: string;
    unavailableWhileSubscribed: string;
    plans: Record<"smoke-test" | "regression-runner" | "root-cause-analyst" | "release-manager", PlanTranslation>;
  };
  support: {
    eyebrow1: string;
    title1: string;
    body1: string;
    cta1: string;
    eyebrow2: string;
    title2: string;
    body2: string;
    cta2: string;
  };
  footer: {
    navAbout: string;
    navPricing: string;
    navSupport: string;
    navPrivacy: string;
    creditPrefix: string;
  };
  privacy: {
    back: string;
    eyebrow: string;
    title: string;
    lead: string;
    permissionsTitle: string;
    permissions: { name: string; reason: string }[];
    dataTitle: string;
    dataBody: string;
    accountTitle: string;
    accountBody: string;
    contactTitle: string;
    contactBody: string;
  };
  resetPassword: {
    eyebrow: string;
    title: string;
    lead: string;
    newPasswordLabel: string;
    confirmPasswordLabel: string;
    submit: string;
    working: string;
    success: string;
    successCta: string;
    mismatch: string;
    tooShort: string;
    invalidLink: string;
    genericError: string;
    backLink: string;
  };
}

const pt: Dictionary = {
  nav: {
    home: "Início",
    about: "Sobre",
    simulator: "Simulador",
    semiauto: "Sabor automático",
    pricing: "Planos",
    support: "Suporte",
    install: "Entrar",
  },
  hero: {
    eyebrow: "QA Toolbar Sandbox",
    titleLine1: "Testar manualmente não devia ser",
    titleGradient: "sinônimo de caos de abas e contexto perdido",
    lead: "Uma barra de QA que vive dentro de qualquer página: contexto de cliente, projeto e ambiente, evidências, inspectors e emulação responsiva — sem sair da aba que você está testando.",
    ctaPricing: "Ver planos",
    ctaSimulate: "Simular agora",
  },
  simulator: {
    hint: "Simule a troca de contexto e use as ferramentas de teste — tudo funciona de verdade aqui dentro.",
    illustrationBadge: "Ilustração interativa — não é a extensão real instalada",
    client: "Cliente",
    project: "Projeto",
    product: "Produto",
    environment: "Ambiente",
  },
  mockToolbar: {
    testStatus: "Test Status",
    testStatusTitle: "Registrar status do teste",
    pass: "Marcador Pass",
    fail: "Marcador Fail",
    note: "Nota de texto",
    shape: "Desenhar forma",
    clearAll: "Limpar",
    screenshot: "Capturar screenshot",
    recordStart: "Iniciar gravação de evidência",
    recordStop: "Parar gravação",
    tools: "Ferramentas",
    clickSpy: "Click Spy",
    freezeClock: "Freeze Clock",
    forceHttp: "Force HTTP",
    inspectors: "Inspectors",
    jsonStudio: "JSON Studio",
    breakpointViewer: "Breakpoint Viewer",
    simulateRequest: "Simular requisição",
    newNote: "Nova nota",
    frozenSuffix: "(congelado)",
    minimize: "Minimizar",
    restore: "Mostrar barra",
    remove: "Remover",
    edit: "Editar",
    save: "Salvar",
    notePlaceholder: "Escreva aqui...",
    statusPass: "Pass",
    statusFail: "Fail",
    statusBlocked: "Blocked",
    statusLimitation: "Limitation",
  },
  toast: {
    screenshotCaptured: "Screenshot capturada.",
    recorded: (elapsed) => `Evidência gravada (${elapsed}).`,
    clickSpyOn: "Click Spy ativo — passe o mouse pelos elementos da página.",
    clickSpyOff: "Click Spy desativado.",
    freezeOn: "Relógio congelado no horário atual.",
    freezeOff: "Relógio retomado.",
    forceHttp: "Force HTTP simulado: a próxima requisição retornará 500.",
    requestCaptured: "Requisição JSON capturada pelos Inspectors.",
    statusRecorded: (label) => `Status registrado: ${label}`,
    inspectorsCount: (count) => `${count} requisição(ões) capturada(s) até agora.`,
    inspectorsEmpty: 'Nenhuma requisição capturada ainda — clique em "Simular requisição".',
    jsonStudio: "JSON Studio: disponível na extensão completa.",
    breakpointViewer: "Breakpoint Viewer em tela cheia: disponível na extensão completa.",
  },
  about: {
    eyebrow: "O que é",
    title: "Uma barra de QA que mora dentro da sua página",
    lead: "O QA Toolbar Sandbox é uma extensão de navegador que injeta uma barra de contexto e um kit de ferramentas de teste em qualquer site: marque o cliente, projeto, produto e ambiente que você está testando, registre evidências (screenshots, gravações, marcadores visuais), inspecione requisições de rede, congele o relógio, force respostas HTTP e emule breakpoints — tudo sem sair da aba.",
    mission: {
      title: "Missão",
      body: "Dar a cada pessoa que testa software uma barra de contexto sempre à mão — sem depender de planilhas, abas extras ou memória para saber onde e o que está sendo validado.",
    },
    vision: {
      title: "Visão",
      body: "Ser o companheiro padrão de quem faz QA manual: tão natural quanto o próprio navegador, em qualquer time, em qualquer produto.",
    },
    values: {
      title: "Valores",
      body: "Transparência nas evidências, respeito pelo julgamento humano, e automação que acelera — nunca substitui — o senso crítico de quem testa.",
    },
  },
  semiauto: {
    eyebrow: "Teste Semi-automático",
    titleLine1: "Testes manuais com",
    titleGradient: "sabor automático",
    body: "A gente não tira o humano da jogada — só acelera ele. O QA Toolbar Sandbox cuida do trabalho repetitivo (contexto, evidências, captura de rede, timers) enquanto você mantém o olhar crítico que nenhuma automação substitui. É teste manual, com sabor automático.",
    gifAlt: "Sabor energético, sabor automático",
  },
  pricing: {
    eyebrow: "Planos",
    title: "Comece grátis, cresça no seu ritmo",
    lead: "Escolha o plano que combina com sua rotina. Você entra ou cria sua conta somente quando decidir continuar.",
    voucherPlaceholder: "Código do voucher",
    voucherApply: "Aplicar",
    voucherAppliedSuffix: "aplicado",
    voucherErrorEmpty: "Digite um código de voucher.",
    voucherErrorInvalid: "Voucher inválido ou expirado.",
    recommendedBadge: "Melhor custo-benefício",
    perMonth: "por mês",
    perYear: "por ano",
    billingMonthly: "Mensal",
    billingYearly: "Anual",
    billingYearlySavings: "economize até 20%",
    free: "Grátis",
    freeNote: "Grátis por 30 dias, depois escolha um plano",
    ctaFree: "Começar grátis",
    ctaPaid: "Assinar",
    checkoutPending: "Pagamento recebido. Estamos confirmando seu acesso.",
    accountTitle: "Sua conta",
    accountLead: "Acesse seus planos, vouchers e a extensão com o mesmo e-mail.",
    emailLabel: "E-mail",
    passwordLabel: "Senha (mínimo de 8 caracteres)",
    signIn: "Entrar",
    signUp: "Criar conta",
    signOut: "Sair",
    signedInAs: "Conectado como",
    acceptTerms: "Li e aceito a Política de Privacidade para criar minha conta.",
    privacyLink: "Ler a política",
    authRequired: "Entre ou crie sua conta antes de escolher um plano.",
    confirmationSent: "Confira seu e-mail e confirme a conta antes de entrar.",
    emailLink: "Receber link de acesso por e-mail",
    emailLinkSent: "Se a conta estiver cadastrada, o link de acesso chegará no seu e-mail.",
    invalidCredentials: "E-mail ou senha incorretos. Você também pode receber um link de acesso.",
    signupFailed: "Não foi possível criar a conta. Confira os dados ou tente entrar.",
    termsRequired: "Aceite a Política de Privacidade para criar sua conta.",
    closeModal: "Fechar",
    configUnavailable: "O acesso está temporariamente indisponível. Tente novamente em instantes.",
    pricingUnavailable: "Não foi possível carregar os preços oficiais agora.",
    voucherQueued: "será aplicado ao escolher o plano",
    accessActive: "Acesso ativo",
    accessPermanent: "sem data de expiração",
    accessExpires: "válido até",
    installExtension: "Instalar extensão oficial",
    paymentProcessing: "Pagamento recebido. Estamos confirmando seu acesso.",
    paymentCanceled: "Checkout cancelado. Nenhuma liberação foi feita.",
    checkoutFailed: "Não foi possível concluir esta etapa. Revise os dados e tente novamente.",
    working: "Aguarde…",
    forgotPassword: "Esqueci minha senha",
    forgotPasswordEmailRequired: "Digite seu e-mail acima para receber o link de redefinição.",
    forgotPasswordSent: "Enviamos um link para redefinir sua senha. Confira seu e-mail.",
    forgotPasswordFailed: "Não foi possível enviar o link agora. Tente novamente em instantes.",
    alreadySubscribed: "Você já tem uma assinatura ativa. Para trocar de plano, fale com o suporte.",
    currentPlanBadge: "Seu plano atual",
    currentPlanCta: "Plano atual",
    unavailableWhileSubscribed: "Indisponível — assinatura ativa",
    plans: {
      "smoke-test": {
        name: "Smoke Test",
        tagline: "Para testar se a ideia funciona pra você",
        features: [
          "Toolbar completa em qualquer site",
          "1 workspace (cliente/projeto/produto)",
          "Evidências básicas (screenshot + marcadores)",
          "Contador de caracteres e Multiclick",
          "Suporte por e-mail",
        ],
      },
      "regression-runner": {
        name: "Regression Runner",
        tagline: "Para quem testa todo santo dia",
        features: [
          "Tudo do Smoke Test",
          "Workspaces ilimitados",
          "Gravação de evidências em vídeo",
          "Inspectors de rede + JSON Studio",
          "Input Lab e Faker Fill (dados de teste sintéticos)",
        ],
      },
      "root-cause-analyst": {
        name: "Root Cause Analyst",
        tagline: "O melhor custo-benefício para times de QA",
        features: [
          "Tudo do Regression Runner",
          "Breakpoint Viewer em tela cheia",
          "Freeze Clock + Force HTTP",
          "Macro Studio (gravação, replay e exportação Playwright)",
          "Importação/exportação de workspace em equipe",
          "Suporte prioritário",
        ],
      },
      "release-manager": {
        name: "Release Manager",
        tagline: "Acesso completo, sem limites",
        features: [
          "Tudo do Root Cause Analyst",
          "Key View (atalhos, digitação e mouse na tela)",
          "Uso ilimitado em todos os recursos",
          "Múltiplos times e workspaces compartilhados",
          "Onboarding dedicado",
        ],
      },
    },
  },
  support: {
    eyebrow1: "Suporte & sugestões",
    title1: "Achou um bug ou tem uma ideia?",
    body1: "Toda sugestão vira roadmap. Escreva para contato@matheusbonotto.com.br com o máximo de contexto possível — print, passos, e o que você esperava ver.",
    cta1: "Enviar mensagem",
    eyebrow2: "Projeto personalizado",
    title2: "Precisa de algo sob medida?",
    body2: "Integrações, workspaces corporativos, SSO, relatórios customizados — conte o que seu time precisa e construímos uma proposta específica.",
    cta2: "Falar sobre meu projeto",
  },
  footer: {
    navAbout: "Sobre",
    navPricing: "Planos",
    navSupport: "Suporte",
    navPrivacy: "Política de Privacidade",
    creditPrefix: "desenvolvido por",
  },
  privacy: {
    back: "← Voltar para a página inicial",
    eyebrow: "Política de Privacidade",
    title: "O que o QA Toolbar Sandbox pede ao seu navegador",
    lead: "Esta página explica, em linguagem direta, quais permissões a extensão solicita, por que cada uma é necessária, e como tratamos os dados que você insere no seu workspace.",
    permissionsTitle: "Permissões solicitadas",
    permissions: [
      { name: "storage", reason: "Guardar seu workspace (clientes, projetos, produtos, ambientes) localmente no navegador, sem enviar para servidores externos." },
      { name: "scripting", reason: "Injetar a barra de QA e as ferramentas de teste na página que você está visitando, sob seu comando." },
      { name: "activeTab / tabs", reason: "Saber em qual aba a barra deve aparecer e capturar screenshots da aba ativa quando você aciona o botão de evidência." },
      { name: "host_permissions (todos os sites)", reason: "Permitir que você use a extensão em qualquer site por padrão — você pode restringir isso nas configurações da extensão." },
    ],
    dataTitle: "Onde ficam seus dados",
    dataBody: "Clientes, projetos, produtos, ambientes e evidências que você cria ficam armazenados localmente no seu navegador (chrome.storage.local), atrelados ao seu perfil de usuário do Chrome. Não coletamos nem transmitimos o conteúdo do seu workspace para nossos servidores.",
    accountTitle: "Conta e cobrança",
    accountBody: "Ao criar uma conta — seja pela landing page ou pela extensão — coletamos seu e-mail e informações de pagamento processadas diretamente pelo Stripe (nunca armazenamos dados de cartão em nossos servidores). Ao continuar, você consente com esta política e com os termos de uso.",
    contactTitle: "Contato",
    contactBody: "Dúvidas sobre privacidade? Escreva para contato@matheusbonotto.com.br.",
  },
  resetPassword: {
    eyebrow: "QA Toolbar Sandbox",
    title: "Redefinir senha",
    lead: "Escolha uma nova senha para sua conta.",
    newPasswordLabel: "Nova senha",
    confirmPasswordLabel: "Repetir nova senha",
    submit: "Concluir",
    working: "Aguarde…",
    success: "Senha atualizada. Você já pode entrar com a nova senha.",
    successCta: "Voltar para o início",
    mismatch: "As senhas não coincidem.",
    tooShort: "A senha precisa ter pelo menos 8 caracteres.",
    invalidLink: "Este link de redefinição é inválido ou expirou. Solicite um novo em \"Esqueci minha senha\".",
    genericError: "Não foi possível atualizar sua senha agora. Tente novamente.",
    backLink: "Voltar para o início",
  },
};

const es: Dictionary = {
  nav: {
    home: "Inicio",
    about: "Acerca de",
    simulator: "Simulador",
    semiauto: "Sabor automático",
    pricing: "Planes",
    support: "Soporte",
    install: "Entrar",
  },
  hero: {
    eyebrow: "QA Toolbar Sandbox",
    titleLine1: "Probar manualmente no debería ser",
    titleGradient: "sinónimo de caos de pestañas y contexto perdido",
    lead: "Una barra de QA que vive dentro de cualquier página: contexto de cliente, proyecto y entorno, evidencias, inspectors y emulación responsiva — sin salir de la pestaña que estás probando.",
    ctaPricing: "Ver planes",
    ctaSimulate: "Simular ahora",
  },
  simulator: {
    hint: "Simula el cambio de contexto y usa las herramientas de prueba — todo funciona de verdad aquí dentro.",
    illustrationBadge: "Ilustración interactiva — no es la extensión real instalada",
    client: "Cliente",
    project: "Proyecto",
    product: "Producto",
    environment: "Entorno",
  },
  mockToolbar: {
    testStatus: "Test Status",
    testStatusTitle: "Registrar estado de la prueba",
    pass: "Marcador Pass",
    fail: "Marcador Fail",
    note: "Nota de texto",
    shape: "Dibujar forma",
    clearAll: "Limpiar",
    screenshot: "Capturar pantalla",
    recordStart: "Iniciar grabación de evidencia",
    recordStop: "Detener grabación",
    tools: "Herramientas",
    clickSpy: "Click Spy",
    freezeClock: "Freeze Clock",
    forceHttp: "Force HTTP",
    inspectors: "Inspectors",
    jsonStudio: "JSON Studio",
    breakpointViewer: "Breakpoint Viewer",
    simulateRequest: "Simular solicitud",
    newNote: "Nueva nota",
    frozenSuffix: "(congelado)",
    minimize: "Minimizar",
    restore: "Mostrar barra",
    remove: "Quitar",
    edit: "Editar",
    save: "Guardar",
    notePlaceholder: "Escribe aquí...",
    statusPass: "Pass",
    statusFail: "Fail",
    statusBlocked: "Blocked",
    statusLimitation: "Limitation",
  },
  toast: {
    screenshotCaptured: "Captura de pantalla realizada.",
    recorded: (elapsed) => `Evidencia grabada (${elapsed}).`,
    clickSpyOn: "Click Spy activo — pasa el mouse por los elementos de la página.",
    clickSpyOff: "Click Spy desactivado.",
    freezeOn: "Reloj congelado en la hora actual.",
    freezeOff: "Reloj reanudado.",
    forceHttp: "Force HTTP simulado: la próxima solicitud devolverá 500.",
    requestCaptured: "Solicitud JSON capturada por los Inspectors.",
    statusRecorded: (label) => `Estado registrado: ${label}`,
    inspectorsCount: (count) => `${count} solicitud(es) capturada(s) hasta ahora.`,
    inspectorsEmpty: 'Ninguna solicitud capturada todavía — haz clic en "Simular solicitud".',
    jsonStudio: "JSON Studio: disponible en la extensión completa.",
    breakpointViewer: "Breakpoint Viewer a pantalla completa: disponible en la extensión completa.",
  },
  about: {
    eyebrow: "Qué es",
    title: "Una barra de QA que vive dentro de tu página",
    lead: "QA Toolbar Sandbox es una extensión de navegador que inyecta una barra de contexto y un kit de herramientas de prueba en cualquier sitio: marca el cliente, proyecto, producto y entorno que estás probando, registra evidencias (capturas, grabaciones, marcadores visuales), inspecciona solicitudes de red, congela el reloj, fuerza respuestas HTTP y emula breakpoints — todo sin salir de la pestaña.",
    mission: {
      title: "Misión",
      body: "Dar a cada persona que prueba software una barra de contexto siempre a mano — sin depender de hojas de cálculo, pestañas extra o memoria para saber qué se está validando.",
    },
    vision: {
      title: "Visión",
      body: "Ser el compañero estándar de quien hace QA manual: tan natural como el propio navegador, en cualquier equipo, en cualquier producto.",
    },
    values: {
      title: "Valores",
      body: "Transparencia en las evidencias, respeto por el juicio humano, y automatización que acelera — nunca sustituye — el sentido crítico de quien prueba.",
    },
  },
  semiauto: {
    eyebrow: "Prueba Semi-automática",
    titleLine1: "Pruebas manuales con",
    titleGradient: "sabor automático",
    body: "No sacamos al humano de la jugada — solo lo aceleramos. QA Toolbar Sandbox se encarga del trabajo repetitivo (contexto, evidencias, captura de red, temporizadores) mientras tú mantienes la mirada crítica que ninguna automatización sustituye. Es prueba manual, con sabor automático.",
    gifAlt: "Sabor energético, sabor automático",
  },
  pricing: {
    eyebrow: "Planes",
    title: "Empieza gratis, crece a tu ritmo",
    lead: "Elige el plan que encaja con tu rutina. Inicia sesión o crea tu cuenta solo cuando decidas continuar.",
    voucherPlaceholder: "Código del voucher",
    voucherApply: "Aplicar",
    voucherAppliedSuffix: "aplicado",
    voucherErrorEmpty: "Escribe un código de voucher.",
    voucherErrorInvalid: "Voucher inválido o expirado.",
    recommendedBadge: "Mejor relación calidad-precio",
    perMonth: "por mes",
    perYear: "por año",
    billingMonthly: "Mensual",
    billingYearly: "Anual",
    billingYearlySavings: "ahorra hasta 20%",
    free: "Gratis",
    freeNote: "Gratis por 30 días, luego elige un plan",
    ctaFree: "Empezar gratis",
    ctaPaid: "Suscribirse",
    checkoutPending: "Pago recibido. Estamos confirmando tu acceso.",
    accountTitle: "Tu cuenta",
    accountLead: "Accede a tus planes, vouchers y extensión con el mismo correo.",
    emailLabel: "Correo",
    passwordLabel: "Contraseña (mínimo 8 caracteres)",
    signIn: "Entrar",
    signUp: "Crear cuenta",
    signOut: "Salir",
    signedInAs: "Conectado como",
    acceptTerms: "He leído y acepto la Política de Privacidad para crear mi cuenta.",
    privacyLink: "Leer la política",
    authRequired: "Entra o crea tu cuenta antes de elegir un plan.",
    confirmationSent: "Revisa tu correo y confirma la cuenta antes de entrar.",
    emailLink: "Recibir enlace de acceso por correo",
    emailLinkSent: "Si la cuenta está registrada, el enlace de acceso llegará a tu correo.",
    invalidCredentials: "Correo o contraseña incorrectos. También puedes recibir un enlace de acceso.",
    signupFailed: "No fue posible crear la cuenta. Revisa los datos o intenta entrar.",
    termsRequired: "Acepta la Política de Privacidad para crear tu cuenta.",
    closeModal: "Cerrar",
    configUnavailable: "El acceso no está disponible temporalmente. Inténtalo de nuevo en unos instantes.",
    pricingUnavailable: "No fue posible cargar los precios oficiales ahora.",
    voucherQueued: "se aplicará al elegir el plan",
    accessActive: "Acceso activo",
    accessPermanent: "sin fecha de expiración",
    accessExpires: "válido hasta",
    installExtension: "Instalar extensión oficial",
    paymentProcessing: "Pago recibido. Estamos confirmando tu acceso.",
    paymentCanceled: "Checkout cancelado. No se liberó ningún acceso.",
    checkoutFailed: "No fue posible completar esta etapa. Revisa los datos e inténtalo de nuevo.",
    working: "Espera…",
    forgotPassword: "Olvidé mi contraseña",
    forgotPasswordEmailRequired: "Escribe tu correo arriba para recibir el enlace de restablecimiento.",
    forgotPasswordSent: "Enviamos un enlace para restablecer tu contraseña. Revisa tu correo.",
    forgotPasswordFailed: "No fue posible enviar el enlace ahora. Inténtalo de nuevo en un momento.",
    alreadySubscribed: "Ya tienes una suscripción activa. Para cambiar de plan, contacta con soporte.",
    currentPlanBadge: "Tu plan actual",
    currentPlanCta: "Plan actual",
    unavailableWhileSubscribed: "No disponible — suscripción activa",
    plans: {
      "smoke-test": {
        name: "Smoke Test",
        tagline: "Para probar si la idea funciona para ti",
        features: [
          "Toolbar completa en cualquier sitio",
          "1 workspace (cliente/proyecto/producto)",
          "Evidencias básicas (captura + marcadores)",
          "Contador de caracteres y Multiclick",
          "Soporte por correo",
        ],
      },
      "regression-runner": {
        name: "Regression Runner",
        tagline: "Para quien prueba todos los días",
        features: [
          "Todo de Smoke Test",
          "Workspaces ilimitados",
          "Grabación de evidencias en video",
          "Inspectors de red + JSON Studio",
          "Input Lab y Faker Fill (datos de prueba sintéticos)",
        ],
      },
      "root-cause-analyst": {
        name: "Root Cause Analyst",
        tagline: "La mejor relación calidad-precio para equipos de QA",
        features: [
          "Todo de Regression Runner",
          "Breakpoint Viewer a pantalla completa",
          "Freeze Clock + Force HTTP",
          "Macro Studio (grabación, repetición y exportación a Playwright)",
          "Importación/exportación de workspace en equipo",
          "Soporte prioritario",
        ],
      },
      "release-manager": {
        name: "Release Manager",
        tagline: "Acceso completo, sin límites",
        features: [
          "Todo de Root Cause Analyst",
          "Key View (atajos, escritura y mouse en pantalla)",
          "Uso ilimitado en todas las funciones",
          "Múltiples equipos y workspaces compartidos",
          "Onboarding dedicado",
        ],
      },
    },
  },
  support: {
    eyebrow1: "Soporte y sugerencias",
    title1: "¿Encontraste un error o tienes una idea?",
    body1: "Toda sugerencia se convierte en roadmap. Escribe a contato@matheusbonotto.com.br con el máximo de contexto posible — captura, pasos, y qué esperabas ver.",
    cta1: "Enviar mensaje",
    eyebrow2: "Proyecto personalizado",
    title2: "¿Necesitas algo a medida?",
    body2: "Integraciones, workspaces corporativos, SSO, informes personalizados — cuéntanos qué necesita tu equipo y construimos una propuesta específica.",
    cta2: "Hablar sobre mi proyecto",
  },
  footer: {
    navAbout: "Acerca de",
    navPricing: "Planes",
    navSupport: "Soporte",
    navPrivacy: "Política de Privacidad",
    creditPrefix: "desarrollado por",
  },
  privacy: {
    back: "← Volver a la página de inicio",
    eyebrow: "Política de Privacidad",
    title: "Qué le pide QA Toolbar Sandbox a tu navegador",
    lead: "Esta página explica, en lenguaje directo, qué permisos solicita la extensión, por qué cada uno es necesario, y cómo tratamos los datos que introduces en tu workspace.",
    permissionsTitle: "Permisos solicitados",
    permissions: [
      { name: "storage", reason: "Guardar tu workspace (clientes, proyectos, productos, entornos) localmente en el navegador, sin enviarlo a servidores externos." },
      { name: "scripting", reason: "Inyectar la barra de QA y las herramientas de prueba en la página que estás visitando, bajo tu orden." },
      { name: "activeTab / tabs", reason: "Saber en qué pestaña debe aparecer la barra y capturar capturas de pantalla de la pestaña activa cuando activas el botón de evidencia." },
      { name: "host_permissions (todos los sitios)", reason: "Permitir que uses la extensión en cualquier sitio por defecto — puedes restringir esto en la configuración de la extensión." },
    ],
    dataTitle: "Dónde están tus datos",
    dataBody: "Clientes, proyectos, productos, entornos y evidencias que creas se almacenan localmente en tu navegador (chrome.storage.local), vinculados a tu perfil de usuario de Chrome. No recopilamos ni transmitimos el contenido de tu workspace a nuestros servidores.",
    accountTitle: "Cuenta y facturación",
    accountBody: "Al crear una cuenta — sea desde la landing page o desde la extensión — recopilamos tu correo e información de pago procesada directamente por Stripe (nunca almacenamos datos de tarjetas en nuestros servidores). Al continuar, aceptas esta política y los términos de uso.",
    contactTitle: "Contacto",
    contactBody: "¿Dudas sobre privacidad? Escribe a contato@matheusbonotto.com.br.",
  },
  resetPassword: {
    eyebrow: "QA Toolbar Sandbox",
    title: "Restablecer contraseña",
    lead: "Elige una nueva contraseña para tu cuenta.",
    newPasswordLabel: "Nueva contraseña",
    confirmPasswordLabel: "Repetir nueva contraseña",
    submit: "Confirmar",
    working: "Espera…",
    success: "Contraseña actualizada. Ya puedes entrar con la nueva contraseña.",
    successCta: "Volver al inicio",
    mismatch: "Las contraseñas no coinciden.",
    tooShort: "La contraseña debe tener al menos 8 caracteres.",
    invalidLink: "Este enlace de restablecimiento no es válido o expiró. Solicita uno nuevo en \"Olvidé mi contraseña\".",
    genericError: "No fue posible actualizar tu contraseña ahora. Inténtalo de nuevo.",
    backLink: "Volver al inicio",
  },
};

const en: Dictionary = {
  nav: {
    home: "Home",
    about: "About",
    simulator: "Simulator",
    semiauto: "Auto flavor",
    pricing: "Pricing",
    support: "Support",
    install: "Sign in",
  },
  hero: {
    eyebrow: "QA Toolbar Sandbox",
    titleLine1: "Manual testing shouldn't mean",
    titleGradient: "tab chaos and lost context",
    lead: "A QA bar that lives inside any page: client, project and environment context, evidence, inspectors and responsive emulation — without ever leaving the tab you're testing.",
    ctaPricing: "See pricing",
    ctaSimulate: "Try the simulator",
  },
  simulator: {
    hint: "Switch context and use the testing tools — everything here actually works.",
    illustrationBadge: "Interactive illustration — not the real installed extension",
    client: "Client",
    project: "Project",
    product: "Product",
    environment: "Environment",
  },
  mockToolbar: {
    testStatus: "Test Status",
    testStatusTitle: "Record test status",
    pass: "Pass marker",
    fail: "Fail marker",
    note: "Text note",
    shape: "Draw shape",
    clearAll: "Clear",
    screenshot: "Capture screenshot",
    recordStart: "Start evidence recording",
    recordStop: "Stop recording",
    tools: "Tools",
    clickSpy: "Click Spy",
    freezeClock: "Freeze Clock",
    forceHttp: "Force HTTP",
    inspectors: "Inspectors",
    jsonStudio: "JSON Studio",
    breakpointViewer: "Breakpoint Viewer",
    simulateRequest: "Simulate request",
    newNote: "New note",
    frozenSuffix: "(frozen)",
    minimize: "Minimize",
    restore: "Show bar",
    remove: "Remove",
    edit: "Edit",
    save: "Save",
    notePlaceholder: "Write here...",
    statusPass: "Pass",
    statusFail: "Fail",
    statusBlocked: "Blocked",
    statusLimitation: "Limitation",
  },
  toast: {
    screenshotCaptured: "Screenshot captured.",
    recorded: (elapsed) => `Evidence recorded (${elapsed}).`,
    clickSpyOn: "Click Spy active — hover elements on the page.",
    clickSpyOff: "Click Spy turned off.",
    freezeOn: "Clock frozen at the current time.",
    freezeOff: "Clock resumed.",
    forceHttp: "Force HTTP simulated: the next request will return 500.",
    requestCaptured: "JSON request captured by the Inspectors.",
    statusRecorded: (label) => `Status recorded: ${label}`,
    inspectorsCount: (count) => `${count} request(s) captured so far.`,
    inspectorsEmpty: 'No requests captured yet — click "Simulate request".',
    jsonStudio: "JSON Studio: available in the full extension.",
    breakpointViewer: "Full-screen Breakpoint Viewer: available in the full extension.",
  },
  about: {
    eyebrow: "What it is",
    title: "A QA bar that lives inside your page",
    lead: "QA Toolbar Sandbox is a browser extension that injects a context bar and a testing toolkit into any site: tag the client, project, product and environment you're testing, capture evidence (screenshots, recordings, visual markers), inspect network requests, freeze the clock, force HTTP responses and emulate breakpoints — all without leaving the tab.",
    mission: {
      title: "Mission",
      body: "Give everyone who tests software a context bar always at hand — without relying on spreadsheets, extra tabs, or memory to know what's being validated.",
    },
    vision: {
      title: "Vision",
      body: "Become the standard companion for manual QA: as natural as the browser itself, on any team, in any product.",
    },
    values: {
      title: "Values",
      body: "Transparency in evidence, respect for human judgment, and automation that accelerates — never replaces — the tester's critical eye.",
    },
  },
  semiauto: {
    eyebrow: "Semi-automated Testing",
    titleLine1: "Manual testing with an",
    titleGradient: "automated flavor",
    body: "We don't take the human out of the loop — we just speed them up. QA Toolbar Sandbox handles the repetitive work (context, evidence, network capture, timers) while you keep the critical eye no automation can replace. It's manual testing, with an automated flavor.",
    gifAlt: "Energetic flavor, automated flavor",
  },
  pricing: {
    eyebrow: "Pricing",
    title: "Start free, grow at your pace",
    lead: "Choose the plan that fits your routine. Sign in or create an account only when you decide to continue.",
    voucherPlaceholder: "Voucher code",
    voucherApply: "Apply",
    voucherAppliedSuffix: "applied",
    voucherErrorEmpty: "Enter a voucher code.",
    voucherErrorInvalid: "Invalid or expired voucher.",
    recommendedBadge: "Best value",
    perMonth: "per month",
    perYear: "per year",
    billingMonthly: "Monthly",
    billingYearly: "Yearly",
    billingYearlySavings: "save up to 20%",
    free: "Free",
    freeNote: "Free for 30 days, then pick a plan",
    ctaFree: "Start for free",
    ctaPaid: "Subscribe",
    checkoutPending: "Payment received. We are confirming your access.",
    accountTitle: "Your account",
    accountLead: "Access your plans, vouchers, and the extension with the same email.",
    emailLabel: "Email",
    passwordLabel: "Password (8 characters minimum)",
    signIn: "Sign in",
    signUp: "Create account",
    signOut: "Sign out",
    signedInAs: "Signed in as",
    acceptTerms: "I have read and accept the Privacy Policy to create my account.",
    privacyLink: "Read the policy",
    authRequired: "Sign in or create your account before choosing a plan.",
    confirmationSent: "Check your email and confirm the account before signing in.",
    emailLink: "Email me a sign-in link",
    emailLinkSent: "If the account is registered, the sign-in link will arrive in your email.",
    invalidCredentials: "Incorrect email or password. You can also request a sign-in link.",
    signupFailed: "The account could not be created. Check the details or try signing in.",
    termsRequired: "Accept the Privacy Policy to create your account.",
    closeModal: "Close",
    configUnavailable: "Access is temporarily unavailable. Try again in a moment.",
    pricingUnavailable: "Official prices could not be loaded right now.",
    voucherQueued: "will be applied when you choose the plan",
    accessActive: "Active access",
    accessPermanent: "no expiration date",
    accessExpires: "valid until",
    installExtension: "Install official extension",
    paymentProcessing: "Payment received. We are confirming your access.",
    paymentCanceled: "Checkout canceled. No access was granted.",
    checkoutFailed: "This step could not be completed. Review the details and try again.",
    working: "Please wait…",
    forgotPassword: "Forgot my password",
    forgotPasswordEmailRequired: "Type your email above to receive the reset link.",
    forgotPasswordSent: "We sent a link to reset your password. Check your email.",
    forgotPasswordFailed: "Could not send the link right now. Try again in a moment.",
    alreadySubscribed: "You already have an active subscription. To change plans, contact support.",
    currentPlanBadge: "Your current plan",
    currentPlanCta: "Current plan",
    unavailableWhileSubscribed: "Unavailable — active subscription",
    plans: {
      "smoke-test": {
        name: "Smoke Test",
        tagline: "To see if this works for you",
        features: [
          "Full toolbar on any site",
          "1 workspace (client/project/product)",
          "Basic evidence (screenshot + markers)",
          "Character counter and Multiclick",
          "Email support",
        ],
      },
      "regression-runner": {
        name: "Regression Runner",
        tagline: "For everyday testers",
        features: [
          "Everything in Smoke Test",
          "Unlimited workspaces",
          "Video evidence recording",
          "Network Inspectors + JSON Studio",
          "Input Lab and Faker Fill (synthetic test data)",
        ],
      },
      "root-cause-analyst": {
        name: "Root Cause Analyst",
        tagline: "The best value for QA teams",
        features: [
          "Everything in Regression Runner",
          "Full-screen Breakpoint Viewer",
          "Freeze Clock + Force HTTP",
          "Macro Studio (record, replay and Playwright export)",
          "Team workspace import/export",
          "Priority support",
        ],
      },
      "release-manager": {
        name: "Release Manager",
        tagline: "Full access, no limits",
        features: [
          "Everything in Root Cause Analyst",
          "Key View (on-screen shortcuts, typing and mouse)",
          "Unlimited use of every feature",
          "Multiple teams and shared workspaces",
          "Dedicated onboarding",
        ],
      },
    },
  },
  support: {
    eyebrow1: "Support & suggestions",
    title1: "Found a bug or have an idea?",
    body1: "Every suggestion becomes roadmap. Write to contato@matheusbonotto.com.br with as much context as possible — screenshot, steps, and what you expected to see.",
    cta1: "Send a message",
    eyebrow2: "Custom project",
    title2: "Need something tailor-made?",
    body2: "Integrations, corporate workspaces, SSO, custom reports — tell us what your team needs and we'll build a specific proposal.",
    cta2: "Talk about my project",
  },
  footer: {
    navAbout: "About",
    navPricing: "Pricing",
    navSupport: "Support",
    navPrivacy: "Privacy Policy",
    creditPrefix: "built by",
  },
  privacy: {
    back: "← Back to the homepage",
    eyebrow: "Privacy Policy",
    title: "What QA Toolbar Sandbox asks from your browser",
    lead: "This page explains, in plain language, which permissions the extension requests, why each one is needed, and how we handle the data you enter into your workspace.",
    permissionsTitle: "Requested permissions",
    permissions: [
      { name: "storage", reason: "Store your workspace (clients, projects, products, environments) locally in the browser, without sending it to external servers." },
      { name: "scripting", reason: "Inject the QA bar and testing tools into the page you're visiting, only when you trigger it." },
      { name: "activeTab / tabs", reason: "Know which tab the bar should appear on and capture screenshots of the active tab when you trigger the evidence button." },
      { name: "host_permissions (all sites)", reason: "Let you use the extension on any site by default — you can restrict this in the extension's settings." },
    ],
    dataTitle: "Where your data lives",
    dataBody: "Clients, projects, products, environments and evidence you create are stored locally in your browser (chrome.storage.local), tied to your Chrome user profile. We don't collect or transmit your workspace content to our servers.",
    accountTitle: "Account and billing",
    accountBody: "When you create an account — whether from the landing page or the extension — we collect your email and payment information processed directly by Stripe (we never store card data on our servers). By continuing, you consent to this policy and the terms of use.",
    contactTitle: "Contact",
    contactBody: "Questions about privacy? Write to contato@matheusbonotto.com.br.",
  },
  resetPassword: {
    eyebrow: "QA Toolbar Sandbox",
    title: "Reset password",
    lead: "Choose a new password for your account.",
    newPasswordLabel: "New password",
    confirmPasswordLabel: "Confirm new password",
    submit: "Finish",
    working: "Please wait…",
    success: "Password updated. You can now sign in with the new password.",
    successCta: "Back to home",
    mismatch: "Passwords do not match.",
    tooShort: "Password must be at least 8 characters.",
    invalidLink: "This reset link is invalid or has expired. Request a new one from \"Forgot my password\".",
    genericError: "Could not update your password right now. Try again.",
    backLink: "Back to home",
  },
};

export const translations: Record<Locale, Dictionary> = { "pt-BR": pt, es, en };
