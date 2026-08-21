# Comandos — QA Toolbar Sandbox

> Referência operacional. Todo comando aqui existe de verdade em `package.json` (raiz ou de um
> workspace), em `scripts/` ou em `.github/workflows/`. Nada aqui é aspiracional — o que ainda não
> existe está marcado como `PROPOSTA`, nunca listado como se já funcionasse. Se este arquivo
> divergir do `package.json`/`scripts/` reais, os arquivos reais são a fonte de verdade — corrija
> este documento, não o contrário (ver `docs/ecosystem-audit.md` e a regra de "fonte de verdade" em
> `AGENTS.md`).
>
> Para o "porquê" de cada peça, veja `docs/architecture.md` (stack/pastas) e
> `docs/testing-strategy.md` (quando rodar cada camada de teste). Este arquivo é só "qual comando
> digitar".

---

## Instalação

### `npm install`
- **Objetivo**: instalar dependências da raiz e dos workspaces (`apps/landing`, `apps/admin`) de
  uma vez (`workspaces` em `package.json`).
- **Quando usar**: primeira vez no repositório, ou depois de puxar mudanças em qualquer
  `package.json`/`package-lock.json`.
- **Pré-requisitos**: Node `>=20.19.0` (`engines` em `package.json`).
- **Resultado esperado**: `node_modules` populado na raiz e em cada app; dispara `npm run prepare`
  automaticamente (hook de lifecycle do npm).

### `npm run prepare`
- **Objetivo**: instalar os git hooks do repositório (`.githooks/pre-commit`, `.githooks/post-merge`)
  via `scripts/install-git-hooks.mjs`.
- **Quando usar**: normalmente automático (roda após `npm install`); rode manualmente se os hooks
  não estiverem ativos.
- **Pré-requisitos**: estar dentro de um repositório git (`.git` presente).
- **Resultado esperado**: `pre-commit` passa a rodar `security:repo` antes de cada commit.

---

## Desenvolvimento

### `npm run dev:landing` / `npm run dev:admin`
- **Objetivo**: subir o servidor de desenvolvimento Vite da Landing ou do Admin.
- **Quando usar**: trabalhando na UI de `apps/landing` ou `apps/admin`.
- **Pré-requisitos**: `npm install` feito; variáveis `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY`
  configuradas (ver `apps/landing/test-env.template` / `apps/admin/test-env.template`).
- **Resultado esperado**: servidor local com hot reload, apontando para o backend configurado no
  `.env` em uso (produção ou teste, dependendo do arquivo carregado).

### `npm run dev:landing:test` / `npm run dev:admin:test`
- **Objetivo**: mesma coisa, mas forçando `--mode test` do Vite (variáveis de ambiente de teste).
- **Quando usar**: desenvolvendo contra o backend de teste (`backend:test:start`), nunca contra
  produção.
- **Pré-requisitos**: os mesmos de `dev:landing`/`dev:admin`, mais o backend de teste no ar se a
  tela depender de dados reais do Supabase.
- **Resultado esperado**: build servido em modo teste, sem risco de escrever em dado produtivo.

### `npm run dev:extension`
- **Objetivo**: abrir um Chrome real com a extensão carregada a partir do worktree atual, contra o
  backend de teste (`scripts/dev-extension-chrome.mjs`).
- **Quando usar**: qualquer desenvolvimento manual na extensão.
- **Pré-requisitos**: Chrome instalado; rodar `npm run automation:clean` antes se a última sessão
  não terminou limpa (regra obrigatória de `AGENTS.md`).
- **Resultado esperado**: janela do Chrome abre com um profile de teste descartável e a extensão já
  carregada — não reutiliza profile manual.

### `npm run dev:extension:test`
- **Objetivo**: variante que primeiro roda `automation:clean`, empacota um build de teste
  (`package:extension:test`) e só então abre o Chrome real com esse pacote, não com os arquivos
  soltos.
- **Quando usar**: quando você precisa validar exatamente o que vai para o pacote (não o código
  fonte solto), por exemplo antes de reportar um bug como reproduzido.
- **Pré-requisitos**: os mesmos de `dev:extension`.
- **Resultado esperado**: Chrome abre com `artifacts/extension-test` e um profile próprio em
  `artifacts/chrome-test-profile`.

---

## Desenvolvimento da Extensão

A extensão (`apps/extension/`) não tem bundler nem build step — é JavaScript clássico carregado
direto pelo `manifest.json`. Não existe comando de "build" real para ela fora do empacotamento para
distribuição (ver seção **Empacotamento da Extensão**).

### `node --check <arquivo.js>`
- **Objetivo**: validar sintaxe de um arquivo `.js` da extensão (não há bundler/TS aqui — é a única
  rede de segurança sintática, conforme `docs/testing-strategy.md`).
- **Quando usar**: a cada edição em qualquer arquivo dentro de `apps/extension/src/`.
- **Pré-requisitos**: Node instalado.
- **Resultado esperado**: sem saída = sintaxe válida; qualquer erro aponta arquivo:linha exatos.

### `npm run build:extension-vendors`
- **Objetivo**: gerar `apps/extension/src/lib/qrcode-content.js` a partir de
  `scripts/vendor/qrcode-entry.js` via `esbuild` (bundle IIFE minificado) — é a única dependência de
  terceiro empacotada dentro do código da extensão.
- **Quando usar**: só ao atualizar a biblioteca de QR code vendorizada.
- **Pré-requisitos**: `esbuild` instalado (devDependency da raiz).
- **Resultado esperado**: arquivo `qrcode-content.js` regenerado; deve ser revisado/commitado junto
  com a mudança que motivou a atualização.

### `node scripts/test-extension-workspace.mjs`
- **Objetivo**: validar normalização de workspace, migração de `schemaVersion` e paridade do
  `FEATURE_REGISTRY` entre `storage.js` (ESM) e `storage-content.js` (clássico).
- **Quando usar**: obrigatório depois de qualquer mudança em `lib/storage.js` ou
  `lib/storage-content.js` (ver `docs/migration-strategy.md`).
- **Pré-requisitos**: nenhum além de Node.
- **Resultado esperado**: falha explícita se os dois arquivos divergirem em `FEATURE_REGISTRY` ou
  `schemaVersion`.

### `npm run backend:check-schema-sync`
- **Objetivo**: `scripts/check-schema-sync.mjs` — compara, sem precisar de Postgres/Docker, o
  estado final de RLS policies e grants de função que replayar todas as `supabase/migrations/*.sql`
  produziria contra o que `supabase/schema.sql` de fato define. Existe porque a correção de
  segurança de 2026-08-04 (escalonamento de trial) rodou em produção via migration mas nunca foi
  replicada em `schema.sql` — nada detectava esse tipo de divergência antes deste script.
- **Quando usar**: já roda automaticamente dentro de `npm test` (e portanto em `npm run
  test:all:clean` e no CI) — não precisa rodar à parte, mas é rápido o suficiente pra rodar sozinho
  depois de escrever uma migration nova que mexa em `create/drop policy` ou `grant/revoke ... on
  function`.
- **Resultado esperado**: falha explícita listando exatamente qual policy/grant diverge, se
  divergir; caso contrário, confirma quantas policies/grants foram conferidas.

---

## Desenvolvimento da Landing

### `npm run build:landing`
- **Objetivo**: `tsc --noEmit && vite build` do workspace `@qts/landing` (typecheck bloqueia o
  build, não é um passo separado ignorável).
- **Quando usar**: antes de publicar manualmente, ou para reproduzir localmente o que o workflow
  `landing-pages.yml` faz.
- **Pré-requisitos**: variáveis `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY` no ambiente.
- **Resultado esperado**: `apps/landing/dist/` gerado.

### `npm run typecheck -w @qts/landing` / `npm run test -w @qts/landing`
- **Objetivo**: typecheck isolado (`tsc --noEmit`) e suíte Vitest (`vitest run --passWithNoTests`)
  só da Landing.
- **Quando usar**: iterando só na Landing, sem rodar o `typecheck`/`test` monorepo inteiro.
- **Pré-requisitos**: `npm install` feito.
- **Resultado esperado**: erros de tipo ou de teste apontam arquivo:linha dentro de
  `apps/landing/src`.

### `npm run preview -w @qts/landing`
- **Objetivo**: servir `apps/landing/dist/` já buildado localmente (`vite preview`), para inspecionar
  o artefato de produção antes de publicar.
- **Quando usar**: depois de `build:landing`, para conferir o resultado final do build (não o dev
  server com hot reload).
- **Pré-requisitos**: `build:landing` já executado.
- **Resultado esperado**: servidor estático local servindo o build de produção.

---

## Desenvolvimento do Admin

Mesmo padrão da Landing, workspace `@qts/admin`:

- `npm run build:admin` — `tsc --noEmit && vite build` de `apps/admin`.
- `npm run typecheck -w @qts/admin` / `npm run test -w @qts/admin` — isolado do resto do monorepo.
- `npm run preview -w @qts/admin` — serve `apps/admin/dist/` já buildado.

**Pré-requisito importante**: `apps/admin` é founder-only, sem self-signup — rodar localmente exige
uma conta founder já provisionada no backend apontado (nunca teste fluxo de admin contra produção
sem necessidade).

---

## Backend (Supabase)

### `npm run backend:bootstrap`
- **Objetivo**: rodar `scripts/bootstrap-new-backend.ps1` — monta um projeto Supabase novo do zero a
  partir de `supabase/schema.sql`.
- **Quando usar**: só para provisionar um ambiente novo (teste isolado, disaster recovery). **Nunca
  contra produção existente.**
- **Pré-requisitos**: PowerShell, credenciais de um projeto Supabase novo/vazio.
- **Resultado esperado**: schema completo aplicado; ver `docs/migration-strategy.md` para por que
  `schema.sql` precisa estar sempre sincronizado com as migrations reais antes de confiar nele.

### `npm run backend:test:start` / `backend:test:reset` / `backend:test:stop`
- **Objetivo**: subir, resetar e derrubar o Supabase local via Docker (`npx supabase start/db
  reset/stop`) para testes isolados.
- **Quando usar**: antes de rodar testes que dependem de backend real (`backend:check` e os smokes
  `backend:test:*`), sempre em ambiente de teste, nunca produtivo.
- **Pré-requisitos**: Docker rodando; Supabase CLI (via `npx`).
- **Resultado esperado**: instância Postgres/Auth/Storage local isolada, populada pelas migrations.

### `npm run backend:stripe:catalog`
- **Objetivo**: `scripts/bootstrap-stripe-catalog.mjs --archive-legacy` — sincroniza o catálogo de
  preços do Stripe com a tabela `stripe_prices`, arquivando preços legados.
- **Quando usar**: ao criar/alterar planos ou preços no Stripe.
- **Pré-requisitos**: chave de API do Stripe do ambiente correto (teste vs. produção) configurada.
- **Resultado esperado**: `stripe_prices` reflete exatamente o que existe no Stripe — a Landing
  nunca deve hardcodar preço (ver `docs/plans.md`).

### `npm run backend:stripe:webhook`
- **Objetivo**: `scripts/bootstrap-stripe-webhook.ps1` — registra/atualiza o endpoint de webhook do
  Stripe apontando para a Edge Function `stripe-webhook`.
- **Quando usar**: ao provisionar um ambiente novo ou rotacionar o segredo de assinatura do webhook.
- **Pré-requisitos**: acesso à API do Stripe e ao projeto Supabase de destino.
- **Resultado esperado**: webhook configurado; segredo de assinatura atualizado no `.env` correto.

### `npm run backend:test:cors`
- **Objetivo**: `scripts/test-edge-functions-cors.mjs` — confirma que as Edge Functions respondem
  CORS corretamente para as origens esperadas (Landing/Admin/extensão).
- **Quando usar**: depois de mexer em `supabase/functions/_shared/http.ts` ou nas origens
  permitidas.
- **Resultado esperado**: falha explícita se uma origem esperada for rejeitada ou uma inesperada for
  aceita.

### `npm run backend:test:live` / `backend:test:commerce` / `backend:test:admin`
- **Objetivo**: smokes "ao vivo" contra um ambiente Supabase/Stripe de teste real (não local, não
  produção) — `run-live-backend-smokes.ps1`, `smoke-live-backend.mjs`, `smoke-live-admin.mjs`.
- **Quando usar**: validação mais próxima de produção, fora do `test:all:clean` (exige ambiente
  configurado à parte — ver `docs/testing-strategy.md`).
- **Pré-requisitos**: credenciais do ambiente de teste isolado. **Nunca rodar com segredo/dado
  produtivo** (regra explícita de `AGENTS.md`).
- **Resultado esperado**: fluxos reais (checkout, admin) validados de ponta a ponta no ambiente de
  teste.

### `npm run backend:apply-pending`
- **Objetivo**: `scripts/apply-pending-backend-actions.mjs` — aplica migrations/ações pendentes no
  Supabase apontado. **Dry-run por padrão**; precisa de `--apply` para escrever de verdade.
- **Quando usar**: depois de escrever uma migration nova, para conferir/aplicar.
- **Pré-requisitos**: `SUPABASE_ACCESS_TOKEN` (`.env`) e `SUPABASE_PROJECT_REF` (`.env.edge.local`).
- **Resultado esperado**: em dry-run, relatório do que está pendente; com `--apply`, escreve — **em
  produção isso sempre exige aprovação humana explícita no momento**, nunca automática.

### `npm run backend:verify-plan-features`
- **Objetivo**: `scripts/verify-plan-features.mjs` — confere se a matriz `plan_features` no banco
  bate com o que o código espera (ver `docs/plans.md`).
- **Quando usar**: depois de aplicar uma migration ou ação manual que mexa em planos/features.
- **Resultado esperado**: relatório de divergência ferramenta × plano, se houver.

### `npm run backend:check`
- **Objetivo**: roda os testes Deno das Edge Functions (`_shared/http_test.ts`,
  `_shared/admin_mfa_test.ts`, `_shared/entitlements_test.ts`) e `deno check` de tipos em todas as
  functions.
- **Quando usar**: obrigatório depois de mexer em qualquer arquivo de `supabase/functions/`.
- **Pré-requisitos**: acesso a `npx deno@latest` (rede na primeira vez).
- **Resultado esperado**: testes verdes + zero erro de tipo Deno.

---

## Banco de Dados

Ver `docs/migration-strategy.md` para o fluxo completo — resumo dos comandos:

- **Escrever migration nova**: arquivo manual em
  `supabase/migrations/YYYYMMDDHHMMSS_descricao.sql`, sempre idempotente. Sem comando que gera isso
  automaticamente — é escrita manual.
- **Aplicar**: `npm run backend:apply-pending` (ver acima).
- **Sincronizar `schema.sql`**: manual — toda migration que deveria valer para "projeto novo do
  zero" precisa ser replicada à mão em `supabase/schema.sql`. Não existe comando que faça isso
  automaticamente; é responsabilidade de quem escreve a migration conferir.
- **Resetar ambiente de teste local**: `npm run backend:test:reset`.

---

## Testes

Ver `docs/testing-strategy.md` para a tabela completa de camadas/quando rodar. Comandos reais:

| Comando | O que roda |
|---|---|
| `node --check <arquivo>` | Sintaxe de um arquivo `.js` da extensão |
| `npm run typecheck` | TypeScript de todos os workspaces (`--workspaces --if-present`) |
| `node scripts/test-extension-workspace.mjs` | Normalização de workspace / paridade ESM-clássico |
| `npm test` | Unitários de todos os workspaces + `test-extension-workspace.mjs`, `check-schema-sync.mjs`, `test-release-environments.mjs`, `test-update-experience.mjs`, `test-reward-program.mjs`, `test-gif-encoder.mjs` |
| `npm run backend:check` | Testes Deno das Edge Functions |
| `npm run security:repo` / `npm run security:extension` | Ver seção **Segurança** |
| `npm run smoke:lp-admin` (= `npm run test:pages`) | Landing e Admin buildam e renderizam sem erro |
| `npm run test:chrome` | Smoke completo em Chrome real, extensão carregada de verdade |
| `npm run test:chrome:test-package` | Empacota um build de teste (`package:extension:test`) e roda o smoke contra ele, não contra os arquivos soltos |
| `npm run test:all:clean` | Tudo acima em sequência, a partir de `automation:clean` — gate obrigatório antes de PR/merge/release |

### `npm run automation:clean`
- **Objetivo**: `scripts/clean-automation-state.mjs` — remove profile de Chrome de teste, build e
  pacote gerados por execuções anteriores.
- **Quando usar**: **obrigatório antes de qualquer automação da extensão** (regra de `AGENTS.md`) —
  sem isso um teste pode passar contra bundle antigo, ou travar com `EBUSY` num profile de Chrome de
  teste que ficou aberto.
- **Resultado esperado**: estado limpo; nunca use `taskkill` genérico para matar Chrome travado —
  isso mataria também o Chrome pessoal de quem está rodando (encerre por PID específico).

### Testes ausentes conhecidos (não invente comando para eles — não existem hoje)
Acessibilidade (WCAG) automatizada, carga/performance de backend, cobertura de integrações externas
(nenhuma integração externa existe ainda). Ver `docs/testing-strategy.md`.

---

## Lint / Format

**Não existe hoje um comando dedicado de lint ou de formatação automática** em nenhuma das três
aplicações — nem ESLint, nem Prettier, nem equivalente estão configurados em `package.json`
(raiz, `apps/landing`, `apps/admin`) ou em `apps/extension`. O mais próximo disso hoje é:

- `npm run typecheck` — checagem estática de tipos em Landing/Admin (TypeScript).
- `node --check <arquivo>` — checagem de sintaxe na extensão (sem regras de estilo).

`PROPOSTA` (não implementada, não solicitada explicitamente até agora): adicionar ESLint + Prettier
com script `npm run lint` / `npm run format` — decisão de produto/engenharia em aberto, não algo que
deva ser criado sem alinhamento explícito.

---

## Build

- `npm run build:landing` / `npm run build:admin` — ver seções específicas acima.
- `npm run build:extension-vendors` — ver **Desenvolvimento da Extensão**.
- `node scripts/build-pages-local.mjs` — builda Landing e Admin localmente do mesmo jeito que o CI
  antes de rodar `smoke-landing-pages.mjs` (usado internamente por `npm run test:pages`).

---

## Empacotamento da Extensão

### `npm run package:extension`
- **Objetivo**: `scripts/package-extension.mjs` — gera o `.zip` whitelisted para a Chrome Web Store
  (só os arquivos permitidos, conferidos por `security:extension`).
- **Quando usar**: antes de qualquer release real para a Store.
- **Resultado esperado**: `.zip` em `artifacts/` pronto para upload.

### `npm run package:extension:test`
- **Objetivo**: mesma lógica de empacotamento, mas gerando um build isolado para teste
  (`artifacts/extension-test`), sem afetar o pacote de release.
- **Quando usar**: antes de `test:chrome:test-package` ou `dev:extension:test`.

### `npm run package:extension:sideload`
- **Objetivo**: `scripts/package-extension-sideload.mjs` — gera o `.zip` de instalação manual
  (sideload) que a Landing publica como fallback de download enquanto a revisão da Chrome Web Store
  está pendente.
- **Quando usar**: consumido automaticamente pelo workflow `landing-pages.yml`; rode manualmente só
  para depurar esse pacote específico.

### `npm run bump:extension`
- **Objetivo**: `scripts/bump-extension-version.mjs` — incrementa a versão em
  `apps/extension/manifest.json` (e onde mais for necessário).
- **Quando usar**: toda mudança em `apps/extension/` precisa de bump — o CI (`quality.yml`) falha
  sem ele (`check-extension-version-bump.mjs`). Não incremente sem mudança correspondente (regra de
  `AGENTS.md`).

---

## Preview

- `npm run preview -w @qts/landing` / `npm run preview -w @qts/admin` — servem o build de produção
  local (ver seções específicas acima).
- Para a extensão, não existe "preview" separado de desenvolvimento: `npm run dev:extension` (ou
  `dev:extension:test` para testar o pacote real) já abre um Chrome real com o resultado atual.

---

## Segurança

### `npm run security:repo`
- **Objetivo**: `scripts/check-repository.mjs` — varre todo arquivo rastreado/staged do repositório
  procurando padrões de segredo e caminhos proibidos.
- **Quando usar**: automático no hook de pre-commit (via `npm run prepare`); obrigatório antes de
  qualquer commit/release manual também.
- **Resultado esperado**: falha e aponta o arquivo/padrão se encontrar algo suspeito.

### `npm run security:extension`
- **Objetivo**: `scripts/check-extension-bundle.mjs` — confirma que o pacote gerado da extensão
  contém **só** os arquivos da whitelist (nada de teste, doc interna, script de build vazando no
  `.zip` distribuído).
- **Quando usar**: sempre antes de empacotar para release (já incluso em `release:chrome:*`).

### `npm audit --omit=dev --audit-level=critical`
- **Objetivo**: falha o CI se alguma dependência de produção tiver vulnerabilidade crítica
  conhecida. Rodado em `quality.yml`.
- **Quando usar**: automático no CI a cada PR/push; pode ser rodado localmente antes de abrir PR.

### `npm audit --audit-level=high`
- **Objetivo**: registro informativo de vulnerabilidades em dependências de desenvolvimento também
  (`continue-on-error: true` no CI — não bloqueia o merge, só documenta).
- **Quando usar**: automático no CI; leitura do resultado é responsabilidade de quem revisa o PR.

---

## Auditoria de Dependências

- `npm audit` (ver **Segurança** acima) é o único comando de auditoria de dependências hoje.
- `.github/dependabot.yml` mantém PRs automáticos de atualização de dependência (não é um comando
  que você roda — é configuração de CI).
- `THIRD_PARTY_NOTICES.md` na raiz documenta as licenças de terceiros usadas; atualize manualmente
  ao adicionar uma dependência nova relevante (não há comando que gere isso automaticamente hoje).

---

## CI/CD

Nenhum destes é digitado manualmente no dia a dia — são os workflows reais em
`.github/workflows/`, documentados aqui para quem for depurar uma falha de CI:

### `Quality` (`quality.yml`)
- **Gatilho**: todo `pull_request` e todo `push` em `main`/`master`, ou manual
  (`workflow_dispatch`).
- **O que roda, em ordem**: `check-repository.mjs` + `check-extension-bundle.mjs` → checa se
  `apps/extension/` mudou sem bump de versão (`check-extension-version-bump.mjs`) → `npm ci` →
  instala Chromium do Playwright → `npm run typecheck` → `npm run test` → `package:extension:test`
  → `npm audit --omit=dev --audit-level=critical` (bloqueia) → `npm audit --audit-level=high`
  (só registra, não bloqueia).
- **O que este workflow NÃO roda**: `npm run test:chrome` (smoke real em Chrome) e `npm run
  smoke:lp-admin` **não** rodam aqui — só localmente por disciplina de quem abre o PR, ou no
  workflow de publicação (`chrome-store-package.yml`, só na etapa de subir para a Store). Isso é uma
  lacuna real entre o que `AGENTS.md`/`docs/testing-strategy.md` chamam de "obrigatório" e o que o
  CI de fato impõe automaticamente em todo PR — ver observação equivalente na auditoria completa do
  ecossistema.

### `Build Chrome Web Store package` (`chrome-store-package.yml`)
- **Gatilho**: push em `main` que toque `apps/extension/**` ou os scripts de empacotamento (builda
  o artefato, nunca publica); publicação real só via `workflow_dispatch` manual, exigindo digitar
  literalmente `PUBLICAR PRODUCAO` e, no job de publicação, com os segredos da Chrome Web Store
  configurados.
- **O que roda na publicação**: `security:repo`, smoke real em Chrome (`test:chrome`, com `xvfb` no
  Linux do runner), empacotamento, upload via `scripts/publish-chrome-webstore.mjs`.

### `Publish landing page` (`landing-pages.yml`)
- **Gatilho**: push em `main` tocando Landing, Admin, extensão (o sideload zip depende dela) ou os
  próprios scripts de build/publicação; ou manual.
- **O que roda**: typecheck + test de Landing e Admin, valida que a URL do Supabase configurada é
  `https://*.supabase.co`, builda Landing e Admin (Admin embutido em `/admin` do mesmo site),
  empacota o zip de sideload, gera fallback de SPA (`404.html`) e rotas estáticas para
  `/privacidade`, `/redefinir-senha`, `/propriedade-intelectual`, publica no GitHub Pages.

### `CodeQL` (`codeql.yml`)
- **Gatilho**: push/PR em `main`/`master`, mais agenda semanal (`23 6 * * 1`).
- **O que roda**: análise estática de segurança (`security-extended`) para JavaScript/TypeScript.

---

## Release

Ver `docs/release-checklist.md` e `docs/DEPLOY_CHROME_WEBSTORE.md` para o processo completo — os
comandos:

### `npm run release:chrome:update`
- **Objetivo**: `security:repo` + `security:extension` + `test:chrome` + `package:extension` em
  sequência — monta o pacote validado sem subir para a Store.

### `npm run release:chrome:upload`
- **Objetivo**: mesma sequência + upload do pacote como rascunho na Chrome Web Store (sem publicar
  para revisão).
- **Pré-requisitos**: credenciais OAuth da Chrome Web Store configuradas
  (`chrome-webstore:oauth-setup`).

### `npm run release:chrome:publish`
- **Objetivo**: mesma sequência + upload **e** envio para revisão da Google (`--publish`).
- **Atenção**: ação de produção real — nunca automática, sempre exige autorização explícita do
  usuário (regra de `AGENTS.md`), independentemente de testes terem passado.

### `npm run chrome-webstore:oauth-setup`
- **Objetivo**: `scripts/chrome-webstore-oauth-setup.mjs` — fluxo interativo para gerar as
  credenciais OAuth usadas pelos comandos de release acima.
- **Quando usar**: uma vez, ao configurar um ambiente novo com permissão de publicar.

---

## Debugging / Diagnóstico

- `npm run automation:clean` — ver **Testes**. É o primeiro passo de qualquer investigação que
  envolva rodar a extensão automatizada.
- `npm run verify:cineluna` — `scripts/verify-cineluna-import.mjs`: verifica a importação de dados
  legados de um cliente específico ("Cineluna") usada para popular workspace de demonstração/tour.
- `npm run tutorial:capture` — `scripts/capture-tutorial-media.mjs`: recaptura screenshots/vídeos do
  tutorial via Playwright, com pausas legíveis (regra de `AGENTS.md`: nunca deixar mídia antiga
  quando a UI que ela documenta mudou).

---

## Outros (não se encaixam nas categorias padrão)

### `npm run inpi:package`
- **Objetivo**: `scripts/generate-inpi-package.ps1` — monta o pacote de material para registro de
  marca/software no INPI (ver `docs/AUTOMACAO_PACOTE_INPI.md`). Não é um comando de
  desenvolvimento/QA — é jurídico/compliance.
- **Pré-requisitos**: branch `main` por padrão (`-AllowNonMain` para exceção explícita).

### `node scripts/render-ecosystem-diagram.mjs`
- **Objetivo**: pré-renderiza o fluxograma do ecossistema (o mesmo de `docs/ecosystem-audit.md`)
  como SVG estático, para a Central de Confiança da Landing não precisar carregar o runtime do
  Mermaid (~900KB gzipped) para cada visitante.
- **Quando usar**: só quando o diagrama-fonte (dentro do próprio script) ou as cores do tema
  mudarem. Sem alias em `package.json` — rodar direto com `node`.

### `node scripts/apply-plan-features-migration.mjs`
- **Objetivo**: aplica (de forma idempotente, via upsert normal, sem precisar de connection string
  de Postgres) a matriz exata de planos×features definida pela migration
  `20260717080000_new_qa_tools_feature_flags.sql`. Existe porque essa migration específica foi
  mesclada mas nunca chegou a ser executada no projeto real, bloqueando silenciosamente algumas
  ferramentas em todos os planos.
- **Quando usar**: só se `backend:verify-plan-features` apontar divergência causada exatamente por
  essa migration não aplicada. Sem alias em `package.json`.

---

## Ao adicionar um comando novo

1. Adicione o script em `package.json` (raiz ou do workspace certo) com um nome no padrão
   `area:acao` (ex.: `backend:test:cors`), consistente com os já existentes.
2. Documente aqui, na categoria certa, no formato Objetivo/Quando usar/Pré-requisitos/Resultado
   esperado.
3. Se o comando for destrutivo ou tocar produção (deploy, publicação, Supabase produtivo, Stripe),
   deixe isso escrito em maiúsculo/negrito na seção **Atenção**, do mesmo jeito que
   `release:chrome:publish` acima.
