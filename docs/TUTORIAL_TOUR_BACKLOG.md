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
- [x] Vídeo-tutorial dedicado só da navegação/telas de Configurações — o módulo "Prepare seu
      workspace" ganhou um vídeo real (`workspace-setup.webm`) passando pelas 8 seções (Minha
      conta, Barra e aparência, Workspace, Dados de teste, Inspectors e recursos, Importar/
      Exportar, Tutorial, FAQ), gravado com conta fake via `npm run tutorial:capture`.
- [x] Agrupar a lista de módulos do Tutorial/FAQ em **accordions por seção** (Fundamentos,
      Evidências de teste, Inspeção e depuração, Produtividade, Dados de sandbox).

## Prioridade 3 — qualidade do conteúdo do tutorial

- [x] Vídeos recapturados indo até o **resultado final**: Test Status mostra o clique em Pass e o
      resultado "PASS" na tela; Breakpoint Viewer espera o iframe mobile carregar de verdade antes
      de capturar; Notas e Formas escreve uma nota de verdade e desenha um retângulo; Pass/Fail
      mostra o toggle de ocultar/mostrar controles e arrasta o marcador. *(Resize especificamente
      não ficou demonstrado — ocultar/mostrar e arrastar sim; item pequeno, não bloqueante.)*
- [x] Botão **"Tentar"** em cada card e no vídeo do painel Tutorial — abre o tour ao vivo direto
      naquele passo específico (`qtsTutorialStep`). *(Conclusão do passo continua autodeclarada —
      detectar a ação real do usuário em 22 ferramentas é escopo grande demais pra esta rodada,
      registrado como pendência.)*
- [x] Modal de sucesso com descrição curta do que foi aprendido + 1 dica prática — os 23 módulos
      ganharam um campo `tip` novo, exibido como "{o que faz} Dica: {dica prática}" tanto no modal
      do painel Tutorial quanto no cartão de conclusão do tour ao vivo na barra, com tradução es/en
      completa das 23 dicas.
- [x] Revisão geral de clareza: reli os 26 módulos (short/instructions/tip) — todos seguem o mesmo
      padrão "abra X, faça Y, resultado Z", linguagem direta, sem jargão não explicado além de
      termos padrão de QA (ex.: "debounce", "double-submit") que fazem parte do vocabulário do
      próprio público-alvo. Nenhuma reescrita ampla foi necessária; o conteúdo já escrito ao longo
      da sessão está claro e acionável para quem nunca usou a ferramenta.

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

- [x] Formas (Notas e Formas): a caixa de estilo agora tem "Formato" (Retângulo/Quadrado/Círculo —
      quadrado e círculo travam largura=altura e ajustam o raio da borda automaticamente) e
      "Efeito" (Cor, como já era, ou Borrão — troca as cores por um controle de intensidade e
      aplica `backdrop-filter: blur()` de verdade sobre a área, não só uma cor por cima).
- [x] **Ferramenta Borrar dedicada**: novo item "Borrar elementos" no menu Tools — clique num
      elemento real da página pra borrá-lo (`filter: blur()`), clique de novo pra desfazer, e
      "Limpar todos os borrados" reseta tudo de uma vez. Reaproveita o mesmo mecanismo de seleção
      por clique já usado no Capturar Elementos (`selectPageElement`), registrado como ferramenta
      de verdade (lista de ferramentas padrão + checkbox em Configurações + migração de schema
      para quem já tinha workspace salvo + tradução completa pt/es/en + cobertura no smoke test).
- [x] **Linha com ponta configurável**: novo botão fixo ao lado de Formas (mesmo grupo "notas" de
      visibilidade), desenhada arrastando de um ponto a outro (não é uma variação da caixa de
      Formas — usa rotação real), com estilo próprio (cor, espessura, ponta Nenhuma/Seta).
- [x] **Modo Holofote**: novo item no menu Tools com um drawer de configuração (Ativar/Desativar,
      Efeito Escurecer/Borrar, Opacidade, Intensidade do borrão, Tamanho do holofote). Segurar o
      clique em qualquer ponto da página por 3s acende o holofote ao redor do mouse (acompanha o
      mouse enquanto segura); soltar apaga suavemente em 3s. Nunca bloqueia cliques/links reais da
      página — é uma camada visual passiva, não um modo de seleção.
- [x] **Menu de tipo de gravação** ao clicar em gravar: agora abre um menu perguntando "Vídeo" ou
      "Vídeo em partes (30s)" em vez de gravar direto. No modo em partes, a cada 30s a gravação
      atual é fechada como um arquivo próprio e uma nova começa no mesmo stream, sem perder tempo
      de vídeo entre um pedaço e outro. Ao parar: 1 parte = baixa o vídeo normalmente; 2+ partes =
      empacota tudo num `.zip` (part1/part2/...) usando um ZIP writer novo, escrito à mão e
      verificado byte-a-byte (`apps/extension/src/lib/minizip-content.js`, testado extraindo com o
      `Expand-Archive` do PowerShell). Nome de arquivo segue `evidencia_tela_(DataHora)_parteN`
      (ou `screen_evidence_.../partN`, `evidencia_pantalla_.../parteN` em en/es), sempre no idioma
      configurado. *(Duas ressalvas honestas: (1) "GIF" virou "Vídeo em partes" — gerar pixels de
      GIF de verdade no navegador sem serviço terceiro exigiria implementar LZW + quantização de
      paleta do zero, um projeto à parte, e um bug ali produziria arquivo corrompido silenciosamente;
      preferi entregar algo verificável a arriscar isso no fim de uma sessão longa — os arquivos são
      `.webm`/`.mp4` reais, só cortados e zipados, não pixels de GIF. (2) `getDisplayMedia` abre um
      seletor nativo do sistema operacional que o Chrome não tem como automatizar de forma confiável
      em teste (diferente de câmera/microfone, que têm flag de dispositivo falso) — o smoke test
      cobre a abertura/fechamento do menu de tipo de gravação de verdade, e a lógica de corte/zip foi
      verificada à parte com um teste Node + extração real do zip, mas o fluxo completo de gravação
      real nunca foi (e não é possível ser) testado automaticamente ponta a ponta.)*

*(Este era o último item da Prioridade 5 — backlog inteiro concluído nesta rodada, com as ressalvas
documentadas acima e nos itens anteriores.)*

## Fechamento: "não esqueça de atualizar a LP, as feature flags, os planos, e os tutoriais e tour"

- [x] **Tutoriais/tour**: ao concluir o item acima, percebi que Linha, Borrar elementos e Modo
      Holofote (as 3 ferramentas novas desta rodada) não tinham entrada no painel Tutorial nem no
      tour ao vivo — só existiam no menu da barra. Adicionados os 3 módulos novos em
      `tutorial-data.js` (título/resumo/instruções/dica, no grupo "Evidências de teste") com
      screenshot e vídeo reais (recapturados via `npm run tutorial:capture`), tradução es/en
      completa, e alvo no tour ao vivo (`TOUR_TARGETS`) pra cada um. A descrição da ferramenta de
      Gravação também foi corrigida (não fala mais em "GIF conforme o plano" — reflete o menu de
      tipo de gravação novo).
- [x] **LP**: catálogo de features (`apps/landing/src/data/featureGroups.ts` +
      `translations.ts`) ganhou 3 itens novos (Linha com seta, Borrar elementos, Modo Holofote) nas
      3 línguas, com ícone próprio cada um. A descrição de "Gravação de evidências" também foi
      atualizada pra não citar mais GIF.
- [x] **Feature flags / planos**: confirmado no código (`PLAN_GATED_TOOLS` em `toolbar.js`) que
      nenhuma das 4 ferramentas novas desta rodada (Borrar, Linha, Holofote, tipo de gravação) foi
      gateada por plano — todas ficam disponíveis a qualquer workspace, igual as outras ferramentas
      não-premium. Isso é intencional (mesma decisão já tomada quando cada uma foi implementada) e
      confirma que não há mudança pendente em `plan_features`/admin.

Todos os itens do backlog original (Prioridade 1 a 5) e este fechamento estão concluídos e
validados (`npm run typecheck`, `npm run test`, `npm run test:chrome` e
`npm run security:extension` verdes, 0 erros de console).

## Rodada de ajustes pós-fechamento (feedback do usuário testando a build)

- [x] **"Vídeo em partes (30s)" bloqueado, com "Em breve"**: o usuário considerou arriscado (viu
      como possível "fraude") oferecer essa opção sob qualquer nome próximo de GIF, já que o
      resultado real é WEBM/MP4 cortado e zipado, não pixels de GIF. A opção continua implementada
      e testada nos bastidores, mas o item do menu agora aparece desabilitado com um selo "Em
      breve" — só "Vídeo" (arquivo único) funciona de verdade hoje. Textos do tutorial e da LP
      atualizados para não prometer mais a função em partes.
- [x] **Lembrete de status na gravação**: novo toggle em Configurações → Barra e aparência
      ("Lembrar de atribuir status na gravação"). Quando ativado, clicar em parar a gravação abre
      o modal de Test Status de forma forçada (sem botão de fechar/clique fora) — a gravação
      continua rodando nesse meio tempo, então o overlay de resultado (Pass/Fail/Blocked/
      Limitation) fica gravado no próprio vídeo. 3 segundos depois de marcar o status, a gravação
      para e o download é liberado.
- [x] **Botão Salvar único e fixo** em Configurações → Barra e aparência: os dois botões
      separados ("Salvar URLs" e "Salvar aparência") viraram um único botão "Salvar", fixo
      (`position: sticky`) no rodapé da tela, que salva tanto o escopo de URLs quanto todas as
      preferências de uma vez.
- [x] **Versão da extensão**: corrigido de patch-only para refletir o volume real de features
      desta rodada — `1.2.1` → `1.3.0` (minor). O script de bump continua padrão "patch" pra uso
      cotidiano; bumps maiores continuam manuais via `--minor`/`--major` quando o escopo pedir.

### Achado crítico, fora do escopo deste repositório (ação do usuário, não código)

O usuário reportou 403 ao logar depois de instalar a extensão. Diagnóstico confirmado (print do
Network tab): `{"error":"origin_not_allowed"}` — não é rate limit. Investigando os workflows do
GitHub Actions, **nenhuma versão desde a 1.1.4 (madrugada de 21/07) conseguiu ser publicada de
verdade na Chrome Web Store** — toda tentativa desde então falha com "item cannot be updated now
because it is in pending review" (a revisão anterior da Google ainda não terminou; isso trava
novos uploads até resolver, é comportamento normal da Store, não bug do pipeline). Ou seja: 1.2.0,
1.2.1 e agora 1.3.0 nunca chegaram na Store de verdade — o que foi instalado como "1.2.1" só pode
ter sido um build carregado manualmente (unpacked/zip), que ganha um ID de extensão novo e
aleatório, nunca adicionado à lista liberada (`ALLOWED_EXTENSION_IDS`, secret do Supabase, fora
deste repositório). Não tenho credencial para editar esse secret por aqui — o usuário precisa
pegar o ID real em `chrome://extensions` e atualizar o secret no Supabase (ou me passar o ID pra
eu montar o valor exato a colar).

## Feito nesta rodada anterior (referência, já mergeado/PR aberto)

- [x] Tour ao vivo básico na barra (spotlight + balão + Pular/Próximo).
- [x] Modal de conclusão com som + Repetir/Próximo/Fechar.
- [x] Painel Tutorial vira biblioteca de vídeos (22 ferramentas + setup de workspace).
- [x] FAQ com imagens ilustrativas (versão inicial, prints a atualizar — ver Prioridade 1/3).
- [x] Workspace de exemplo semeado automaticamente ao iniciar o tour, sem sobrescrever dados reais.
