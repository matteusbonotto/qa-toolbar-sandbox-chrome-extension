# Checklist — settings overhaul, relational model fix, LGPD deletion (2026-07-20)

> Atualizado em tempo real conforme cada item é implementado E verificado ao vivo (Playwright,
> não só leitura de código). Plano completo: `docs/adr` não se aplica aqui — plano de sessão
> registrado via EnterPlanMode, este arquivo é o rastreamento público.

## Fase 1 — Layout "Barra e aparência"

- [x] Cards da aba "Barra e aparência" (Onde a barra aparece / Exibição / Key View) agora
      empilhados full-width (col-12) em vez de grid 2 colunas desalinhado.
- [x] "Modo compacto por item" (Cliente/Projeto/Produto) corrigido para 3 colunas — o terceiro
      item não quebra mais sozinho numa linha separada.
- [x] Verificado ao vivo (Playwright): cards full-width, mesma largura, 3 toggles na mesma linha.

## Fase 2 — Modelo relacional: Ambiente reutilizável, Produto na URL

- [x] `storage.js`/`storage-content.js`: nova coleção `urlBindings` (`{pattern, productId,
      environmentIds[], primaryUrl, active}`); `environment` agora é só `{id, name, color,
      active}` — sem `productId`/`urlPatterns`/`primaryUrl` próprios. Migração automática
      (schemaVersion 6→7) expande environments antigos com padrão único-produto em bindings.
- [x] `background.js`: padrões registrados/autorizados agora vêm de `urlBindings`.
- [x] `toolbar.js`: `findActiveEnvironment` casa contra `urlBindings`, resolvendo produto/projeto/
      cliente do binding casado; contas de teste/meios de pagamento agora também filtram por
      `productId` (opcional) além do `environmentId`.
- [x] `options.html`/`options.js`: formulário de Ambiente virou só nome+cor; aba "URLs" ganhou
      select de Produto obrigatório e virou uma coleção real (edit/duplicar/pausar/excluir) em vez
      de uma view derivada por string de padrão. `cascadeRemove` reescrito: remover cliente/
      projeto/produto não apaga mais ambientes (reutilizáveis), só bindings/registros com aquele
      produto; remover ambiente só desvincula das bindings, sem apagar as outras.
- [x] `scripts/test-extension-workspace.mjs`: casos novos cobrindo o bug relatado (import
      multi-país migrando sem duplicar ambiente), migração legada preservando dados existentes
      sem merge por nome, e idempotência ao renormalizar.
- [x] Verificação ao vivo: fixture com 2 países × 1 ambiente ("DEV") confirmou exatamente 1
      ambiente (não 2), cada país resolvendo cliente/projeto/produto corretos no breadcrumb real,
      e remover o binding de um país deixou o outro e o ambiente compartilhado intactos.
      Suite completa (`test:chrome`) rodou limpa, 0 erros de console/worker.

## Fase 3 — "Exibição": ordenação + prévia ao vivo da barra

- [x] Nova preferência `breadcrumbOrder` (drag-and-drop + setas ↑↓) para prioridade cliente/
      projeto/produto no breadcrumb — Ambiente fica sempre por último de propósito. Reaproveita
      a mesma ideia de reordenação já usada em clientes/projetos/produtos.
- [x] Prévia ao vivo da barra ("Exibição" → topo do card) refletindo ordem, visibilidade e modo
      compacto instantaneamente, antes de "Salvar aparência".
- [x] **Bug real achado e corrigido durante a verificação ao vivo**: o Ambiente nunca aparecia no
      breadcrumb (nem antes desta fase) — a função `badge()` tinha uma guarda `if (!entity) return ""`
      que rodava antes do caso especial de Ambiente, e `entityFor` nunca teve uma chave
      `environment`. Corrigido movendo o caso do Ambiente para antes da guarda.
- [x] Verificado ao vivo: prévia muda instantaneamente ao mover "Produto" para o topo via seta;
      após salvar, a barra real reflete a nova ordem (Produto → Cliente → Projeto → Ambiente),
      com o cliente saindo do canto pequeno e entrando na sequência principal quando não é mais o
      primeiro. Suite completa rodou limpa (uma falha isolada foi confirmada como flakiness ao
      rodar de novo sem alterações — não relacionada a esta fase).

## Fase 4 — Formulários em modal

- [x] Todos os 10 `<details class="crudComposer">` viraram `<dialog>` modal (cliente, projeto,
      produto, ambiente, URL, conta de teste, meio de pagamento, inspector, API, recurso) — mesmo
      padrão do editor de imagem já existente, com botão "+ Adicionar X" abrindo cada um.
- [x] Confirmação de exclusão agora é um `<dialog>` temático (`confirmDialog()`) em vez de
      `window.confirm(...)`, usado tanto para excluir itens quanto para resetar o workspace local.
- [x] **Ajuste de UX descoberto durante a verificação**: como `<dialog>` é modal de verdade
      (bloqueia a página inteira, diferente do `<details>` antigo), o assistente de primeiro uso
      não abre mais o diálogo sozinho ao avançar de etapa — isso travava a página inteira. Agora
      ele só troca de aba e destaca o botão "+ Adicionar", deixando a founder abrir quando quiser;
      clicar diretamente num passo do assistente ainda abre o diálogo (ação explícita do usuário).
- [x] Verificado ao vivo: abrir/cancelar/enviar cada tipo de modal, exclusão com Cancelar (mantém)
      e Excluir (remove) testados contra uma linha real, suite completa (`test:chrome`) rodou
      limpa, 0 erros de console/worker.

## Fase 5 — Exclusão de conta (LGPD)

- [x] Nova edge function `account-delete`: reautentica com a senha, bloqueia se a assinatura
      estiver `past_due`/`unpaid`, cancela a assinatura Stripe ativa na hora, apaga a conta via
      `auth.admin.deleteUser`. Passou no `deno check`.
- [x] Nova migration `20260720030000_payment_events_user_delete_set_null.sql`: FK de
      `payment_events.user_id` passa a `on delete set null` (antes bloqueava a exclusão de
      qualquer usuário com histórico de pagamento) — registro financeiro sobrevive, anonimizado.
      `schema.sql` sincronizado.
- [x] Botão "Excluir minha conta" na aba Minha conta, com modal de confirmação + senha
      (`deleteAccountDialog`), mensagens específicas para senha errada / pagamento pendente /
      falha ao cancelar / limite de tentativas.
- [x] **Bug real achado e corrigido durante a verificação**: `[hidden]` (atributo nativo) perde
      para qualquer regra do autor com a mesma especificidade que define `display` — `.card {
      display:grid }` já fazia isso silenciosamente para qualquer card escondido via `hidden`, só
      nunca havia sido exercitado antes. Corrigido com `[hidden] { display:none !important }`
      global — resolve para todos os `.card` existentes e futuros, não só o novo.
- [x] Verificado ao vivo (respostas simuladas): senha errada mantém o modal aberto com a
      mensagem certa e não desloga; pagamento pendente mostra aviso específico; sucesso fecha o
      modal e volta ao estado deslogado. Suite completa (`test:chrome`) rodou limpa.
- [ ] **Pendência do founder** (`docs/PENDENCIAS_USUARIO.md` #7): aplicar a migration e fazer o
      deploy da função antes de anunciar — nada disso existe em produção ainda.

## Fase 6 — Sincronizar LP

- [x] Conferido: as fases 1-5 são melhorias internas de UX/correção (layout, modelo relacional,
      modais, ordenação) sem impacto na página de marketing — nada a atualizar em pricing/features.
- [x] A exclusão de conta (Fase 5) É customer-facing e tem peso legal: adicionada uma frase na
      Política de Privacidade (seção "Conta e cobrança", pt/es/en) explicando que a conta pode ser
      excluída a qualquer momento em Configurações → Minha conta, o que ela cancela/apaga, e que
      registros financeiros ficam anonimizados por obrigação fiscal. Build de produção conferido.

---

## Itens novos, pedidos durante a sessão (fora do plano original, para depois da Fase 2)

- [x] **Macro Studio — gravação**: a barra de controle pedida existe agora (`#macroRecordingBar`
      no shadow DOM do toolbar.js): pausar/retomar (some enquanto pausado, sem gerar passo "wait"
      do intervalo pausado), desfazer última ação, cancelar (descarta tudo, não cria macro), e um
      painel de histórico (clique no contador) listando cada ação gravada em texto, com um botão
      "×" por linha para remover qualquer uma (não só a última). Ícone novo `undo` adicionado a
      `icons-content.js` (path real do Bootstrap Icons, mesmo padrão dos demais).
- [x] **Macro Studio — seletor sem digitar**: no editor (Vibe Code), toda etapa com campo de
      seletor ganhou um botão "Selecionar elemento na página" (reaproveita o mesmo
      `selectPageElement()` já usado por Multiclick/Faker Fill) — clica no elemento real da
      página em vez de digitar CSS à mão; um toast confirma o que foi selecionado (tag + texto/
      aria-label/placeholder). Como `selectPageElement` fecha o drawer para o clique na página,
      o editor tira um "snapshot" do estado atual (nome, descrição, todas as etapas) antes de
      abrir a seleção e reabre o editor inteiro já com o novo seletor mesclado — mesmo padrão que
      Multiclick/Faker Fill já usavam para o próprio caso deles.
- [x] Verificado ao vivo (Playwright real, 7 cenários numa única sessão de gravação): iniciar
      mostra a barra; clique+preenchimento na página geram passos; pausar não grava novas ações e
      retomar volta a gravar; desfazer remove exatamente 1 passo; painel de histórico lista todos
      os passos e remover uma linha específica funciona; cancelar esconde a barra e descarta;
      concluir abre o editor com as etapas, e o botão de seleção de elemento no editor atualiza o
      seletor da etapa corretamente ao clicar num elemento real da página.
- [ ] **Ainda não feito** (fora do escopo desta rodada): a UX de "modo manual listar elementos da
      tela" ficou como um picker de clique-para-selecionar (consistente com o resto do app), não
      uma lista/dropdown de todos os elementos visíveis — se depois disso não for suficiente,
      revisar. O modo Coder (visualização de código Playwright) não foi alterado.
- [x] **Sino de notificações**: novo ícone `#notificationBellButton` na barra principal (ao lado
      do menu Tools, sempre visível mesmo em telas estreitas), com badge vermelho mostrando a
      contagem (`99+` acima disso). Clicar abre `#notificationBellPanel` listando as últimas 20
      notificações (hoje, só erros HTTP do Error Monitor — é a única fonte de "notificação" real
      que existe no app; um sistema genérico de múltiplas fontes seria especulativo). Clicar numa
      notificação fecha o painel e abre o Error Monitor (mesma lista, já ordenada mais recente
      primeiro). Botão "Limpar" no painel e dentro do próprio Error Monitor agora chamam a mesma
      função `clearHttpErrors()` — antes cada um atualizava o badge separadamente (risco de
      dessincronia); unifiquei em `updateHttpErrorSurfaces()`, chamada também a cada `render()`,
      então bell badge / badge do menu Tools / painel / drawer nunca ficam dessincronizados.
      Ícone `bell` novo em `icons-content.js` (path real do Bootstrap Icons).
- [x] Verificado ao vivo: badge começa escondido, aparece com contagem certa após 2 erros
      simulados, painel lista as 2 notificações, clicar fora fecha o painel, clicar numa
      notificação abre o Error Monitor com as mesmas 2 entradas, e limpar pelo Error Monitor
      também esconde o badge do sino.
- [x] **Inspectors**: mudança de fundo — antes, qualquer resposta que não batesse com nenhum
      padrão de Inspector configurado era **descartada na captura**, então "ver tudo" era
      impossível mesmo clicando em algo. Agora toda resposta JSON é sempre guardada em
      `state.networkHistory` com `matchedInspectorIds` calculado; o filtro virou algo que se
      aplica depois, não antes.
  - Aba "Todos" vs "Meus Inspectors" (`.qts-tabs` no topo do drawer, mesmo padrão do Macro
    Studio). Padrão automático: "Meus Inspectors" se já existem inspectors configurados
    (preserva o comportamento antigo por padrão), "Todos" se não existe nenhum configurado ainda
    (não faria sentido logo de cara — verificado ao vivo).
  - Botão de pin (📌) em cada linha capturada: "Marcar como meu inspector" cria um inspector novo
    com padrão = pathname da URL, sem precisar abrir Configurações; re-marca retroativamente as
    entradas já capturadas que batem com o novo padrão (não precisa esperar uma requisição nova).
  - Cada inspector configurado agora também aparece como um chip de filtro próprio
    (`buildInspectorFilterFields` ganhou o grupo "inspector"), funcionando em conjunto com
    Todos/Meus e os filtros existentes (método/status/origem).
- [x] Verificado ao vivo: sem inspectors configurados, padrão é "Todos" e mostra as 2 respostas
      simuladas; marcar uma como inspector e trocar para "Meus Inspectors" mostra só ela; o chip
      de filtro por inspector específico também isola a mesma entrada.
- [x] **Contador de caracteres**: novo botão "Acompanhar campo da página" no drawer (reaproveita
      `selectPageElement`, mesmo padrão de clique-para-selecionar do Multiclick/Faker Fill/Macro
      Studio) — clica num input/textarea real da página e um badge flutuante (`.qts-char-counter-
      badge`, reaproveitando `.qts-floating-item`/`.qts-remove-btn` já existentes) aparece
      ancorado logo acima do campo, com a contagem ao vivo (atualiza a cada 200ms, mesmo padrão de
      polling já usado pelo `state.locationInterval` — evita precisar de scroll/resize listeners
      e limpa sozinho se o campo sumir da página ou se "Limpar" varrer os floating items). Campos
      sensíveis (senha etc.) são recusados pelo picker. O textarea manual (colar/selecionar texto)
      continua existindo, sem alteração — isso é um modo adicional, não substituição.
- [x] Verificado ao vivo: badge aparece ao selecionar um campo real, contagem atualiza ao digitar
      (“Hello world” → 11), badge acompanha a posição do campo, fechar pelo × remove, e selecionar
      o mesmo campo de novo reanexa um badge novo.
- [x] **JSON Studio**: achei a intenção original — `docs/handoff/PROMPT_MESTRE_RECONSTRUCAO_TOTAL.md`
      linha 145 lista `jsonDiff.enabled` e `schemaValidation.enabled` no inventário de capacidades
      planejadas, mas nenhuma das duas foi implementada; só sobrou o formatador (textarea + 3
      botões), daí a confusão de "não entendi pra que serve". Adicionei a aba "Comparar" (mesmo
      padrão `.qts-tabs` do resto do app): cola dois JSONs (ex. resposta esperada vs. real) e vê um
      diff estrutural recursivo — chaves adicionadas/removidas/alteradas, com valor antes/depois,
      cor por tipo. Sem depender de biblioteca externa (esta content script não empacota nenhuma
      dependência de runtime hoje; um validador de JSON Schema de verdade — a outra metade do
      `schemaValidation.enabled` original — ficaria pesado demais pra esse formato; se depois for
      importante, é um pedido separado). Aba "Formatar" original (format/compact/copiar) mantida
      sem alteração.
- [x] Verificado ao vivo: alternar para "Comparar" mostra a aba certa; diff detecta campo alterado,
      item adicionado a um array e chave nova; dois JSONs idênticos mostram "nenhuma diferença";
      JSON inválido em qualquer um dos dois lados mostra erro sem travar; modo "Formatar" original
      continua funcionando.
- [x] **Capturar Elementos**: feito — ver item "6." na seção "Segunda rodada de feedback ao vivo"
      mais abaixo (mesmo pedido, reaparecido com print na segunda rodada).
- [x] **Tools menu**: nova preferência `toolsMenuOrder` (drag-and-drop + setas ↑↓ em "Barra e
      aparência", mesma ideia da ordenação do breadcrumb, implementação separada de propósito para
      não arriscar mexer na já validada); `applyPinnedTools()` reordena o `#toolsMenu` real via
      `appendChild` sequencial. Verificado ao vivo: mover "Capturar elementos" para o topo via seta
      e salvar refletiu na ordem real do menu Tools na barra.
- [x] **Sidebars**: parâmetro `wide` removido de `openDrawer` — todo drawer agora é
      `width: min(400px, 92vw)` (Inspectors, Error Monitor, JSON Studio, Macro Studio, Capturar
      Elementos incluídos). **Bug real achado durante a verificação**: o mock de teste devolvia
      `features: {}` para `access-status`, e Macro Studio/Capturar Elementos são ferramentas
      "gated" por plano (`PLAN_GATED_TOOLS` em `toolbar.js`) — sem a feature liberada,
      `requirePlanFeature` bloqueia silenciosamente com um toast em vez de abrir o drawer (não é
      um bug do produto, era só o mock de teste incompleto). Corrigido no script de verificação;
      confirmado ao vivo que as 5 drawers antes "wide" agora medem exatamente 400px.
- [x] **Notificação de pagamento falhado**: bloqueio de acesso já funcionava certinho antes desta
      sessão (`access-status` exige `subscription.status === 'active'` + pagamento confirmado). O
      que faltava, feito agora: `auth.js` (`getAccessState`) passa `billing.status` adiante e
      atualiza o badge do ícone da extensão (`!` vermelho quando `past_due`/`unpaid`, some quando
      normaliza); `options.js`/`options.html` ganharam um aviso destacado na aba "Minha conta"
      (`#paymentFailedBanner`), independente do usuário ter ou não outro acesso ativo. **Decisão do
      founder**: pular o e-mail por enquanto (nenhum provedor configurado no projeto) — documentado
      em `docs/PENDENCIAS_USUARIO.md` #8 com passo a passo gratuito (Resend) para quando quiser
      ativar. Verificado ao vivo: badge e aviso aparecem quando `billing.status` vira `past_due` e
      somem ao normalizar, via Playwright real contra o bundle.

## Segunda rodada de feedback ao vivo, real, com prints (2026-07-20 — 10 itens reportados juntos)

> Founder testou a versão publicada com um workspace de exemplo e reportou 10 problemas de uma vez,
> vários com prints. Tratando cada um nesta seção, mais criteriosa que a lista antiga acima porque
> agora há evidência real (prints) e comparação direta com `tampermonkey.js` (script de referência,
> local, fora do git — `.gitignore` linha 29).

- [x] **1. Error Monitor "muito ruim"**: comparado com `tampermonkey.js` linha ~8918 — o original
      mostrava mensagem de erro extraída do payload + JSON bruto expansível; o nosso só tinha
      status/método/URL porque **nunca capturava o corpo da resposta** (bug real, não só falta de
      polish). `publishHttpError` em `pagebridge.js` agora recebe o payload (fetch e XHR),
      `errorMonitorMessageFor()` extrai a mensagem com a mesma cadeia de fallback do original
      (`message`/`error.message`/`error`/`title`), e qualquer entrada com payload agora abre o
      mesmo visualizador JSON que os Inspectors já usam. Verificado ao vivo.
- [x] **2. Force HTTP "não muda nada"**: bug real confirmado — só `window.fetch` era interceptado
      para status forçado; `XMLHttpRequest` (usado por padrão pelo `HttpClient` do Angular e por
      muitas stacks legadas) nunca respeitava o status forçado, nem no `tampermonkey.js` original
      (mesma limitação lá). Adicionado suporte a XHR (simula o ciclo de vida completo: readyState/
      status/response/headers como propriedades próprias, evento `load` sintético). Texto da
      descrição atualizado (não dizia mais "(fetch)" sozinho). Verificado ao vivo forçando 500 em
      fetch E em XHR.
- [x] **4. "Usar seleção da página" no Contador de caracteres não funciona**: causa raiz real —
      clicar em QUALQUER botão da barra (Tools → item do menu → botão) colapsa a seleção de texto
      da página pelo comportamento padrão do navegador no `mousedown`, antes do clique nem
      executar. Corrigido com a técnica padrão de editores de texto rico: `preventDefault()` no
      `mousedown` para botões da barra (inputs/textareas de dentro dos drawers não são afetados).
      Verificado ao vivo: selecionar texto real da página, navegar até o Contador de Caracteres,
      clicar "Usar seleção" — texto correto capturado.
- [x] **10. Modal "Adicionar URL"**: o campo "URL ou padrão" era um único texto (só 1 padrão por
      binding); editar um binding existente só mostrava/permitia 1 URL, sem botão "+" para
      adicionar outra, e sem "+" para criar um novo ambiente sem sair do modal. Reescrito:
      `urlBindings[].pattern` (string) virou `.patterns` (array), com editor de pills (adicionar
      via botão/Enter, remover pelo × de cada pill) que mostra TODAS as URLs já salvas ao editar; e
      um botão "+ Novo ambiente" que abre o composer de Ambiente aninhado (dialog empilhado) e
      seleciona automaticamente o novo ambiente de volta no formulário de URL. Dado antigo já
      salvo é lido automaticamente no novo formato (sem precisar de nova migração). Verificado ao
      vivo: 3 padrões adicionados, todos reaparecem como pills ao editar (o bug relatado), remover
      um e salvar, e o fluxo aninhado de criar ambiente funcionando de ponta a ponta.
- [x] **3. Inspectors não se comporta como no tampermonkey**: comparado com o `qaCnkApiInspectorState`
      do original (drawers de API por endpoint, com espera + retry) — a ideia geral fazia sentido,
      mas o original é hardcoded por endpoint específico de um cliente (movies/showtimes/members),
      o que contraria o design genérico deste produto de propósito ("Fully generic/declarative"
      já documentado no código). Portei a UX, não o hardcode: "Meus Inspectors" agora é um
      dashboard por Inspector configurado (`renderInspectorDashboard`), não mais uma lista de
      capturas filtrada — cada Inspector cadastrado vira uma linha própria mostrando "Aguardando
      resposta..." + botão "Tentar novamente" (só re-renderiza com o que já foi capturado, não
      força uma nova requisição — mesma semântica do `retry` original) quando nada bateu ainda, ou
      um resumo (método/status/hora) da captura mais recente + clique abre o JSON, quando já
      carregou. "Todos" continua sendo a lista de capturas de antes, com os filtros normais.
      Verificado ao vivo: 2 inspectors configurados aparecem como "aguardando"; capturar uma
      resposta que bate com um deles atualiza para "carregado" mantendo o outro em espera; clicar
      no carregado abre o JSON com o payload certo.
- [x] **5. Macro Studio precisa ser um modal, não uma sidebar**: `openDrawer()` ganhou um parâmetro
      `variant: "modal"` — muda só a classe do backdrop (`.isModal`), reaproveitando 100% do resto
      da infraestrutura de drawer (abrir/fechar, `#drawerBody`, todos os handlers já existentes).
      Macro Studio e o editor de macro (Vibe Code/Coder) agora abrem centralizados,
      `width: min(920px, 94vw)` e `height: min(760px, 90vh)`, cantos arredondados — não mais
      grudado na borda direita como sidebar. **Isso substitui a decisão anterior desta sessão de
      unificar todos os drawers em 400px** — Macro Studio agora é a exceção deliberada, pedida
      explicitamente pelo founder por ter conteúdo mais rico (paleta + fluxo + código). Verificado
      ao vivo: Macro Studio e o editor abrem como modal largo/centralizado; um drawer não
      relacionado (Error Monitor) continua exatamente 400px, confirmando que a mudança é
      isolada só ao Macro Studio.
- [x] **6. Capturar elementos "ainda tá porco"** (= item "Element Capture UX" da lista original):
      achei um bug bobo mas real — `row.text` (aria-label/texto visível) já era **capturado**, mas
      nunca era **exibido** na linha (só mostrava tag + seletor CSS), daí "não da pra saber oq é o
      elemento" mesmo com o dado já disponível. Reescrito:
  - Label de cada linha agora usa `text || placeholder || name || testId || id`, com fallback pra
    uma miniatura de imagem (`<img>` do próprio elemento ou de um `<img>` filho, útil pra botões só
    com ícone) + "(sem texto)" quando não há NADA identificável.
  - Novo campo `testId` (`data-testid`) — não existia antes; agora aparece como badge na linha e
    entra no CSV exportado (`test_id`).
  - Busca (`elementCaptureSearch`) filtrando por tag/nome/id/test-id/seletor CSS/XPath/texto — isso
    também resolve o pedido de "filtro por test-id, CSS, XPath" (um campo de busca único, mesmo
    padrão já usado em Inspectors/Error Monitor, em vez de 3 widgets separados).
  - Botão "Localizar elemento" por linha — `locateElementBySelector()`, reaproveita o seletor CSS
    já capturado (mais preciso que a busca por texto exato do `locateValueOnPage` usado em JSON).
  - Botão "Ver estado atual" por linha — expande mostrando Visível/Habilitado/Marcado (ou
    Preenchido/Opção selecionada conforme o tipo), reconsultando o elemento AO VIVO no momento do
    clique (não o snapshot da captura). Cobre o pedido "estado atual... tipo a função de spy click"
    de forma segura/escopada, sem duplicar o motor de clique-e-observação do Click Spy em si.
  - O "sidebar cortado na metade" do print parece ter sido a falta de busca/filtros deixando um
    espaço vazio, não um bug de CSS de verdade — não achei clipping real ao investigar; resolvido
    na prática ao preencher esse espaço com a busca.
  - Verificado ao vivo: label real aparece para um botão com texto; um botão com test-id usa o
    test-id como label; um botão sem NADA identificável cai pro preview de imagem + "(sem texto)";
    busca filtra a lista; Localizar destaca o elemento real na página; Ver estado mostra
    Visível/Habilitado e reflete corretamente Marcado: Não → Sim ao marcar um checkbox real.
- [x] **7. Layout quebrado em "Minha conta"**: reproduzido e confirmado ao vivo (print batia
      exatamente com o do founder) — o card "Excluir minha conta" não tinha `max-width`, então
      ficava bem mais largo (1048px) que o card de conta logo acima (640px, com `.accountCard`),
      quebrando o alinhamento visual entre os dois cards empilhados. Corrigido adicionando a
      classe `.accountCard` também no `#deleteAccountCard` (reaproveita a regra já existente, não
      criou CSS novo). Verificado ao vivo em 1400px/900px/500px: os dois cards agora sempre
      alinham na mesma largura.
- [x] **8. Botão de baixar template em Importar/Exportar**: novo botão "Baixar template" gera um
      workspace mínimo genérico (1 cliente/projeto/produto/ambiente/URL, sem nome de cliente real)
      passado pelo mesmo `normalizeWorkspace()` e pela mesma função de exportar (`buildExportEnvelope`,
      extraída do botão de exportar já existente para reaproveitar checksum/formato) — garante que
      o template baixado sempre bate com o schema/checksum atual, em vez de um arquivo estático que
      ficaria desatualizado. Verificado ao vivo: o template baixado foi reimportado com sucesso
      (prova de que é válido de ponta a ponta).
- [x] **9. Validação de arquivo de importação**: achei um bug real investigando — um array como
      `clients: ["texto", 123, null, {id:"ok",...}]` importava **com sucesso**, virando "4
      cliente(s)" (3 registros fantasma tipo "Cliente 1"/"Cliente 2" misturados com o real, sem
      nenhum aviso). Causa: `normalizeWorkspace()` é propositalmente tolerante (também é usada pra
      ler o que já está salvo localmente entre versões de schema, onde "curar" um valor ruim é o
      comportamento certo) — mas um arquivo de IMPORTAÇÃO é diferente: um registro inválido quase
      sempre significa que o arquivo em si está errado. Adicionei `validateImportShape()` que roda
      antes de normalizar e recusa o arquivo inteiro (preservando o workspace anterior) se qualquer
      coleção tiver um item que não seja um objeto de verdade. Verificado ao vivo: arquivo com lixo
      é recusado com mensagem clara e não muda o workspace; arquivo genuinamente válido continua
      importando normalmente (sem falso positivo).
