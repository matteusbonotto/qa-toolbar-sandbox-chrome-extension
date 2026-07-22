// Classic-script tutorial content shared by the Tutorial panel in options.js. One module per
// step: the first ("workspace") walks through preparing a workspace via the same CRUD already in
// the "Workspace" panel; every other module maps 1:1 to a toolbar tool/shortcut and matches the
// key used in PLAN_GATED_TOOLS (toolbar.js) or preferences.pinnedTools (storage-content.js), so
// the Tutorial panel can reuse the exact same plan-feature check the toolbar already applies
// instead of re-deriving locking logic. Copy adapted from apps/landing/src/i18n/translations.ts
// (features.items), rewritten from "what this is" to "do this now".
//
// Adding a new tool later? This is the ONLY place that needs a new entry -- the FAQ panel
// (faq-data.js + options.js renderFaqPanel) generates its "Para que serve X?" question straight
// from this array, so it never needs a matching edit:
//   1. Add one object below (key/title/short/instructions/screenshot/planFeature). `key` must be
//      unique; `planFeature` is the "toolKey.enabled" string from PLAN_GATED_TOOLS in toolbar.js,
//      or null if the tool isn't plan-gated.
//   2. Add the new title/short/instructions strings to the es/en dictionaries in
//      apps/extension/src/options/options-i18n.js (exact pt-BR text as the key -- see the other
//      entries there for the pattern).
//   3. Optional: capture a real screenshot into tutorial-assets/ (scripts/capture-tutorial-media.mjs)
//      and point `screenshot` at it; until then the module still renders fine with a broken-image
//      placeholder.
// No changes needed anywhere else -- the Tutorial panel, progress bar, lock badges and FAQ all
// read this array directly.
(() => {
  const TUTORIAL_MODULES = [
    {
      key: "workspace",
      title: "Prepare seu workspace",
      short: "Cadastre cliente, projeto, produto, ambiente e URL antes de testar.",
      instructions: "Abra a aba Workspace e cadastre, nessa ordem: um cliente, um projeto dentro dele, um produto dentro do projeto, um ambiente (ex.: QA) e uma URL vinculando produto e ambiente. É essa cadeia que faz a barra aparecer automaticamente quando você abre uma página com a URL cadastrada.",
      screenshot: "tutorial-assets/workspace-setup.png",
      planFeature: null,
    },
    {
      key: "testStatus",
      title: "Test Status",
      short: "Marca Pass, Fail, Blocked ou Limitation em um clique.",
      instructions: "Com a barra visível, clique em \"Test Status\" e escolha um dos quatro status. O resultado é registrado com a URL e o horário atual, sem precisar copiar isso à mão para outro lugar.",
      screenshot: "tutorial-assets/test-status.png",
      planFeature: null,
    },
    {
      key: "passFail",
      title: "Marcadores Pass/Fail",
      short: "Aponte exatamente onde um elemento passou ou falhou.",
      instructions: "Clique no botão de marcador (✓ ou ✕) e depois clique em qualquer ponto da página para deixar o marcador visual ali, antes de tirar o screenshot de evidência.",
      screenshot: "tutorial-assets/pass-fail.png",
      planFeature: null,
    },
    {
      key: "notesShapes",
      title: "Notas e formas",
      short: "Anotações de texto e destaques desenhados sobre a página.",
      instructions: "Abra o menu de notas, arraste uma nota de texto ou uma forma de destaque sobre a área da página que você quer documentar. Dá pra mover e editar depois de posicionar.",
      screenshot: null,
      planFeature: null,
    },
    {
      key: "screenshot",
      title: "Screenshot",
      short: "Captura instantânea da tela com um clique.",
      instructions: "Com os marcadores e anotações já posicionados, clique no botão de câmera para gerar a evidência pronta para anexar no chamado ou no card do board.",
      screenshot: "tutorial-assets/screenshot.png",
      planFeature: null,
    },
    {
      key: "recording",
      title: "Gravação de evidências",
      short: "Grava a tela em vídeo enquanto você testa.",
      instructions: "Clique no botão de gravação para começar e de novo para parar. O vídeo (MP4/GIF conforme o plano) sai pronto para anexar, sem precisar de outro software rodando em paralelo.",
      screenshot: null,
      planFeature: null,
    },
    {
      key: "clickSpy",
      title: "Click Spy",
      short: "Destaca visualmente cada elemento clicável ao passar o mouse.",
      instructions: "Ative o Click Spy no menu de ferramentas e passe o mouse pela página: cada elemento clicável sob o cursor é contornado em tempo real, útil para mapear a área clicável real antes de escrever um passo de teste.",
      screenshot: "tutorial-assets/click-spy.png",
      planFeature: null,
    },
    {
      key: "freezeClock",
      title: "Freeze Clock",
      short: "Congela a data/hora do navegador no momento que você escolher.",
      instructions: "Abra o Freeze Clock, escolha a data/hora desejada e confirme. A página passa a enxergar aquele instante fixo, útil para testar regras de expiração, promoção ou fuso horário.",
      screenshot: "tutorial-assets/freeze-clock.png",
      planFeature: null,
    },
    {
      key: "forceHttp",
      title: "Force HTTP",
      short: "Simula respostas de erro (400, 404, 500...) sob demanda.",
      instructions: "Abra o Force HTTP, escolha o status de erro desejado e confirme. A próxima requisição de rede retorna esse status, para testar como a tela reage a falhas sem derrubar o backend de verdade.",
      screenshot: "tutorial-assets/force-http.png",
      planFeature: null,
    },
    {
      key: "errorMonitor",
      title: "Error Monitor",
      short: "Registra automaticamente os erros HTTP que acontecerem na página.",
      instructions: "Abra o Error Monitor e navegue normalmente pela página: toda resposta de rede com status de erro aparece na lista em tempo real, com contador na barra, sem precisar configurar nada antes.",
      screenshot: null,
      planFeature: null,
    },
    {
      key: "inspectors",
      title: "Inspectors",
      short: "Lista ao vivo das respostas de API relevantes para o seu teste.",
      instructions: "Cadastre um padrão de URL em Workspace → Integrações → Inspectors e depois abra o painel de Inspectors: só as chamadas que batem com esse padrão aparecem, filtráveis por método, status e origem.",
      screenshot: null,
      planFeature: null,
    },
    {
      key: "jsonStudio",
      title: "JSON Studio",
      short: "Formata, comprime e copia payloads JSON.",
      instructions: "A partir de uma resposta capturada nos Inspectors, clique para abrir no JSON Studio: o payload aparece formatado e legível, com atalho para compactar ou copiar.",
      screenshot: null,
      planFeature: null,
    },
    {
      key: "breakpoints",
      title: "Breakpoint Viewer (Responsive View)",
      short: "Veja a mesma página em vários tamanhos de tela ao mesmo tempo.",
      instructions: "Abra o Breakpoint Viewer para renderizar a página lado a lado em molduras de laptop e celular sincronizadas, e pegar problemas de layout responsivo sem redimensionar a janela.",
      screenshot: null,
      planFeature: null,
    },
    {
      key: "characterCounter",
      title: "Contador de caracteres",
      short: "Conta caracteres, palavras, linhas e bytes UTF-8.",
      instructions: "Selecione um texto na página (ou cole um texto) e abra o Contador de caracteres: a contagem com e sem espaços aparece direto na barra, sem precisar de uma calculadora externa.",
      screenshot: null,
      planFeature: "characterCounter.enabled",
    },
    {
      key: "multiClick",
      title: "Multiclick",
      short: "Clica no mesmo elemento várias vezes, no intervalo que você definir.",
      instructions: "Abra o Multiclick, selecione visualmente um elemento na página, escolha entre 2 e 100 cliques e o intervalo entre eles, e confirme para testar debounce ou double-submit.",
      screenshot: null,
      planFeature: "multiClick.enabled",
    },
    {
      key: "inputLab",
      title: "Input Lab",
      short: "Testa um campo com texto, número, Unicode e excesso de caracteres.",
      instructions: "Selecione um campo de input e abra o Input Lab: ele roda o kit de validação (vazio, texto, número, Unicode, limite excedido) sem enviar o formulário e restaura o valor original ao final.",
      screenshot: null,
      planFeature: "inputLab.enabled",
    },
    {
      key: "fakerFill",
      title: "Faker Fill",
      short: "Preenche a página ou um formulário com dados sintéticos realistas.",
      instructions: "Abra o Faker Fill e escolha preencher a página inteira ou só o formulário focado: nome, e-mail e outros campos comuns são preenchidos com dados fictícios, sempre pulando senha, cartão, CVV e token.",
      screenshot: null,
      planFeature: "fakerFill.enabled",
    },
    {
      key: "macroStudio",
      title: "Macro Studio",
      short: "Grava uma sequência de ações e reproduz depois, quando quiser.",
      instructions: "Abra o Macro Studio, clique em gravar e navegue normalmente (clique, digitação, seleção); pare a gravação, revise no modo Vibe Code, salve e fixe no menu para reexecutar em um clique.",
      screenshot: null,
      planFeature: "macroStudio.enabled",
    },
    {
      key: "keyView",
      title: "Key View",
      short: "Mostra na tela os atalhos de teclado e cliques do mouse em tempo real.",
      instructions: "Ative o Key View nas configurações de aparência: combinações de teclado aparecem como teclas com efeito 3D, e cliques esquerdo/direito/meio ficam visualmente indicados, ideal para gravações e demonstrações.",
      screenshot: null,
      planFeature: "keyView.enabled",
    },
    {
      key: "elementCapture",
      title: "Capturar Elementos",
      short: "Exporta um CSV com todos os elementos interativos da página, prontos para automação.",
      instructions: "Abra Capturar Elementos e confirme: a extensão escaneia a página atual e gera um CSV com tag, seletor CSS, XPath e texto visível de cada elemento interativo, pronto para acelerar a criação de testes de automação.",
      screenshot: "tutorial-assets/element-capture.png",
      planFeature: "elementCapture.enabled",
    },
    {
      key: "testAccounts",
      title: "Contas de teste",
      short: "Credenciais sandbox por ambiente, sempre mascaradas.",
      instructions: "Cadastre uma conta de teste em Workspace → Contas, vinculada ao ambiente ativo, e depois acesse ela pelo menu da barra: usuário e senha aparecem mascarados e nunca entram na exportação.",
      screenshot: null,
      planFeature: null,
    },
    {
      key: "paymentMethods",
      title: "Meios de pagamento",
      short: "Cartões de teste sandbox, filtrados pelo ambiente atual.",
      instructions: "Cadastre um cartão sandbox em Workspace → Pagamentos e acesse pelo menu da barra na hora de testar um checkout, sem precisar procurar a documentação do gateway toda vez.",
      screenshot: null,
      planFeature: null,
    },
    {
      key: "resources",
      title: "Recursos e links",
      short: "Atalhos para documentação e ferramentas do projeto, direto no menu.",
      instructions: "Cadastre um link útil (documentação, board, staging) em Workspace → Integrações → Recursos, associado ao ambiente ativo, e acesse pelo menu da barra sem precisar de aba fixada.",
      screenshot: null,
      planFeature: null,
    },
  ];

  window.QTS_TUTORIAL_DATA = Object.freeze(TUTORIAL_MODULES.map((module) => Object.freeze(module)));
})();
