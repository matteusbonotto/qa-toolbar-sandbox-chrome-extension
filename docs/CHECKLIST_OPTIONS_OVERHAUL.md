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

- [ ] Todo `<details class="crudComposer">` vira `<dialog>` modal (mesmo padrão do editor de
      imagem já existente).
- [ ] Confirmação de exclusão vira modal em vez de `window.confirm(...)`.

## Fase 5 — Exclusão de conta (LGPD)

- [ ] Nova edge function `account-delete`: cancela assinatura Stripe ativa na hora, apaga dados
      pessoais, mantém registros financeiros anonimizados (`payment_events.user_id` → null).
- [ ] Nova migration: `payment_events.user_id` com `on delete set null` (hoje bloqueia exclusão).
- [ ] Botão "Excluir minha conta" na aba Minha conta, com modal de confirmação + senha.

## Fase 6 — Sincronizar LP

- [ ] Conferir copy da LP após as fases acima, se houver algo customer-facing para atualizar.

---

## Itens novos, pedidos durante a sessão (fora do plano original, para depois da Fase 2)

- [ ] **Macro Studio**: gravação de cliques/digitação gerando macro automaticamente (Vibe Code/
      Coder), barra de controle da gravação (pausar, cancelar, desfazer última ação, histórico),
      e no modo manual listar elementos da tela com label visível (sem obrigar a digitar seletor).
- [ ] **Sino de notificações**: badge com contagem, lista ao clicar, clique na notificação navega
      até a origem (ex.: erro do Error Monitor), botão de limpar notificações.
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
- [ ] **Tools menu**: permitir reordenar a lista de ferramentas.
- [ ] **Sidebars**: unificar todos para 400px de largura — alguns ainda ocupam metade da tela.
- [ ] **Notificação de pagamento falhado**: confirmado no código — o bloqueio de acesso já
      funciona certinho (`access-status` exige `subscription.status === 'active'` + pagamento
      confirmado; se falhar, vira `past_due` e todo recurso pago é bloqueado automaticamente).
      O que falta: `stripe-webhook` não envia e-mail nenhum em `invoice.payment_failed`, e a
      extensão não lê o campo `billing.status` que a `access-status` já devolve para mostrar um
      aviso "pagamento falhou, atualize seu cartão" nas Configurações.
