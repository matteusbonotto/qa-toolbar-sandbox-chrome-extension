// Classic-script FAQ content shared by the FAQ panel in options.js. Only the general questions
// live here — per-tool entries ("Para que serve X?") are generated at render time from
// window.QTS_TUTORIAL_DATA (short + instructions) instead of duplicating that copy a second time.
(() => {
  const FAQ_GENERAL = [
    {
      key: "whatIsIt",
      question: "O que é o QA Toolbar Sandbox?",
      answer: "Uma extensão de navegador que injeta uma barra de contexto e um kit de ferramentas de teste em qualquer site: marque cliente, projeto, produto e ambiente, registre evidências, inspecione requisições de rede e muito mais, tudo sem sair da aba que você está testando.",
    },
    {
      key: "whereIsMyData",
      question: "Onde ficam guardados meus dados (workspace, contas de teste, macros)?",
      answer: "Localmente, no armazenamento do próprio navegador (chrome.storage.local), no seu computador. Nada do seu workspace é enviado para servidores só por existir; a conexão com a nuvem serve apenas para validar seu login e seu plano.",
    },
    {
      key: "trialPeriod",
      question: "Como funciona o período de teste gratuito?",
      answer: "Ao criar sua conta você recebe acesso completo por um período limitado, com os dias restantes visíveis nas configurações. Depois desse período o acesso volta para o nível do seu plano ativo; qualquer recurso fora do seu plano fica com um cadeado, e você pode liberá-lo a qualquer momento fazendo upgrade.",
    },
    {
      key: "lockedFeature",
      question: "Por que uma ferramenta aparece com cadeado?",
      answer: "O cadeado indica que essa ferramenta não está incluída no seu plano atual. Você ainda pode ver como ela funciona pelo tutorial, mas para usá-la de verdade é preciso fazer upgrade para um plano que inclua esse recurso.",
    },
    {
      key: "sensitiveData",
      question: "Senhas, cartões e tokens ficam seguros?",
      answer: "Campos sensíveis (senha, cartão, CVV, token) nunca são exportados em Capturar Elementos, nunca são preenchidos pelo Faker Fill, e ficam mascarados na barra quando exibidos a partir de Contas de teste ou Meios de pagamento.",
    },
    {
      key: "revisitTutorial",
      question: "Posso rever o tutorial depois de já ter concluído?",
      answer: "Sim. O painel Tutorial fica sempre disponível no menu de configurações e seu progresso continua salvo; use o botão \"Reiniciar\" ali se quiser refazer os passos do zero.",
    },
    {
      key: "recordingFormats",
      question: "Qual formato devo escolher para gravar uma evidência?",
      answer: "Use MP4 para uma evidência completa, com áudio, duração reconhecida e controles para avançar, pausar e voltar. Se o Chrome não oferecer MP4 real, a extensão salva como WebM em vez de usar uma extensão de arquivo incorreta. Use GIF para demonstrações visuais curtas: ele não possui áudio e é otimizado em partes de até 15 segundos.",
    },
    {
      key: "gifParts",
      question: "O que acontece quando uma gravação em GIF passa de 15 segundos?",
      answer: "Até 15 segundos, a extensão baixa um único arquivo .gif. Acima disso, ela divide a captura em trechos de até 15 segundos e baixa um ZIP com arquivos nomeados e ordenados como part1, part2, part3 e assim por diante; o último trecho pode ser menor.",
    },
    {
      key: "firstAccess",
      question: "O que acontece no primeiro acesso depois de instalar a extensão?",
      answer: "A instalação abre a página de demonstração e sincroniza uma sessão válida da landing page com a extensão. Depois do primeiro login confirmado, o tour guiado começa automaticamente uma única vez; ele continua disponível no painel Tutorial para você refazer quando quiser.",
    },
    {
      key: "contextMenu",
      question: "Existe algum atalho fora da barra?",
      answer: "Sim. Clique com o botão direito em qualquer página autorizada e abra \"QA Sandbox\" no menu de contexto: dá pra contar caracteres da seleção, revelar test-id/seletor/XPath do elemento clicado, preencher com dado fake e conferir limites do campo, sem precisar abrir a barra.",
    },
    {
      key: "workspaceOrder",
      question: "Qual é a ordem correta para configurar o Workspace?",
      answer: "Cadastre cliente, projeto ligado ao cliente, produto ligado ao projeto, ambiente e por último a URL ligada ao produto e ao ambiente. Depois use Contas e Pagamentos para dados exclusivamente sandbox e Integrações para Inspectors, APIs e recursos. O Tour das Configurações aponta cada botão Adicionar nessa sequência.",
    },
    {
      key: "toolbarAppearance",
      question: "Como configuro a aparência e as ferramentas da barra?",
      answer: "Abra Barra e aparência, escolha o tema pelo Sol ou Lua, ajuste breadcrumb, imagens e modo compacto, selecione as ferramentas e organize a ordem do menu Tools. Confira a prévia e clique em Salvar; a toolbar aberta recebe a alteração.",
    },
    {
      key: "configureInspectors",
      question: "Como configuro Inspectors, APIs e recursos do projeto?",
      answer: "No Workspace, abra Integrações. Em Inspectors, crie regras de identificação de respostas de rede; em APIs, registre endpoints de consulta; em Recursos e links, adicione documentação e dashboards. Ao salvar, os dados ficam disponíveis nas respectivas sidebars.",
    },
    {
      key: "backupWorkspace",
      question: "Como faço backup ou transfiro meu Workspace?",
      answer: "Abra Importar / Exportar e use Exportação segura para baixar o JSON com checksum e sem segredos. Para restaurar ou transferir, use Importar JSON; os vínculos e URLs são validados antes de substituir o Workspace atual. Baixar template mostra a estrutura aceita.",
    },
    {
      key: "support",
      question: "Encontrei um problema ou tenho uma sugestão, para onde envio?",
      answer: "Escreva para contato@matheusbonotto.com.br com o máximo de contexto possível: screenshot, passos e o que você esperava que acontecesse.",
    },
  ];

  window.QTS_FAQ_DATA = Object.freeze({ general: Object.freeze(FAQ_GENERAL.map((item) => Object.freeze(item))) });
})();
