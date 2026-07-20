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
- [ ] `background.js`: trocar `environment.urlPatterns` por `urlBindings` na lista de padrões
      registrados/autorizados.
- [ ] `toolbar.js`: `findActiveEnvironment` passa a casar contra `urlBindings`, resolvendo
      produto/projeto/cliente do binding casado; contas de teste/meios de pagamento passam a
      filtrar também por `productId` (opcional) além do `environmentId`.
- [ ] `options.html`/`options.js`: formulário de Ambiente perde Produto/URLs (fica só nome+cor);
      aba "URLs" ganha select de Produto obrigatório e vira uma coleção real (edit/duplicar/
      pausar/excluir), não mais uma view derivada por string de padrão.
- [ ] `scripts/test-extension-workspace.mjs`: caso de teste migrando um workspace legado
      multi-produto/multi-ambiente e confirmando que os bindings mesclam sem duplicar ambientes.
- [ ] Verificação ao vivo: importar fixture estilo Cinemark (4 níveis × 2+ países), confirmar
      exatamente 4 ambientes (não 8), confirmar que cada país resolve cliente/projeto/produto
      corretos, confirmar que editar/remover um binding não afeta os outros países do mesmo
      ambiente.

## Fase 3 — "Exibição": ordenação + prévia ao vivo da barra

- [ ] Drag-and-drop (ou setas) para prioridade cliente/projeto/produto no breadcrumb.
- [ ] Prévia ao vivo da barra refletindo os toggles antes de salvar.

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
