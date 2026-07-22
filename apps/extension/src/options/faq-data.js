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
      key: "support",
      question: "Encontrei um problema ou tenho uma sugestão, para onde envio?",
      answer: "Escreva para contato@matheusbonotto.com.br com o máximo de contexto possível: screenshot, passos e o que você esperava que acontecesse.",
    },
  ];

  window.QTS_FAQ_DATA = Object.freeze({ general: Object.freeze(FAQ_GENERAL.map((item) => Object.freeze(item))) });
})();
