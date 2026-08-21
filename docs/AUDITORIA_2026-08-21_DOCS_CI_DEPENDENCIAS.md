# Auditoria — documentação, CI/CD e dependências (2026-08-21)

> Auditoria read-only. Nenhum arquivo foi alterado. Objetivo: inventariar toda a documentação ainda
> não lida nas outras frentes desta rodada, identificar o que está atual/desatualizado/superado,
> mapear os gates reais de CI contra o que a documentação promete, descrever os dois scripts de
> segurança e revisar dependências.

## Inventário de documentação

| Doc | Propósito | Data | Status |
|---|---|---|---|
| `docs/analytics.md` | Só existem métricas de negócio (MRR, assinaturas), não telemetria de produto (funil/retenção/uso por ferramenta) | 2026-07-27 | ATUAL |
| `docs/integrations.md` | Slack/Teams via "copiar formatado" disponível; Jira/Azure DevOps/GitHub Issues não implementados (dependem de credencial de app de terceiro só o founder pode criar) | 2026-07-27 | ATUAL |
| `docs/release-checklist.md` | Checklist geral de pré-release, complementa `DEPLOY_CHROME_WEBSTORE.md` | 2026-07-27 | ATUAL |
| `docs/PENDENCIAS_USUARIO.md` | Lista viva de pendências que só o founder resolve | conteúdo diz 2026-07-19, git 2026-07-27 | **DESATUALIZADO** — não tocada desde 27/07 enquanto o repo avançou até PR #121/v1.4.27+ (29-30/07); contradição interna (item pede confirmar redeploy que outro item já registra como feito) |
| `docs/GUIA_FERRAMENTAS_QA.md` | Guia de usuário das ferramentas de QA + matriz por plano | 2026-07-30 | ATUAL (mais recente do lote) |
| `docs/AMBIENTES_TESTE_E_PRODUCAO.md` | Fluxo TESTE→PRODUÇÃO (branches, pacote `[TESTE]`, publicação manual) | 2026-07-22 | ATUAL |
| `docs/DEPLOY_CHROME_WEBSTORE.md` | Publicação via Chrome Web Store API/OAuth, secrets, troubleshooting | 2026-07-22 | ATUAL |
| `docs/TUTORIAL_TOUR_BACKLOG.md` | Backlog de tutorial/tour de uma sessão específica (22/07), 100% concluído | 2026-07-22 | SUPERADO — virou histórico frente a `product-backlog-2026-07-28.md` |
| `docs/CHECKLIST_OPTIONS_OVERHAUL.md` | Reforma de Configurações/modelo relacional/LGPD (sessão 20/07) | 2026-07-30* | SUPERADO — sucedido por `workspace-studio-redesign-2026-07.md` |
| `docs/CHECKLIST_RELEASE_1_4_GRAVADOR_PASSOS.md` | Release da v1.4/Gravador de Passos | 2026-07-26 | SUPERADO — versão já avançou muito além de 1.4 |
| `docs/UX_VISUAL_AUDIT_2026-07-28.md` | Auditoria visual pontual (screenshot real); 3 bugs de truncamento corrigidos | 2026-07-28 | PARCIALMENTE SUPERADO — o redesenho que deixa pendente é o assunto de `workspace-studio-redesign-2026-07.md` |
| `docs/adr/0001-extension-auth-session-and-url-scope.md` | ADR: sessão via Edge Functions, sem chave privada no pacote, escopo por URL | 2026-07-17 | ATUAL (decisão arquitetural, não checklist) |
| `docs/adr/0002-safe-declarative-macro-studio.md` | ADR: Macro Studio como JSON declarativo, sem `eval`/código remoto | 2026-07-17 (git 07-30*) | ATUAL |
| `docs/handoff/CODEX_PR121_CONTEXTO_2026-07-29.md` | Handoff da PR #121, v1.4.21→1.4.27+ | 2026-07-29 (git 07-30) | ATUAL — handoff mais recente do conjunto |
| `docs/handoff/archive/CHECKLIST_RECONSTRUCAO.md` | Arquivado explicitamente ("Arquivado em 2026-07-27... não é mais atualizado") | — | SUPERADO por definição própria |
| `docs/handoff/archive/PROMPT_MESTRE_RECONSTRUCAO_TOTAL.md` | Prompt original da reconstrução total (16/07+), arquivado em 27/07 | — | SUPERADO por definição própria |
| `docs/requirements/implementation-checklist.md` | Checklist de implementação do "prompt-mestre" antigo, v1.4.6→1.4.15 | 2026-07-25 (git 07-30*) | SUPERADO — coberto por `product-backlog-2026-07-28.md` e handoff PR121 |
| `docs/requirements/product-backlog-2026-07-28.md` | Backlog recebido em 28/07, itens com prova de conclusão | 2026-07-28 (git 07-29) | ATUAL |
| `docs/requirements/entitlement-priority-and-admin-grants-2026-07.md` | Hierarquia de prioridade voucher/trial/concessão admin/assinatura | 2026-07-29 | ATUAL |
| `docs/requirements/workspace-studio-redesign-2026-07.md` | Requisitos + aceite do redesenho do Workspace Studio | 2026-07-29 | ATUAL |

\* `CHECKLIST_OPTIONS_OVERHAUL.md`, `GUIA_FERRAMENTAS_QA.md`, `adr/0002` e
`implementation-checklist.md` compartilham o timestamp exato `2026-07-30 19:56:03` no git log —
indício de commit em lote (provável reformatação), não necessariamente revisão de conteúdo. Não
confirmado se houve edição real de conteúdo nesse commit para os três primeiros.

## O que é `docs/prompt-mestre-claude-code-qa-toolbar-sandbox(5).md`

**É um PROMPT** (instrução para a IA executar), não um relatório de auditoria já preenchida. Abre
com "Você está trabalhando no repositório local... Atue como engenheiro principal...", lista
"Regras obrigatórias de execução", organiza 16 Fases com pedidos numerados (5.1 a 5.66) e termina com
"Primeira ação solicitada... Não pare apenas no planejamento". O checklist com todos os itens `[x]`
na seção 9 é um **modelo de formato** a ser preenchido pela IA, não resultado real.

Cruzando com `docs/requirements/implementation-checklist.md` (título literal "Checklist de
implementação do prompt-mestre", 2026-07-25): quase todos os itens das Fases 1-16 já aparecem
implementados e verificados nas versões 1.4.6 a 1.4.15. **Este prompt já foi majoritariamente
executado** — é da mesma linhagem de `docs/handoff/archive/PROMPT_MESTRE_RECONSTRUCAO_TOTAL.md`
(arquivado formalmente), mas nunca recebeu o mesmo aviso de arquivamento.

**Importante**: o `CLAUDE.md` atual do repositório (o "prompt mestre" desta rodada de auditoria,
título "PROMPT MASTER — QA TOOLBAR SANDBOX 2027") **não é a mesma coisa** — estrutura totalmente
diferente (equipe virtual de especialistas, framing de auditoria multidisciplinar 2027). Além disso,
**`CLAUDE.md` não está versionado no git** (`git ls-files` não o lista, e não está no
`.gitignore` — é puramente local a esta máquina).

**Recomendação**: tratar `docs/prompt-mestre-claude-code-qa-toolbar-sandbox(5).md` como candidato a
arquivamento formal (mover para `docs/handoff/archive/`, com o mesmo aviso dos outros dois arquivos
já arquivados), já que uma nova auditoria não precisa repetir as Fases 1-16 do zero — deve validar
contra os requirements mais recentes (`product-backlog-2026-07-28.md`,
`workspace-studio-redesign-2026-07.md`, `entitlement-priority...`, handoff PR121).

## Gaps entre CI real e o que a documentação promete

- **`test:chrome` (smoke Chrome real) nunca roda como gate de PR.** Só existe dentro de
  `chrome-store-package.yml`, job `publish-to-store`, disparado manualmente
  (`workflow_dispatch` + `confirm_production == 'PUBLICAR PRODUCAO'`) na branch `main` — ou seja, no
  momento da publicação, não no momento do merge. `AGENTS.md`/`testing-strategy.md` chamam esse
  comando de "obrigatório, não opcional" após qualquer mudança na extensão, mas `quality.yml` (o
  workflow que gateia PRs) não o executa.
- **`smoke:lp-admin` nunca roda em nenhum workflow.** `landing-pages.yml` faz `typecheck`/`test`
  (Vitest) de LP e Admin, mas não roda `build-pages-local.mjs`/`smoke-landing-pages.mjs` (o smoke
  real de renderização).
- **`backend:check` (testes Deno das Edge Functions) não roda em nenhum workflow.** Nenhum dos 4
  workflows toca `supabase/functions/` nem chama Deno.
- `security:repo`/`security:extension` estão cobertos — `quality.yml` chama os scripts diretamente
  (`node scripts/check-repository.mjs && node scripts/check-extension-bundle.mjs`), equivalente
  funcional aos scripts npm.
- **Não existe linter (ESLint)** em nenhuma das três apps — nem `.eslintrc*`, nem referência em
  nenhum `package.json`. A rede de segurança sintática real é `node --check` por arquivo (regra de
  edição manual, não step de CI dedicado) + `typecheck` do TypeScript em Landing/Admin (esse sim
  roda em CI).
- Em compensação, `quality.yml` faz coisas além do que a documentação lista: bloqueia PR sem bump de
  versão quando `apps/extension/` muda, roda `npm audit --omit=dev --audit-level=critical` como gate
  e `npm audit --audit-level=high` como registro não bloqueante.
- Mitigante parcial: hook de pre-commit local (`scripts/install-git-hooks.mjs`,
  `core.hooksPath=.githooks`) roda `security:repo` — mas é só local, contorna-se com `--no-verify`,
  e não cobre `test:chrome`/`smoke:lp-admin`/`backend:check`.

**Resumo**: os dois gates que a documentação chama de "obrigatórios, não opcionais"
(`test:chrome`, `smoke:lp-admin`) e o gate de backend (`backend:check`) dependem inteiramente de
disciplina humana/do agente rodando `npm run test:all:clean` manualmente — nenhum workflow do GitHub
Actions os impõe antes do merge em `main`. `chrome-store-package.yml` prova que rodar `test:chrome`
em CI é tecnicamente viável (usa `xvfb-run`), só não está no caminho do PR.

## `check-repository.mjs` e `check-extension-bundle.mjs`

- **`check-repository.mjs`**: varre todos os arquivos rastreados/não ignorados
  (`git ls-files --cached --others --exclude-standard`). Rejeita caminhos proibidos por padrão
  (`.env*` exceto `.env.example`, `.chrome-extension-id-profile/`, `backup`/`export` no nome,
  extensões `.pem/.key/.p12/.pfx/.crx/.sqlite*`, qualquer coisa em `artifacts/`); em conteúdo de
  texto, procura assinaturas de segredo (chave privada PEM, token GitHub, AWS access key, Stripe
  secret/webhook, Supabase `sb_secret_`, Slack token, Google API key) e credenciais hardcoded via
  regex de atribuição, com lista de placeholders permitidos; também bloqueia em-dash (`—`) dentro de
  `apps/landing|admin|extension` (regra de estilo, não segurança).
- **`check-extension-bundle.mjs`**: valida o pacote contra whitelist estrita (`manifest.json`,
  `icons/*.png`, `src/**/*.{js,css,html,mp3,png,webm}`), rejeita nomes proibidos (`.env*`,
  `manifest.key`, `node_modules`, `fixtures/tests/artifacts`, `.map/.pem/.key/.p12/.pfx/.sqlite/.log`),
  limita tamanho por arquivo (2 MB geral, 10 MB para vídeos de tutorial) e tamanho agregado (70 MB),
  varre JS/CSS/HTML/JSON por padrões de segredo, exige MV3 sem `manifest.key`, valida que os ícones
  16/32/48/128 são PNGs reais com assinatura e dimensões corretas.

## Dependências

Nenhuma dependência com versão suspeita/muito antiga — `npm outdated` mostrou só diferenças de
patch/minor (stack bem atualizada). Único destaque: **`framer-motion` uma versão major atrás**
(`12.43.0` instalado vs. `13.1.1` disponível) — não crítico, maior salto do lote. `mermaid` no root
parece deslocado de um "QA toolbar" à primeira vista, mas é uso legítimo confirmado em
`scripts/render-ecosystem-diagram.mjs` (geração de diagrama de doc, não entra no pacote da extensão
nem no bundle de LP/Admin).

**`THIRD_PARTY_NOTICES.md` tem inconsistência real**: lista "React Router — Admin navigation — MIT",
mas `apps/admin/package.json`/lockfile não têm mais `react-router` — confirma
`docs/requirements/implementation-checklist.md` ("React Router vulnerável foi removido do Admin" em
26/07, v1.4.12). A doc de third-party notices não foi atualizada depois dessa remoção. Também não
menciona `framer-motion`, dependência real usada em 6 arquivos de `apps/landing/src`.

## Pendências abertas em `docs/PENDENCIAS_USUARIO.md`

- Migration `20260720010000_store_listing_status.sql` — confirmar aplicação; manter atualização
  manual recorrente da tabela `store_listing_status`.
- Migration `20260720030000_payment_events_user_delete_set_null.sql` + deploy da Edge Function
  `account-delete` (LGPD) — aplicar e testar ao vivo de ponta a ponta com conta real.
- Teste ao vivo do fluxo "Esqueci minha senha" com e-mail real.
- Teste visual com conta real de plano inferior confirmando que Macro Studio/Key View/Capturar
  Elementos somem do menu.
- Verificar domínio próprio no Resend (hoje `onboarding@resend.dev` só entrega para o e-mail da
  própria conta Resend).
- Apagar no Stripe Dashboard o webhook órfão do projeto Supabase antigo (`rvkgwhosnjrgyeztugtg`).
- Confirmar que o redeploy de Edge Functions de 27/07 terminou sem erro (o próprio documento diz não
  ter visto o output final).

**Nota**: esta doc não foi atualizada desde 27/07 enquanto o handoff PR121 (29-30/07) já reporta
progresso relacionado (login/`access-status` funcionando, migrations aplicadas via
`supabase db push --linked`). **Não confirmado** se os itens acima seguem literalmente pendentes ou
já foram resolvidos fora desta doc — recomenda-se ao founder revisar e atualizar esta lista antes de
tratá-la como plano de ação.
