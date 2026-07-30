// Classic-script FAQ content shared by the FAQ panel in options.js. Only the general questions
// live here - per-tool entries ("Para que serve X?") are generated at render time from
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
      answer: "Campos sensíveis (senha, cartão, CVV, token) nunca são exportados em Capturar Elementos, nunca são preenchidos pelo Auto preenchimento, e ficam mascarados na barra quando exibidos a partir de Usuários e contas ou Meios de pagamento.",
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
      key: "fieldValidatorHistory",
      question: "Como saber se um campo passou ou quebrou no Validador de campos?",
      answer: "O resumo compara cada caso com as regras HTML declaradas no campo. Required, tipo, pattern e limites aparecem com o resultado esperado ou a indicação de revisão. Se não houver regra, o registro fica como diagnóstico. O histórico é local, não guarda valores digitados e pode ser limpo a qualquer momento.",
    },
    {
      key: "workspaceOrder",
      question: "Qual é a ordem correta para configurar o Workspace?",
      answer: "Abra Workspace no menu esquerdo. Em Clientes e produtos, cada cliente contém seus projetos e cada projeto contém seus produtos. Use os filtros para mudar o ponto de vista e arraste Projeto ou Produto para trocar seu pai. Em Ambientes e URLs, expanda um ambiente para cadastrar ou mover URLs no próprio contexto. Contas, pagamentos e dispositivos também podem ser agrupados pelas relações relevantes.",
    },
    {
      key: "toolbarAppearance",
      question: "Como configuro a aparência e as ferramentas da barra?",
      answer: "Abra Barra e aparência, escolha Sol ou Lua e uma família visual, incluindo Roxo, Laranja, Amarelo e Lego multicolorido. Ajuste breadcrumb, modo compacto, ferramentas, atalhos e ordem numa única lista. Confira a prévia e clique em Salvar.",
    },
    {
      key: "configureInspectors",
      question: "Como configuro Inspectors, APIs e recursos do projeto?",
      answer: "No menu esquerdo, abra Workspace e escolha Inspectors no submenu. Crie regras de identificação de respostas de rede, APIs de consulta e recursos úteis. Os controles de janela ficam fixos no topo do sidebar; ações como Ativar, Salvar e Limpar ficam no rodapé.",
  },
  {
    key: "sidebarControls",
    question: "Onde ficam os controles e ações dos sidebars?",
    answer: "Mover, fixar, recolher, destacar e fechar ficam no cabeçalho fixo. Ações da ferramenta ficam no rodapé fixo. Uma ação ocupa toda a linha, duas dividem a linha em duas colunas e três aparecem em três linhas.",
  },
  {
    key: "deviceCatalog",
    question: "Como organizo dispositivos, sistemas e navegadores?",
    answer: "Em Workspace, abra Dispositivos. Os catálogos já incluem logotipos bitmap para sistemas e navegadores conhecidos. Um dispositivo pode selecionar vários sistemas operacionais e vários navegadores.",
  },
    {
      key: "backupWorkspace",
      question: "Como faço backup ou transfiro meu Workspace?",
      answer: "Abra Importar / Exportar e use Exportação segura para baixar o JSON com checksum e sem segredos. Para restaurar ou transferir, use Importar JSON; os vínculos e URLs são validados antes de substituir o Workspace atual. Baixar template mostra a estrutura aceita.",
    },
    {
      key: "entityImage",
      question: "Pra que serve a imagem do cliente, projeto ou produto - e dá pra trocar?",
      answer: "A imagem (ou as iniciais, quando não há imagem) aparece no breadcrumb da barra e ajuda a reconhecer de relance em qual contexto você está testando, sem precisar ler o nome todo - útil quando você alterna entre vários clientes ou produtos parecidos no mesmo dia. Ela é só visual, não afeta nenhum dado do workspace. Para trocar, abra o cliente, projeto ou produto em Workspace e use o editor de imagem: upload de arquivo ou URL, com zoom, posição e recorte quadrado antes de aplicar. Também dá pra ocultar o nome e deixar só a imagem (ou as iniciais) no modo compacto de cada entidade, em Barra e aparência.",
    },
    {
      key: "support",
      question: "Encontrei um problema ou tenho uma sugestão, para onde envio?",
      answer: "Escreva para contato@matheusbonotto.com.br com o máximo de contexto possível: screenshot, passos e o que você esperava que acontecesse.",
    },
  ];

  window.QTS_FAQ_DATA = Object.freeze({ general: Object.freeze(FAQ_GENERAL.map((item) => Object.freeze(item))) });
})();
