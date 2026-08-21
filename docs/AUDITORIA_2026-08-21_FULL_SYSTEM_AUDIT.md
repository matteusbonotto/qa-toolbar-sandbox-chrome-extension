# QA Toolbar Sandbox — Full System Audit (2026-08-21)

> Primeira entrega do prompt mestre em `CLAUDE.md` (seção 137). Escopo: extensão + landing + admin +
> backend, como pedido. **Nenhum código de produto foi alterado nesta rodada** — só
> `AGENTS.md`/`COMMANDS.md` (documentação operacional) e os arquivos de auditoria em `docs/`. Regra
> seguida à risca: auditoria primeiro, blueprint depois, implementação só após aprovação (seção 1 e
> 137 do prompt mestre).
>
> Metodologia: código real como fonte de verdade (nunca a documentação isoladamente), 4 auditorias
> paralelas read-only cobrindo RLS/entitlements, runtime da extensão, Landing/Admin
> (acessibilidade/performance/SEO/RBAC) e documentação/CI/dependências, mais leitura direta de toda a
> documentação arquitetural já existente e do histórico de commits recente. Os relatórios completos,
> com evidência arquivo:linha, estão nos 4 documentos irmãos desta pasta:
>
> - `AUDITORIA_2026-08-21_RLS_ENTITLEMENTS.md`
> - `AUDITORIA_2026-08-21_EXTENSAO_RUNTIME.md`
> - `AUDITORIA_2026-08-21_LANDING_ADMIN.md`
> - `AUDITORIA_2026-08-21_DOCS_CI_DEPENDENCIAS.md`
>
> Este documento sintetiza os quatro, agrupa por causa raiz e propõe prioridade — não repete
> evidência que já está nos documentos irmãos.

## 1. Resumo executivo

O projeto **não é um repositório negligenciado precisando de descoberta do zero** — já existe uma
cultura de auditoria madura e ativa (dezenas de docs datados, ADRs, um pentest real que corrigiu uma
falha de escalonamento de trial em 2026-08-04). O trabalho desta rodada não encontrou um sistema
frágil; encontrou **um sistema bem cuidado com lacunas pontuais e específicas**, a maioria já
conhecida em espírito pela própria equipe (os gaps de CI, por exemplo, são consequência direta de
uma decisão consciente documentada, não de descuido).

O achado mais importante não é um bug novo — é que **a correção de segurança mais recente do projeto
nunca foi replicada no arquivo de bootstrap** (`schema.sql`), o que significa que o próprio processo
de "corrigir e documentar" tem um ponto cego estrutural: nada verifica automaticamente que
`schema.sql` e as migrations aplicadas em produção continuam batendo. Isso é mais valioso de
resolver do que qualquer bug pontual, porque é a causa que pode reintroduzir qualquer futura correção
de RLS, não só esta.

## 2. Bugs e riscos agrupados por causa raiz

### 2.1 CRÍTICO — `schema.sql` não é mantido em sincronia com as migrations aplicadas em produção

**Evidência**: `AUDITORIA_2026-08-21_RLS_ENTITLEMENTS.md`.

- A policy de RLS que causou o escalonamento de trial (`profiles.trial_ends_at` gravável por
  qualquer usuário autenticado) foi corrigida em produção em 2026-08-04, mas `schema.sql:1314` ainda
  tem a versão vulnerável.
- O `grant` de `credit_reward_points()` para `authenticated`, corrigido no mesmo dia, também não foi
  replicado (`schema.sql:1741`).
- **Por que isso é uma causa raiz, não dois bugs isolados**: as duas lacunas vêm do mesmo commit
  (`cc3e0a3`). O processo de "aplicar migration em produção" e "atualizar schema.sql" são passos
  manuais separados, sem verificação automática de que os dois convergem. Isso pode acontecer de
  novo com qualquer migration futura.
- **Componentes afetados**: qualquer projeto Supabase provisionado do zero via
  `npm run backend:bootstrap` (disaster recovery, ambiente novo) nasce vulnerável ao mesmo
  escalonamento de trial que já foi pago (em risco) uma vez.
- **Prevenção recomendada**: um teste automatizado (`backend:check` ou script dedicado) que compare
  a definição de policies/grants sensíveis em `schema.sql` contra o que as migrations mais recentes
  implicam, falhando explicitamente em divergência — transformar a regra manual de
  `docs/migration-strategy.md` ("os dois precisam concordar") em algo que o CI verifica, não só
  algo que se espera que um agente lembre.
- **Correção do drift em si**: mecânica, baixo risco (edita só `schema.sql`, não toca produção) —
  pendente de autorização explícita antes de eu aplicar, por ser mudança de schema (regra de
  `AGENTS.md`).

### 2.2 MÉDIO — listeners globais nunca removidos em itens flutuantes da toolbar

**Evidência**: `AUDITORIA_2026-08-21_EXTENSAO_RUNTIME.md`.

`makeDraggable`/`makeResizable`/`makeLineResizable` (marcadores, notas, formas, linhas) registram
`document.addEventListener("mousemove"/"mouseup", ...)` sem nunca remover — remover o item some do
DOM, mas o listener continua rodando a cada `mousemove` da página inteira pelo resto da sessão.

- **Padrão, não caso isolado**: as três funções compartilham o mesmo defeito — uma correção precisa
  cobrir as três.
- **Impacto**: degradação de performance progressiva em sessões longas de QA (a persona principal do
  produto cria e apaga dezenas de anotações por sessão) — exatamente o cenário que
  `docs/testing-strategy.md`/`AGENTS.md` já pedem para testar ("repetir 50 vezes") mas que a suíte
  atual não cobre para este caso específico.
- **Prevenção recomendada**: ao corrigir, adicionar um teste de regressão que crie/remova vários
  itens flutuantes e confirme (via contagem de listeners ou proxy equivalente) que nada sobra.

### 2.3 MÉDIO — deriva de documentação sistemática (não é um caso, é um padrão)

**Evidência**: as 4 auditorias, consolidado em `AUDITORIA_2026-08-21_DOCS_CI_DEPENDENCIAS.md`.

Vários pontos de deriva pequena e independente, mas que juntos formam um padrão: nenhum mecanismo
força a documentação a acompanhar o código quando o código muda.

- `schemaVersion` real é 18; `docs/architecture.md`/`docs/ecosystem-audit.md` dizem 17.
- `THIRD_PARTY_NOTICES.md` lista React Router (removido do Admin há semanas) e não lista
  `framer-motion` (usado ativamente na Landing).
- `docs/PENDENCIAS_USUARIO.md` não é atualizada desde 27/07 enquanto outros documentos (handoff
  PR121, 29-30/07) já mostram progresso nos mesmos itens — quem confiar cegamente nela vai repetir
  trabalho já feito ou, pior, deixar de verificar algo que na verdade não foi resolvido.
- Pelo menos 5 documentos (`TUTORIAL_TOUR_BACKLOG.md`, `CHECKLIST_OPTIONS_OVERHAUL.md`,
  `CHECKLIST_RELEASE_1_4_GRAVADOR_PASSOS.md`, `implementation-checklist.md`,
  `docs/prompt-mestre-claude-code-qa-toolbar-sandbox(5).md`) estão superados por trabalho mais
  recente sem aviso de arquivamento, ao contrário do que já existe corretamente em
  `docs/handoff/archive/` para dois documentos anteriores da mesma linhagem.
- **Prevenção recomendada**: a seção "Deriva de documentação" recém-adicionada a `AGENTS.md` nesta
  sessão (ver §5) é o mecanismo de processo para isso — falta aplicá-la retroativamente aos 5+
  documentos superados identificados acima.

### 2.4 MÉDIO — gate de qualidade "obrigatório" que não é imposto por CI

**Evidência**: `AUDITORIA_2026-08-21_DOCS_CI_DEPENDENCIAS.md`.

`AGENTS.md`/`docs/testing-strategy.md` chamam `npm run test:chrome`, `npm run smoke:lp-admin` e
`npm run backend:check` de obrigatórios antes de qualquer merge — mas nenhum workflow do GitHub
Actions os executa no caminho de PR. `test:chrome` só roda no momento de publicação manual na Store
(`chrome-store-package.yml`, gated por `workflow_dispatch` com confirmação); `smoke:lp-admin` e
`backend:check` não rodam em nenhum workflow. O que impede uma regressão de chegar a `main` hoje é
disciplina humana/do agente, não o sistema.

- **Isso já é tecnicamente viável**: `chrome-store-package.yml` prova que `test:chrome` roda em CI
  Linux via `xvfb-run`, o padrão só não foi replicado no workflow de PR (`quality.yml`).
- **Decisão de produto, não bug**: pode ser intencional (custo de CI, tempo de execução) — está
  registrado aqui como risco a decidir conscientemente, não como algo a corrigir automaticamente.

### 2.5 BAIXO — acessibilidade inconsistente entre páginas do mesmo app

**Evidência**: `AUDITORIA_2026-08-21_LANDING_ADMIN.md`.

O Admin tem páginas que fazem label/aria-label corretamente (`AccessPage.tsx`,
`LegalRegistrationPage.tsx`) e páginas que não fazem (`VouchersPage.tsx`, `UsersPage.tsx`,
`LicensesPage.tsx`, a matriz de `FeatureFlagsPage.tsx`) — não é ausência de padrão conhecido no
projeto, é aplicação inconsistente de um padrão que já existe em outro lugar do mesmo código.

### 2.6 BAIXO/INFORMATIVO — performance e SEO da Landing nunca medidos formalmente

**Evidência**: `AUDITORIA_2026-08-21_LANDING_ADMIN.md`. Já era um gap admitido pela própria
documentação (`docs/ecosystem-audit.md` §6). O achado concreto novo é o peso do logo SVG
(485/412 KB carregado em toda página) e a ausência total de Open Graph/canonical/robots.txt/sitemap
— itens de baixo esforço, alto retorno de conversão/compartilhamento para uma landing page.

### 2.7 BAIXO — timeout mágico não documentado

**Evidência**: `AUDITORIA_2026-08-21_EXTENSAO_RUNTIME.md`. `toolbar.js:1417`, 150ms sem comentário.
Registrado por aderência à própria regra do projeto ("nunca aceitar timeout mágico sem perguntar por
quê"), não por sinal concreto de bug hoje.

## 3. O que foi verificado e está correto (não repita trabalho nisso)

- Escopo de host/autorização de mensagens da extensão (`patternsForAuthorizedWorkspace`/
  `isAuthorizedContentSender`) bate exatamente com a documentação e cobre os 4 handlers sensíveis.
- Manifest da extensão bate exatamente com `docs/permissions.md` — sem permissão extra, sem
  `activeTab` residual.
- Paridade ESM/clássico do `FEATURE_REGISTRY` está correta (só a doc do número da versão está
  desatualizada).
- Sem estado de negócio fora de `chrome.storage` no service worker — nenhuma suposição inválida de
  "o service worker fica sempre vivo" encontrada.
- Sem duplicação de listener por reinjeção de content script em SPA (guardas de execução única
  presentes e corretas).
- O bug histórico de observer auto-reentrante (loop infinito do monitor de headers fixos) continua
  corrigido e não se repetiu em nenhum outro observer do arquivo.
- RBAC do Admin: nenhuma ação sensível/destrutiva depende só de gate client-side — toda mutação
  verificada tem RLS `is_founder()` ou guard explícito no backend por trás.
- Nenhuma Edge Function encontrada confiando em dado do cliente para decisão de segurança/dinheiro
  sem revalidar no servidor.
- Todas as outras tabelas com policy self-service (`installations`,
  `engagement_campaign_submissions`, tabelas de reward/entitlement) foram auditadas contra a mesma
  classe do bug de trial — nenhuma outra instância viva encontrada (uma ressalva "não confirmado"
  registrada para 4 colunas específicas de expiração, ver documento de RLS).
- Dependências do projeto estão razoavelmente atualizadas; nenhuma vulnerabilidade crítica óbvia
  encontrada por leitura manual (não substitui `npm audit`, que já roda no CI).

## 4. O que este documento não cobre (gap admitido, não "verificado como OK")

Replicado dos documentos-fonte para não se perder na síntese: WCAG formal/Lighthouse real, Core Web
Vitals medidos, teste de teclado/leitor de tela em runtime, contraste numérico, bundle size real
(`vite build` não executado), carga/performance de backend, cobertura de integrações externas
(nenhuma existe), e uma segunda passada exaustiva nas 4 colunas de expiração mencionadas como "não
confirmado" no documento de RLS.

## 5. O que já foi entregue nesta sessão (fora da auditoria em si)

A pedido explícito do usuário, além da auditoria:

- **`AGENTS.md`** ganhou: mapa de documentação operacional (evita duplicar conteúdo), regras
  explícitas do agente (18 regras, incluindo a nº 6 — replicar migration em `schema.sql` na mesma
  PR, resposta direta ao achado §2.1), workflow do agente (READ→...→DOCUMENT), workflow de bug e de
  feature, classificação de risco de mudança (SAFE/MODERATE/HIGH RISK, com gatilhos específicos
  deste repositório), protocolo de deriva de documentação, e um checklist final de "fase concluída".
- **`COMMANDS.md`** (novo): todos os comandos reais do projeto (`package.json`, `scripts/`,
  workflows de CI), organizados por categoria, cada um com objetivo/quando usar/pré-requisitos/
  resultado esperado — nada inventado; onde não existe comando (lint/format), está marcado como
  `PROPOSTA`, não como se já existisse.
- **Os 4 documentos de auditoria** desta pasta, com evidência arquivo:linha para cada achado.

## 6. Proposta de priorização (para revisão, nada implementado ainda)

| Prioridade | Item | Esforço estimado | Risco de não fazer |
|---|---|---|---|
| P0 | Sincronizar `schema.sql` com as migrations de 2026-08-04 (policy de `profiles` + grant de `credit_reward_points`) | Baixo (edição mecânica) | Qualquer bootstrap novo reintroduz o escalonamento de trial já corrigido uma vez |
| P0 | Corrigir os 3 listeners globais órfãos (`makeDraggable`/`makeResizable`/`makeLineResizable`) | Baixo-médio | Degradação de performance progressiva em sessões longas, a persona de uso mais comum do produto |
| P1 | Adicionar verificação automatizada de drift `schema.sql` × migrations | Médio | Sem isso, o P0 acima pode se repetir a cada correção futura |
| P1 | Decidir conscientemente (não por omissão) se `test:chrome`/`smoke:lp-admin`/`backend:check` entram no gate de PR ou continuam só em disciplina manual | Médio (CI) / decisão de produto | Regressão pode chegar a `main` sem que ninguém rode a suíte completa localmente |
| P2 | Arquivar formalmente os 5 documentos superados identificados (mover para `docs/handoff/archive/` com aviso, como já existe para os outros dois) | Baixo | Confusão de qual documento é a fonte de verdade para um agente novo |
| P2 | Padronizar acessibilidade (label/aria-label) nas páginas do Admin que ainda não seguem o padrão já usado em outras | Baixo-médio | Inconsistência, não bug bloqueante |
| P2 | Reduzir o peso do logo SVG (485/412 KB) carregado em toda página; adicionar OG/canonical/robots.txt/sitemap na Landing | Baixo | Impacto real, mas não bloqueante, em LCP e compartilhamento social |
| P3 | Remover os ~6,8 MB de SVGs órfãos não referenciados de `apps/landing/src/assets/` | Trivial | Peso morto no repositório, sem risco funcional |
| P3 | Atualizar `THIRD_PARTY_NOTICES.md` (remover React Router, incluir framer-motion) e o número de `schemaVersion` nos docs de arquitetura | Trivial | Só afeta confiabilidade da documentação |
| P4 | Avaliar upgrade de `framer-motion` (12→13) | Baixo | Não crítico, maior salto de versão do lote |

## 7. Próximo passo

Conforme a seção 137 do prompt mestre: esta é a primeira entrega ("FULL SYSTEM AUDIT"). O passo
seguinte é o **MASTER BLUEPRINT** (seção 122) — só deve ser produzido depois que você revisar estes
achados e sinalizar quais merecem virar plano de implementação, e nenhuma implementação começa antes
da aprovação explícita do blueprint (regra 1 e regra 137 do prompt mestre, reforçada por `AGENTS.md`:
nenhuma mudança de schema/produto acontece sem autorização explícita).
