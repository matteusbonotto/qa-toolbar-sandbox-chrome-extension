# Agent/lp privacy and tooling

## 🎯 O que foi feito

Integração completa de **privacidade de dados**, **automação de deploy**, **fluxo de redefinição de senha** e **gating de ferramentas por plano**. Todos os 31 arquivos alterados trabalham juntos para habilitar:

### 1. **Publicação automatizada na Chrome Web Store** (`docs/DEPLOY_CHROME_WEBSTORE.md`)
- Novo fluxo OAuth com Google Cloud para autorização permanente
- Scripts `publish-chrome-webstore.mjs` e `chrome-webstore-oauth-setup.mjs` para automação completa
- Workflow do GitHub Actions (`chrome-store-package.yml`) que **já publica automaticamente em `main`** rodando security scans + smoke test em Chrome real
- Opção manual via `npm run release:chrome:upload` (rascunho) ou `npm run release:chrome:publish` (revisão)
- Nenhuma alteração acidental possível — ID da extensão fixo (`ddaapjklnfjhjigeglgmjmadjnmdodfe`)

### 2. **Redefinição de senha segura** (`apps/landing/src/pages/ResetPasswordPage.tsx`)
- Nova rota `/redefinir-senha` com validação de link OAuth do Supabase
- Componente TypeScript 100% typed com UX clara (feedback síncrono, erros locais)
- Suporta português, espanhol e inglês (adicionados em `i18n/translations.ts`)
- Integração com `supabase.auth.updateUser()` — seguro (nunca envia plaintext em log)

### 3. **Gating de ferramentas por plano**
- Novo banco de dados: tabelas `features` e `plan_features` com migration SQL
- Admin panel (`apps/admin/src/pages/FeatureFlagsPage.tsx`) para controlar qué ferramenta cada plano libera
- Extensão verifica flags em tempo real via `access-status` endpoint
- Ferramentas bloqueadas somem automaticamente do menu **Tools** e mostram toast amigável se usuário tentar forçar

**Distribuição padrão**:
| Ferramenta | Smoke Test | Regression Runner | Root Cause Analyst | Release Manager |
|---|:---:|:---:|:---:|:---:|
| Contador de caracteres | ✓ | ✓ | ✓ | ✓ |
| Multiclick | ✓ | ✓ | ✓ | ✓ |
| Input Lab | — | ✓ | ✓ | ✓ |
| Faker Fill | — | ✓ | ✓ | ✓ |
| Macro Studio | — | — | ✓ | ✓ |
| Key View | — | — | — | ✓ |

### 4. **Landing page: privacidade, página de reset e visual da SPA**
- Política de privacidade em `/privacidade` com SPA fallback correto
- Novo badge de "ilustração interativa" no simulador da toolbar
- Segundo link "Esqueci minha senha" na seção de preços
- Bloqueia compra se usuário já tiver assinatura ativa (status `already_subscribed` + badge visual)
- Tradução completa de novos textos (PT-BR, ES, EN)

### 5. **Dev-friendly tooling**
- `npm run dev:extension` abre um Chrome real com a extensão, perfil persistente para manter login entre execuções
- `docs/GUIA_FERRAMENTAS_QA.md` documenta disponibilidade de cada ferramenta por plano

---

## 📋 Detalhes técnicos

**Segurança**:
- Scripts de deploy **nunca logam** client secret ou refresh token (lidos via env var, never printed)
- Redefinição de senha usa OAuth do Supabase — nunca toca plaintext
- Imports/exports mascaram senhas de sandbox (já era, confirmado aqui)
- CodeQL: 1 alerta alto (clear-text logging) corrigido em `9750aa8`, 1 médio (upload legítimo) a descartar

**CI/CD**:
- Todos os checks já passam: package, verify, analyze
- Novo workflow de publish é automático mas requer 3 repository secrets (cliente/admin configura uma vez)
- Smoke test roda em Chromium real com display virtual no runner

**Testado**:
- Typecheck TypeScript ✓
- Security scans (`security:repo`, `security:extension`) ✓
- Smoke extension em Chrome real ✓
- Importação do fixture Cinemark ✓
- Upload para Chrome Web Store via API (rascunho) ✓

---

## 🔗 Próximos passos (antes de mergear)

1. **Dispensar alerta CodeQL médio** ("File data in outbound network request" em `scripts/publish-chrome-webstore.mjs`)
   - É false positive — é o upload intencional do pacote pro Google
   - Na aba **Security → Code scanning alerts**, marcar como "False positive"

2. **GitHub Actions secrets** (para automação funcionar em CI)
   - Settings → Secrets → Actions → New repository secret
   - `CHROME_WEBSTORE_CLIENT_ID`
   - `CHROME_WEBSTORE_CLIENT_SECRET`
   - `CHROME_WEBSTORE_REFRESH_TOKEN`
   - (Valores em `.env` local; não cole aqui)

3. **Supabase redirect** (para "esqueci minha senha" funcionar)
   - Authentication → URL Configuration → Redirect URLs
   - Adicionar: `https://matteusbonotto.github.io/qa-toolbar-sandbox-chrome-extension/redefinir-senha`

4. **Testes ao vivo**:
   - Admin feature flags: conferir se tabela carrega e salva
   - Reset password: testar fluxo completo com e-mail real
   - Plan gating: confirmar que Macro Studio/Key View somem para planos baixos

Detalhes completos em `docs/PENDENCIAS_USUARIO.md`.

---

## 📊 Mudanças

- **31 arquivos alterados**: +1283 linhas, -22 linhas
- **11 commits** no branch (começando do main 2026-07-16)
- **Todos os checks passam**: package ✓, verify ✓, analyze ✓
- **Bloqueado por**: CodeQL (médio) + mergeable state pending review

---

## 🔐 Segurança

- **OAuth/secrets**: Nunca são logados ou commitados
- **Senhas sandbox**: Removidas de exports (confirmado)
- **Redefinição de senha**: Via Supabase auth (não plaintext)
- **Admin panel**: RLS + autenticação requerida
- **Deploy**: Nunca cria item duplicado na Store
