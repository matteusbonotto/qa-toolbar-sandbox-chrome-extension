# Backlog: Tutorial vivo, tour de Configurações e novas ferramentas

Checklist de acompanhamento pedido pelo usuário em 2026-07-22, para não perder nada durante uma
sessão longa com orçamento semanal apertado (77% usado no início desta rodada). Marcar `[x]`
conforme for concluído e validado (não só codificado — testado). Se a sessão acabar no meio,
qualquer item ainda `[ ]` é o que falta retomar.

## Prioridade 1 — pequenos ajustes de UX (baixo risco, alto valor)

- [x] Corrigir o spotlight/balão do tour ao vivo: a abertura do menu Tools tem uma transição CSS de
      140ms e o spotlight lia a posição do alvo antes dela terminar, ficando mal posicionado —
      agora espera a transição antes de medir, e o anel do spotlight pulsa para ficar mais visível.
- [x] Botão para **rever/reiniciar o tour ao vivo** a qualquer momento — "Iniciar tutorial" no
      painel Tutorial já reabre o tour do zero; confirmado funcionando no smoke test.
- [x] Mover a mensagem "A barra está pronta" (card no rodapé) para uma notificação no sino de
      notificações — não é mais um popup, é uma entrada dispensável no sino.
- [x] FAQ: visualizador em tela cheia (lightbox) ao clicar na imagem. *(Prints "mais realistas"
      ainda não recapturados — ver Prioridade 3.)*
- [x] Novo item de FAQ ensinando o menu de contexto (botão direito do mouse: contar caracteres,
      revelar locators, preencher fake, conferir limites).

## Prioridade 2 — tour de Configurações (a parte mais importante, segundo o usuário)

- [x] Tour guiado **dentro da tela de Configurações** — spotlight + balão nos 8 itens de navegação
      (Minha conta, Barra e aparência, Workspace, Dados de teste, Inspectors e recursos, Importar/
      Exportar, Tutorial, FAQ), acionável pelo banner "Novo por aqui?" ou pelo botão "🧭 Tour das
      Configurações" no painel Tutorial (sempre visível, não depende do banner).
- [ ] Vídeo-tutorial dedicado só da navegação/telas de Configurações (o tour guiado acima já cobre
      isso em texto; um vídeo é um reforço, não bloqueante).
- [x] Agrupar a lista de módulos do Tutorial/FAQ em **accordions por seção** (Fundamentos,
      Evidências de teste, Inspeção e depuração, Produtividade, Dados de sandbox).

## Prioridade 3 — qualidade do conteúdo do tutorial

- [ ] Vídeos capturados de novo, indo até o **resultado final** de cada ação (hoje cortam cedo):
      Test Status mostrando o clique em Pass e o resultado; Breakpoint Viewer com o preview mobile
      carregado; mostrar resize/ocultar/fechar/arrastar; Notas e Formas realmente escrevendo uma
      nota e desenhando uma forma; etc.
- [x] Botão **"Tentar"** em cada card e no vídeo do painel Tutorial — abre o tour ao vivo direto
      naquele passo específico (`qtsTutorialStep`). *(Conclusão do passo continua autodeclarada —
      detectar a ação real do usuário em 22 ferramentas é escopo grande demais pra esta rodada,
      registrado como pendência.)*
- [x] Modal de sucesso com descrição curta do que foi aprendido + 1 dica prática — os 23 módulos
      ganharam um campo `tip` novo, exibido como "{o que faz} Dica: {dica prática}" tanto no modal
      do painel Tutorial quanto no cartão de conclusão do tour ao vivo na barra. *(Os textos de
      `tip` só existem em pt-BR por enquanto — es/en caem no fallback gracioso do sistema de
      tradução, ou seja, aparecem em português até alguém traduzir; 23 frases × 2 idiomas ficou
      grande demais pra esta rodada, registrado como pendência sem quebrar nada.)*
- [ ] Revisão geral de clareza: tutorial tem que ser entendível por alguém leigo, que nunca usou a
      ferramenta, de forma rápida e divertida.

## Prioridade 4 — infraestrutura / lançamento

- [x] Automatizar o bump de versão da extensão: novo `npm run bump:extension`
      (`scripts/bump-extension-version.mjs`), já encadeado em `release:chrome:upload`/`:publish` —
      roda sozinho antes de empacotar. Versão corrigida de 1.2.0 para 1.2.1 nesta rodada. *(Não
      mexi no workflow do GitHub Actions do auto-publish em si — fazer o bump commitar de volta pro
      `main` sozinho precisa de permissão extra na Action, não quis arriscar sem supervisão; quem
      roda o release script localmente já ganha o bump automático.)* Não encontrei nenhum lugar na
      LP mostrando "v1.2.0" — se souber onde isso aparece pra você, me avisa que eu ligo na versão
      real do manifest.

## Prioridade 5 — novas ferramentas (funcionalidades novas, não tutorial)

- [ ] **Modo Holofote**: segurar o clique por 3s cria um círculo de destaque ao redor do mouse com
      o entorno escurecido (efeito holofote); soltar leva 3s pra voltar ao normal; configurável
      (escurecer, borrar, opacidade, tamanho do holofote); animação de entrada/saída.
- [ ] **Ferramenta Borrar**: borrar elementos da página, botão de limpar todos os borrados.
- [ ] Formas (Notas e Formas): adicionar efeito "borrar" como opção além de cor/opacidade; formas
      distintas quadrado e círculo; linha com ponta configurável (seta ou nenhuma).
- [ ] **Menu de tipo de gravação** ao clicar em gravar: Vídeo normal (grava direto) ou GIF (grava e
      corta em blocos de 30s; 1 parte = salva normal, 2+ partes = zip com part1/part2/...).
      Nome de arquivo: `evidencia_tela_(DataHora)_part` respeitando o idioma configurado. Pesquisar
      forma nativa (sem serviço terceiro tipo convertio.io).

## Feito nesta rodada anterior (referência, já mergeado/PR aberto)

- [x] Tour ao vivo básico na barra (spotlight + balão + Pular/Próximo).
- [x] Modal de conclusão com som + Repetir/Próximo/Fechar.
- [x] Painel Tutorial vira biblioteca de vídeos (22 ferramentas + setup de workspace).
- [x] FAQ com imagens ilustrativas (versão inicial, prints a atualizar — ver Prioridade 1/3).
- [x] Workspace de exemplo semeado automaticamente ao iniciar o tour, sem sobrescrever dados reais.
