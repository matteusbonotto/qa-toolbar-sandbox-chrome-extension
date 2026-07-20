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
    features: string;
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
  features: {
    eyebrow: string;
    title: string;
    lead: string;
    groups: Record<string, { title: string; description: string }>;
    items: Record<string, { title: string; short: string; details: string }>;
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
    downloadExtensionZip: string;
    downloadExtensionHint: string;
    packageVersionLine: string;
    storeReviewPendingNotice: string;
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
    features: "Ferramentas",
    pricing: "Planos",
    support: "Suporte",
    install: "Entrar",
  },
  hero: {
    eyebrow: "QA Toolbar Sandbox",
    titleLine1: "Teste manual de verdade,",
    titleGradient: "sem se perder entre ambientes e projetos",
    lead: "O QA Toolbar Sandbox roda direto na página que você já está testando: mostra sempre onde você está, registra evidências num clique e cuida do trabalho repetitivo — pra sua atenção sobrar pro que só um humano faz bem, que é pensar como testador.",
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
  features: {
    eyebrow: "Ferramentas",
    title: "O que muda no seu dia de testes",
    lead: "O ganho real não é a quantidade de recursos — é nunca mais se perder entre abas de ambientes e projetos diferentes enquanto testa manualmente. Cada grupo abaixo é o que está de verdade no menu Tools da extensão; clique para abrir e ver como funciona.",
    groups: {
      evidence: {
        title: "Evidências e resultado do teste",
        description: "Registre o que aconteceu sem sair da página nem abrir outra ferramenta.",
      },
      inspection: {
        title: "Depuração e inspeção técnica",
        description: "Enxergue rede, JSON e comportamento responsivo sem abrir o DevTools.",
      },
      productivityKit: {
        title: "Kit de produtividade QA",
        description: "Tarefas repetitivas de teste de formulário, resolvidas em segundos.",
      },
      macroStudio: {
        title: "Automação declarativa",
        description: "Grave uma vez, reproduza sempre — sem escrever uma linha de código.",
      },
      keyView: {
        title: "Key View",
        description: "Mostre na tela o que você está digitando e clicando, em tempo real.",
      },
      sandboxData: {
        title: "Contas e dados sandbox",
        description: "Credenciais e cartões de teste ao alcance, nunca expostos por engano.",
      },
    },
    items: {
      testStatus: {
        title: "Test Status",
        short: "Marca Pass, Fail, Blocked ou Limitation em um clique.",
        details: "Um menu com quatro status (✓ Pass, ✕ Fail, ⛔ Blocked, △ Limitation) registra o resultado do caso de teste direto na página, com a URL e o horário — sem precisar copiar isso à mão para uma planilha ou ferramenta externa enquanto o contexto ainda está fresco na tela.",
      },
      passFail: {
        title: "Marcadores Pass/Fail",
        short: "Aponte exatamente onde um elemento passou ou falhou.",
        details: "Clique em qualquer ponto da página para deixar um marcador visual de ✓ ou ✕ ali mesmo — ótimo para apontar precisamente qual botão, campo ou seção falhou antes de tirar o screenshot de evidência, sem precisar desenhar isso depois numa ferramenta de imagem.",
      },
      notesShapes: {
        title: "Notas e formas",
        short: "Anotações de texto e destaques desenhados sobre a página.",
        details: "Notas de texto arrastáveis e formas de destaque ficam sobrepostas à página real, permitindo documentar um bug com contexto visual completo — sem precisar de outra aba pra escrever a descrição do problema.",
      },
      screenshot: {
        title: "Screenshot",
        short: "Captura instantânea da tela com um clique.",
        details: "Gera a evidência de screenshot no momento exato do teste, já com os marcadores e anotações visíveis, pronta para anexar no chamado ou no card do board.",
      },
      recording: {
        title: "Gravação de evidências",
        short: "Grava a tela em vídeo enquanto você testa.",
        details: "Inicia e para a gravação de vídeo (MP4/GIF conforme o plano) direto da barra, sem precisar de um software de gravação de tela separado rodando em paralelo — a evidência sai pronta pra anexar.",
      },
      inspectors: {
        title: "Inspectors",
        short: "Lista ao vivo das respostas de API relevantes para o seu teste.",
        details: "Captura chamadas de rede que batem com padrões de URL que você configura por ambiente — só o que importa para o seu teste aparece, filtrável por método, status e origem, sem o ruído de uma aba de Network genérica do navegador.",
      },
      jsonStudio: {
        title: "JSON Studio",
        short: "Formata, comprime e copia payloads JSON.",
        details: "Abre qualquer resposta capturada já formatada e legível, com atalho para compactar ou copiar — sem precisar colar o JSON cru em um site externo de formatação toda vez que precisar ler uma resposta de API.",
      },
      forceHttp: {
        title: "Force HTTP",
        short: "Simula respostas de erro (400, 404, 500...) sob demanda.",
        details: "Força a próxima resposta de rede a simular um status de erro específico, pra testar como a tela se comporta em cenários de falha sem precisar derrubar o backend ou esperar um erro acontecer de verdade.",
      },
      freezeClock: {
        title: "Freeze Clock",
        short: "Congela a data/hora do navegador no momento que você escolher.",
        details: "Trava o relógio da página num instante específico para testar regras dependentes de data (promoções, expiração, fuso horário) de forma determinística, sem precisar mudar a data do sistema operacional inteiro.",
      },
      clickSpy: {
        title: "Click Spy",
        short: "Destaca visualmente cada elemento clicável ao passar o mouse.",
        details: "Contorna em tempo real qualquer elemento clicável sob o cursor, útil para mapear rapidamente a área clicável real de um componente antes de escrever um passo de teste ou reportar uma área de clique errada.",
      },
      breakpointViewer: {
        title: "Breakpoint Viewer (Responsive View)",
        short: "Veja a mesma página em vários tamanhos de tela ao mesmo tempo.",
        details: "Renderiza a página lado a lado em molduras de laptop e celular sincronizadas, pra pegar problema de layout responsivo sem precisar redimensionar a janela do navegador nem alternar entre dispositivos no DevTools.",
      },
      characterCounter: {
        title: "Contador de caracteres",
        short: "Conta caracteres, palavras, linhas e bytes UTF-8.",
        details: "Mede o texto selecionado na página (ou qualquer texto colado) com e sem espaços — direto na barra, sem abrir uma calculadora de caracteres em outra aba pra validar limite de campo.",
      },
      multiClick: {
        title: "Multiclick",
        short: "Clica no mesmo elemento várias vezes, no intervalo que você definir.",
        details: "Selecione visualmente um elemento, escolha de 2 a 100 cliques e o intervalo entre eles — útil pra testar debounce, double-submit e comportamento sob cliques repetidos sem ficar clicando manualmente.",
      },
      inputLab: {
        title: "Input Lab",
        short: "Testa um campo com texto, número, Unicode e excesso de caracteres.",
        details: "Roda um kit de validação (vazio, texto, número, caracteres especiais, Unicode, limite excedido) num input selecionado, sem enviar o formulário, e restaura o valor original ao final — cobre casos de borda que normalmente exigiriam digitar cada um manualmente.",
      },
      fakerFill: {
        title: "Faker Fill",
        short: "Preenche a página ou um formulário com dados sintéticos realistas.",
        details: "Preenche automaticamente nome, e-mail, endereço e outros campos comuns com dados fictícios plausíveis, pulando sempre senha, cartão, CVV, token e segredo — acelera o preenchimento repetitivo sem tocar em dado sensível.",
      },
      macroStudio: {
        title: "Macro Studio",
        short: "Grava uma sequência de ações e reproduz depois, quando quiser.",
        details: "Grava clique, digitação, seleção, checkbox e tecla enquanto você navega normalmente; revise o fluxo no modo Vibe Code (arrastar e soltar), salve, fixe no menu para reexecutar em um clique, e use o Coder para copiar a mesma sequência como um teste Playwright real — sem escrever nenhuma linha de código para gravar e reproduzir.",
      },
      keyView: {
        title: "Key View",
        short: "Mostra na tela os atalhos de teclado e cliques do mouse em tempo real.",
        details: "Exibe combinações de teclado (ex.: Ctrl+V) como teclas com efeito 3D que desaparecem sozinhas, um modo Typing que acumula o que foi digitado até você limpar, e um indicador visual de clique esquerdo/direito/meio e scroll — ideal para gravações e demonstrações onde a plateia precisa ver exatamente o que você está fazendo.",
      },
      testAccounts: {
        title: "Contas de teste",
        short: "Credenciais sandbox por ambiente, sempre mascaradas.",
        details: "Guarda usuário e senha de teste vinculados ao ambiente ativo, mascarados na barra e nunca incluídos na exportação — acaba com a busca por credencial de teste perdida numa nota ou planilha compartilhada.",
      },
      paymentMethods: {
        title: "Meios de pagamento",
        short: "Cartões de teste sandbox, filtrados pelo ambiente atual.",
        details: "Mantém números de cartão de teste organizados por ambiente e mascarados na barra, prontos pra copiar na hora de testar um checkout sem precisar procurar a documentação do gateway de pagamento toda vez.",
      },
      resources: {
        title: "Recursos e links",
        short: "Atalhos para documentação e ferramentas do projeto, direto no menu.",
        details: "Guarda links úteis (documentação, board, ambiente de staging) associados ao ambiente ativo, com URL validada antes de abrir — menos abas fixadas manualmente no navegador para lembrar onde estava cada coisa.",
      },
    },
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
    downloadExtensionZip: "Baixar extensão (.zip)",
    downloadExtensionHint: "Não quer esperar a análise da Chrome Web Store? Baixe o pacote, abra chrome://extensions, ative o Modo do desenvolvedor e clique em \"Carregar sem compactação\".",
    packageVersionLine: "Versão atual do pacote: v{version}",
    storeReviewPendingNotice: "Em breve na Chrome Web Store — em análise do Google.",
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
    features: "Herramientas",
    pricing: "Planes",
    support: "Soporte",
    install: "Entrar",
  },
  hero: {
    eyebrow: "QA Toolbar Sandbox",
    titleLine1: "Pruebas manuales de verdad,",
    titleGradient: "sin perderte entre entornos y proyectos",
    lead: "QA Toolbar Sandbox corre directo en la página que ya estás probando: siempre muestra dónde estás, registra evidencias con un clic y se encarga del trabajo repetitivo — para que tu atención quede libre para lo que solo un humano hace bien: pensar como tester.",
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
  features: {
    eyebrow: "Herramientas",
    title: "Lo que cambia en tu día de pruebas",
    lead: "La ganancia real no es la cantidad de funciones — es no volver a perderte entre pestañas de distintos entornos y proyectos mientras pruebas manualmente. Cada grupo de abajo es lo que realmente está en el menú Tools de la extensión; haz clic para ver cómo funciona.",
    groups: {
      evidence: {
        title: "Evidencias y resultado de la prueba",
        description: "Registra lo que pasó sin salir de la página ni abrir otra herramienta.",
      },
      inspection: {
        title: "Depuración e inspección técnica",
        description: "Observa red, JSON y comportamiento responsivo sin abrir el DevTools.",
      },
      productivityKit: {
        title: "Kit de productividad QA",
        description: "Tareas repetitivas de formularios, resueltas en segundos.",
      },
      macroStudio: {
        title: "Automatización declarativa",
        description: "Graba una vez, reproduce siempre — sin escribir una línea de código.",
      },
      keyView: {
        title: "Key View",
        description: "Muestra en pantalla lo que estás escribiendo y clicando, en tiempo real.",
      },
      sandboxData: {
        title: "Cuentas y datos sandbox",
        description: "Credenciales y tarjetas de prueba a mano, nunca expuestas por error.",
      },
    },
    items: {
      testStatus: {
        title: "Test Status",
        short: "Marca Pass, Fail, Blocked o Limitation con un clic.",
        details: "Un menú con cuatro estados (✓ Pass, ✕ Fail, ⛔ Blocked, △ Limitation) registra el resultado del caso de prueba directo en la página, con la URL y la hora — sin copiarlo a mano a una hoja de cálculo mientras el contexto sigue fresco en pantalla.",
      },
      passFail: {
        title: "Marcadores Pass/Fail",
        short: "Señala exactamente dónde un elemento pasó o falló.",
        details: "Haz clic en cualquier punto de la página para dejar un marcador visual de ✓ o ✕ ahí mismo — ideal para apuntar con precisión qué botón, campo o sección falló antes de tomar la captura de evidencia.",
      },
      notesShapes: {
        title: "Notas y formas",
        short: "Anotaciones de texto y resaltados dibujados sobre la página.",
        details: "Notas de texto arrastrables y formas de resaltado se superponen a la página real, permitiendo documentar un bug con contexto visual completo — sin necesitar otra pestaña para escribir la descripción del problema.",
      },
      screenshot: {
        title: "Captura de pantalla",
        short: "Captura instantánea con un clic.",
        details: "Genera la evidencia de captura en el momento exacto de la prueba, ya con los marcadores y anotaciones visibles, lista para adjuntar al ticket o a la tarjeta del board.",
      },
      recording: {
        title: "Grabación de evidencias",
        short: "Graba la pantalla en video mientras pruebas.",
        details: "Inicia y detiene la grabación de video (MP4/GIF según el plan) directo desde la barra, sin necesitar un software de grabación aparte — la evidencia queda lista para adjuntar.",
      },
      inspectors: {
        title: "Inspectors",
        short: "Lista en vivo de las respuestas de API relevantes para tu prueba.",
        details: "Captura llamadas de red que coinciden con patrones de URL configurados por entorno — solo lo que importa para tu prueba aparece, filtrable por método, estado y origen, sin el ruido de una pestaña de Network genérica del navegador.",
      },
      jsonStudio: {
        title: "JSON Studio",
        short: "Formatea, comprime y copia payloads JSON.",
        details: "Abre cualquier respuesta capturada ya formateada y legible, con acceso directo para compactar o copiar — sin pegar el JSON crudo en un sitio externo cada vez que necesitas leer una respuesta de API.",
      },
      forceHttp: {
        title: "Force HTTP",
        short: "Simula respuestas de error (400, 404, 500...) bajo demanda.",
        details: "Fuerza la próxima respuesta de red a simular un estado de error específico, para probar cómo se comporta la pantalla en escenarios de fallo sin tumbar el backend ni esperar a que ocurra un error real.",
      },
      freezeClock: {
        title: "Freeze Clock",
        short: "Congela la fecha/hora del navegador en el momento que elijas.",
        details: "Fija el reloj de la página en un instante específico para probar reglas dependientes de fecha (promociones, expiración, zona horaria) de forma determinística, sin cambiar la fecha de todo el sistema operativo.",
      },
      clickSpy: {
        title: "Click Spy",
        short: "Resalta visualmente cada elemento clicable al pasar el mouse.",
        details: "Contornea en tiempo real cualquier elemento clicable bajo el cursor, útil para mapear rápidamente el área clicable real de un componente antes de escribir un paso de prueba.",
      },
      breakpointViewer: {
        title: "Breakpoint Viewer (Responsive View)",
        short: "Mira la misma página en varios tamaños de pantalla a la vez.",
        details: "Renderiza la página lado a lado en marcos de laptop y celular sincronizados, para detectar problemas de diseño responsivo sin redimensionar la ventana ni alternar dispositivos en el DevTools.",
      },
      characterCounter: {
        title: "Contador de caracteres",
        short: "Cuenta caracteres, palabras, líneas y bytes UTF-8.",
        details: "Mide el texto seleccionado en la página (o cualquier texto pegado) con y sin espacios — directo en la barra, sin abrir una calculadora de caracteres en otra pestaña.",
      },
      multiClick: {
        title: "Multiclick",
        short: "Clica el mismo elemento varias veces, en el intervalo que definas.",
        details: "Selecciona visualmente un elemento, elige de 2 a 100 clics y el intervalo entre ellos — útil para probar debounce, doble envío y comportamiento bajo clics repetidos sin clicar manualmente.",
      },
      inputLab: {
        title: "Input Lab",
        short: "Prueba un campo con texto, número, Unicode y exceso de caracteres.",
        details: "Ejecuta un kit de validación (vacío, texto, número, caracteres especiales, Unicode, límite excedido) en un input seleccionado, sin enviar el formulario, y restaura el valor original al final.",
      },
      fakerFill: {
        title: "Faker Fill",
        short: "Rellena la página o un formulario con datos sintéticos realistas.",
        details: "Rellena automáticamente nombre, correo, dirección y otros campos comunes con datos ficticios plausibles, siempre saltando contraseña, tarjeta, CVV, token y secreto.",
      },
      macroStudio: {
        title: "Macro Studio",
        short: "Graba una secuencia de acciones y repítela cuando quieras.",
        details: "Graba clic, escritura, selección, checkbox y tecla mientras navegas normalmente; revisa el flujo en modo Vibe Code (arrastrar y soltar), guárdalo, fíjalo en el menú para reejecutarlo con un clic, y usa Coder para copiar la misma secuencia como una prueba Playwright real.",
      },
      keyView: {
        title: "Key View",
        short: "Muestra en pantalla los atajos de teclado y clics del mouse en tiempo real.",
        details: "Muestra combinaciones de teclado (ej.: Ctrl+V) como teclas con efecto 3D que desaparecen solas, un modo Typing que acumula lo escrito hasta que lo limpies, y un indicador visual de clic izquierdo/derecho/central y scroll — ideal para grabaciones y demostraciones.",
      },
      testAccounts: {
        title: "Cuentas de prueba",
        short: "Credenciales sandbox por entorno, siempre enmascaradas.",
        details: "Guarda usuario y contraseña de prueba vinculados al entorno activo, enmascarados en la barra y nunca incluidos en la exportación.",
      },
      paymentMethods: {
        title: "Métodos de pago",
        short: "Tarjetas de prueba sandbox, filtradas por el entorno actual.",
        details: "Mantiene números de tarjeta de prueba organizados por entorno y enmascarados en la barra, listos para copiar al probar un checkout.",
      },
      resources: {
        title: "Recursos y enlaces",
        short: "Atajos a documentación y herramientas del proyecto, directo en el menú.",
        details: "Guarda enlaces útiles (documentación, board, entorno de staging) asociados al entorno activo, con URL validada antes de abrir.",
      },
    },
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
    downloadExtensionZip: "Descargar extensión (.zip)",
    downloadExtensionHint: "¿No quieres esperar la revisión de la Chrome Web Store? Descarga el paquete, abre chrome://extensions, activa el Modo de desarrollador y haz clic en \"Cargar descomprimida\".",
    packageVersionLine: "Versión actual del paquete: v{version}",
    storeReviewPendingNotice: "Próximamente en la Chrome Web Store — en revisión de Google.",
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
    features: "Tools",
    pricing: "Pricing",
    support: "Support",
    install: "Sign in",
  },
  hero: {
    eyebrow: "QA Toolbar Sandbox",
    titleLine1: "Manual testing, done right —",
    titleGradient: "without losing yourself across environments and projects",
    lead: "QA Toolbar Sandbox runs right inside the page you're already testing: it always shows where you are, logs evidence in one click, and handles the repetitive grind — so your attention stays free for the one thing only a human does well: thinking like a tester.",
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
  features: {
    eyebrow: "Tools",
    title: "What actually changes in your testing day",
    lead: "The real win isn't the number of features — it's never losing yourself across tabs from different environments and projects while testing manually again. Every group below is really in the extension's Tools menu; click to open it and see how it works.",
    groups: {
      evidence: {
        title: "Evidence and test result",
        description: "Record what happened without leaving the page or opening another tool.",
      },
      inspection: {
        title: "Debugging and technical inspection",
        description: "See network, JSON and responsive behavior without opening DevTools.",
      },
      productivityKit: {
        title: "QA productivity kit",
        description: "Repetitive form-testing chores, solved in seconds.",
      },
      macroStudio: {
        title: "Declarative automation",
        description: "Record once, replay any time — without writing a line of code.",
      },
      keyView: {
        title: "Key View",
        description: "Show what you're typing and clicking on screen, live.",
      },
      sandboxData: {
        title: "Sandbox accounts and data",
        description: "Test credentials and cards on hand, never exposed by accident.",
      },
    },
    items: {
      testStatus: {
        title: "Test Status",
        short: "Mark Pass, Fail, Blocked or Limitation in one click.",
        details: "A four-state menu (✓ Pass, ✕ Fail, ⛔ Blocked, △ Limitation) records the test case result right on the page, with the URL and timestamp — no copying it by hand into a spreadsheet while the context is still fresh on screen.",
      },
      passFail: {
        title: "Pass/Fail markers",
        short: "Point exactly where an element passed or failed.",
        details: "Click anywhere on the page to drop a visual ✓ or ✕ marker right there — great for pinpointing exactly which button, field or section failed before taking the evidence screenshot.",
      },
      notesShapes: {
        title: "Notes and shapes",
        short: "Text annotations and highlights drawn over the page.",
        details: "Draggable text notes and highlight shapes overlay the real page, letting you document a bug with full visual context — no separate tab needed to write up the problem description.",
      },
      screenshot: {
        title: "Screenshot",
        short: "Instant screen capture with one click.",
        details: "Generates the screenshot evidence at the exact moment of the test, already showing markers and annotations, ready to attach to the ticket or board card.",
      },
      recording: {
        title: "Evidence recording",
        short: "Records your screen on video while you test.",
        details: "Starts and stops video recording (MP4/GIF depending on the plan) right from the bar, no separate screen-recording software needed — the evidence comes out ready to attach.",
      },
      inspectors: {
        title: "Inspectors",
        short: "A live list of the API responses that matter for your test.",
        details: "Captures network calls matching URL patterns you configure per environment — only what matters for your test shows up, filterable by method, status and source, without the noise of a generic browser Network tab.",
      },
      jsonStudio: {
        title: "JSON Studio",
        short: "Formats, compacts and copies JSON payloads.",
        details: "Opens any captured response already formatted and readable, with a shortcut to compact or copy it — no pasting raw JSON into an external formatter site every time you need to read an API response.",
      },
      forceHttp: {
        title: "Force HTTP",
        short: "Simulates error responses (400, 404, 500...) on demand.",
        details: "Forces the next network response to simulate a specific error status, to test how the screen behaves in failure scenarios without taking down the backend or waiting for a real error to happen.",
      },
      freezeClock: {
        title: "Freeze Clock",
        short: "Freezes the browser's date/time at the moment you choose.",
        details: "Pins the page's clock to a specific instant to test date-dependent rules (promotions, expiration, timezone) deterministically, without changing the whole operating system's date.",
      },
      clickSpy: {
        title: "Click Spy",
        short: "Visually highlights every clickable element under the mouse.",
        details: "Outlines any clickable element under the cursor in real time, useful for quickly mapping a component's actual clickable area before writing a test step or reporting a wrong click zone.",
      },
      breakpointViewer: {
        title: "Breakpoint Viewer (Responsive View)",
        short: "See the same page at several screen sizes at once.",
        details: "Renders the page side by side in synced laptop and phone frames, to catch responsive layout issues without resizing the browser window or switching devices in DevTools.",
      },
      characterCounter: {
        title: "Character counter",
        short: "Counts characters, words, lines and UTF-8 bytes.",
        details: "Measures the text selected on the page (or any pasted text) with and without spaces — right in the bar, no separate character-counting tab needed to validate a field limit.",
      },
      multiClick: {
        title: "Multiclick",
        short: "Clicks the same element repeatedly, at the interval you set.",
        details: "Visually select an element, choose 2 to 100 clicks and the interval between them — useful for testing debounce, double-submit and behavior under repeated clicks without clicking manually yourself.",
      },
      inputLab: {
        title: "Input Lab",
        short: "Tests a field with text, numbers, Unicode and overflow.",
        details: "Runs a validation kit (empty, text, number, special characters, Unicode, overflow) against a selected input without submitting the form, and restores the original value afterward.",
      },
      fakerFill: {
        title: "Faker Fill",
        short: "Fills the page or a form with realistic synthetic data.",
        details: "Automatically fills name, email, address and other common fields with plausible fake data, always skipping password, card, CVV, token and secret fields.",
      },
      macroStudio: {
        title: "Macro Studio",
        short: "Records a sequence of actions and replays it any time you want.",
        details: "Records clicks, typing, selects, checkboxes and key presses while you browse normally; review the flow in Vibe Code mode (drag and drop), save it, pin it to the menu to re-run it in one click, and use Coder to copy that same sequence as a real Playwright test — no code needed to record or replay.",
      },
      keyView: {
        title: "Key View",
        short: "Shows keyboard shortcuts and mouse clicks on screen, live.",
        details: "Displays key combos (e.g. Ctrl+V) as 3D-styled keys that fade out on their own, a Typing mode that accumulates what you type until you clear it, and a visual indicator for left/right/middle click and scroll — ideal for recordings and demos where the audience needs to see exactly what you're doing.",
      },
      testAccounts: {
        title: "Test accounts",
        short: "Sandbox credentials per environment, always masked.",
        details: "Stores test username and password tied to the active environment, masked in the bar and never included in the export.",
      },
      paymentMethods: {
        title: "Payment methods",
        short: "Sandbox test cards, filtered by the current environment.",
        details: "Keeps test card numbers organized per environment and masked in the bar, ready to copy when testing a checkout.",
      },
      resources: {
        title: "Resources and links",
        short: "Shortcuts to project docs and tools, right in the menu.",
        details: "Stores useful links (docs, board, staging environment) tied to the active environment, with the URL validated before opening.",
      },
    },
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
    downloadExtensionZip: "Download extension (.zip)",
    downloadExtensionHint: "Don't want to wait for Chrome Web Store review? Download the package, open chrome://extensions, enable Developer mode and click \"Load unpacked\".",
    packageVersionLine: "Current package version: v{version}",
    storeReviewPendingNotice: "Coming soon to the Chrome Web Store — pending Google review.",
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
