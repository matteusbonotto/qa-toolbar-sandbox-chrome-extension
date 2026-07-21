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
- [ ] **Inspectors**: revisar comportamento vs. `tampermonkey.js` — filtro "Todos" vs "Meus
      Inspectors", marcar qualquer endpoint capturado como "meu inspector", cada inspector
      configurado também funciona como filtro.
- [ ] **Contador de caracteres**: opção de clicar em um input da página e ver a contagem revelada
      no próprio input (além do textarea manual atual).
- [ ] **JSON Studio**: pouco claro qual o propósito atual (só textarea + 3 botões) — investigar a
      intenção original e reforçar a ferramenta.
- [ ] **Capturar Elementos**: nomear cada linha pela label visível (ou prévia, ex. imagem, quando
      sem label); botão "Localizar elemento" por linha; sidebar cortado pela metade sem busca/
      filtros — corrigir; adicionar filtros por test-id/CSS/XPath; mostrar estado atual vs. setado
      ao clicar (like Click Spy).
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
