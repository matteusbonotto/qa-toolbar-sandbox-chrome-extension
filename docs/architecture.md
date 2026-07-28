# Arquitetura — QA Toolbar Sandbox

> Referência técnica para quem vai mexer no código. Para o mapa de negócio/fluxos entre as três
> aplicações, veja `docs/ecosystem-audit.md` — este documento aqui é sobre stack, pastas e como
> rodar cada peça localmente.

## Monorepo

```
apps/extension/   Extensão Chrome (Manifest V3), sem framework, sem build step
apps/landing/      React 19 + Vite + TypeScript, GitHub Pages
apps/admin/         React 19 + Vite + TypeScript, GitHub Pages (/admin)
packages/domain/    (reservado — hoje sem código próprio)
supabase/            Schema, migrations, Edge Functions (Deno), seeds
scripts/              Build, empacotamento, testes, deploy — tudo `node scripts/*.mjs`
```

Não há backend próprio fora do Supabase: nenhuma API HTTP escrita à mão, nenhum servidor Node em
produção. Tudo que não é estático (Landing/Admin) ou local (extensão) passa por PostgREST, RPCs
Postgres ou Edge Functions.

## Extensão (`apps/extension`)

- **Sem bundler.** Scripts clássicos carregados diretamente pelo `manifest.json`. Isso existe por
  uma razão específica: content scripts clássicos não suportam `import`, então qualquer módulo
  usado tanto pelo service worker quanto por uma página injetada precisa de **duas cópias
  mantidas manualmente em sincronia** — o par mais importante é `lib/storage.js` (ESM, só o
  service worker) e `lib/storage-content.js` (script clássico, injetado em páginas/`options.html`).
  Qualquer mudança de normalização de dado ou de `FEATURE_REGISTRY` precisa ir nos dois arquivos;
  `scripts/test-extension-workspace.mjs` compara os dois registries por regex e falha se
  divergirem — não é opcional, é a rede de segurança contra exatamente esse tipo de bug (já
  aconteceu: um alias de campo corrigido só no ESM, nunca no clássico).
- **`src/background/`**: service worker. Sessão, `access-status`, registro dinâmico de content
  scripts por padrão de URL (`chrome.scripting.registerContentScripts`).
- **`src/toolbar/`**: a barra em si, injetada via Shadow DOM na página autorizada. Arquivo único
  grande (`toolbar.js`, ~7.8k linhas) — histórico de por que não foi dividido: cada ferramenta
  precisa do mesmo `state` global e dos mesmos helpers (`openDrawer`, `showQaToast`,
  `escapeHtml`), e dividir sem um bundler só trocaria "um arquivo grande" por "N arquivos com
  ordem de `<script>` frágil".
- **`src/pagebridge/`**: único arquivo que roda no MAIN world da página (não no isolated world do
  content script) — é o único lugar que enxerga o `window.fetch`/`XMLHttpRequest` reais da
  página, usado por Network Inspector, Force HTTP e Freeze Clock.
- **`src/popup/`** e **`src/options/`**: páginas padrão de extensão Chrome.
- **`src/lib/`**: os módulos compartilhados (normalização de workspace, i18n, ícones, GIF
  encoder, etc.), sempre em par ESM/clássico quando usados dos dois lados.

### Versionamento de schema do workspace

`storage.js`/`storage-content.js` normalizam o workspace salvo em `chrome.storage.local` através
de um `schemaVersion` incremental (hoje 15). Cada nova ferramenta pinnable entra em
`FEATURE_REGISTRY` **nos dois arquivos**, ganha um `SCHEMA_N_TOOLS` e um bloco
`if (schemaVersion < N) { ... }` que adiciona a ferramenta a workspaces antigos na migração —
nunca remove dado do usuário, só preenche o que faltar. Veja `docs/migration-strategy.md`.

## Landing (`apps/landing`) e Admin (`apps/admin`)

- React 19 + Vite + TypeScript, sem router (`apps/landing/src/App.tsx` faz `matchesPath` manual
  contra `window.location.pathname`; a home é uma página única com seções por âncora).
  `apps/admin` é founder-only, sem self-signup, com MFA por senha + OTP.
- i18n: dicionário TypeScript tipado (`Dictionary` interface) — uma chave faltando quebra o
  build, não é possível esquecer uma tradução silenciosamente nessas duas apps (diferente da
  extensão, que usa `t(literal)` com fallback silencioso — por isso a auditoria desta sessão
  achou 6 strings nunca traduzidas lá, e não teria achado o mesmo tipo de buraco aqui).
- `@supabase/supabase-js` para tudo: Auth, PostgREST, RPC, Functions.

## Backend (`supabase/`)

- `schema.sql`: bootstrap idempotente para um projeto novo do zero — não é o que roda em
  produção dia a dia, é a referência "monte tudo de novo se precisar". `migrations/` é o que
  realmente evolui o banco existente, uma de cada vez, nunca aplicada automaticamente (veja
  `docs/migration-strategy.md`).
- RLS deny-by-default em todas as tabelas; `is_founder()` é o guarda central para tudo que só o
  admin pode fazer. `trg_audit_founder_mutation` audita toda mutação direta via PostgREST numa
  lista fixa de tabelas administrativas.
- Edge Functions (Deno) em `supabase/functions/`: `access-status`, `account-delete`,
  `admin-email-otp`, `auth-recover-password`, `auth-refresh`, `auth-sign-in`,
  `checkout-create-session`, `keep-alive`, `legal-registration`, `referral-track`,
  `rewards-spin`, `stripe-webhook`, `voucher-preview`, `voucher-redeem`.

## Rodando localmente

```bash
npm run dev:landing       # Vite dev server da landing
npm run dev:admin         # Vite dev server do admin
npm run dev:extension     # Chrome real com a extensão carregada, contra o backend de teste
npm run backend:test:start # Supabase local (Docker) para testes isolados
```

Ver `README.md` para a visão geral rápida e `docs/DEPLOY_CHROME_WEBSTORE.md` para publicação.
