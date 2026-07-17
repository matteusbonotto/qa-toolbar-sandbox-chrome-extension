# Checklist de reconstrução — QA Toolbar Sandbox

> Documento vivo. Atualizado a cada rodada de trabalho para que o progresso não se perca
> entre sessões (limite de uso, troca de agente, etc.). Marque `[x]` ao concluir e deixe uma
> nota curta de onde parou quando um item ficar parcial.

Última atualização: 2026-07-17

## Como usar este documento

- `[x]` = feito e verificado (typecheck/build/smoke test rodado de verdade).
- `[~]` = parcial / feito mas não verificado ponta-a-ponta (geralmente por falta de backend real).
- `[ ]` = não iniciado.
- Cada seção tem uma nota de "Bloqueio" quando o item depende de algo que só o usuário pode fazer
  (criar projeto Supabase, configurar Stripe, etc.).

---

## 1. Landing Page — correções de fidelidade e UX

- [x] Barra do simulador: botões de ferramentas "pinned" (Test Status..Record) coladas à
      direita, sem vão antes do grupo fixo (⚙/▲) — corrigido um bug real de CSS duplicada
      (`.qts-mock-bar-actions` tinha uma regra antiga esquecida com `flex-shrink:0`).
- [x] Logo ao lado de "Matheus Bonotto" no rodapé: `https://matheusbonotto.com.br/assets/logo-branco.png`.
- [x] Página `/privacidade` 404 no GitHub Pages — causa raiz: links usavam caminho absoluto
      `/privacidade` (ignorando o base path `/qa-toolbar-sandbox-chrome-extension/` do projeto)
      e não havia fallback para navegação direta/reload. Corrigido: hrefs usam `BASE_URL`,
      e o workflow de deploy agora copia `index.html` → `404.html` (padrão SPA no GH Pages).
- [x] Scroll suave ao clicar nos links `#id` do menu (`scroll-behavior: smooth`, respeitando
      `prefers-reduced-motion`).
- [x] Trocar e-mail de suporte em todo o site para `contato@matheusbonotto.com.br`.
- [x] Visualização de planos anual x mensal, com desconto de ~20% no anual.
- [x] Plano Free: trial de 30 dias concedido transacionalmente no Supabase, sem criar assinatura
      Stripe de valor zero. Smoke autenticado executado e usuário temporário removido.
- [~] Pós-pagamento: a LP abre somente `checkout.stripe.com`, consulta `access-status` no retorno
      e exibe a ação explícita da Chrome Web Store apenas com entitlement confirmado. Falta concluir
      um pagamento test completo para provar o webhook assinado ponta a ponta.

**Estado**: o stub foi removido. Preços vêm de `stripe_prices`; voucher nunca é validado por lista
hardcoded no browser; senha não é persistida pela LP; URL da Store vem do backend e é validada.

## 2. Painel Admin (`apps/admin`, novo)

- [x] Scaffold do app (React/Vite, mesmo padrão da LP), incluído no artefato Pages em `/admin/`;
      typecheck, build e smoke de carregamento executados em 2026-07-17.
- [~] Autenticação por senha + OTP de e-mail restrita a founder: RLS, `bootstrap_founder()`,
      `admin-email-otp` e route guard implementados para a conta confirmada
      `matteusbonotto+admin@gmail.com`. O código nativo de reautenticação do Supabase tem 8 dígitos,
      expira efetivamente em 10 minutos pelo challenge e só é enviado após uma sessão de senha
      recente. A prova founder é armazenada somente como SHA-256, validada pelo RLS em cada operação,
      expira em no máximo 60 minutos e o frontend encerra a sessão nesse momento. Smoke real com
      conta temporária confirmou: senha sem OTP bloqueada, envio de e-mail `200`, OTP incorreto `401`
      prova adulterada e revogada bloqueadas, prova válida aceita, constraint acima de 60 minutos
      rejeitada e limpeza das contas/dados temporários. Falta o cadastro definitivo e o login humano
      com o código real no Pages.
- [~] Gestão de vouchers (criar, listar e ativar/desativar implementados; falta edição/exclusão e validação real).
- [~] Gestão de acessos/entitlements manuais (conceder/revogar implementados; falta validação real).
- [~] Gestão de licenças (`license_keys` / `license_activations`) implementada na UI; falta validação real.
- [~] Gestão de usuários (diretório usa `admin_list_users()` para obter e-mail sem expor `auth.users`;
      atribuir/revogar roles implementado; falta validação via login founder real).
- [~] Dashboard (métricas básicas implementadas; MRR ainda não modelado/exibido).
- [~] Sistema de roles (founder/support no schema e guard de founder; falta role admin e testes RLS).

**Estado**: Google OAuth não é necessário. A senha é tratada somente pelo Supabase Auth e nunca é
incluída no Git, migration, seed, log ou bundle. O Gmail recebe o segundo fator pelo e-mail nativo
de reautenticação; login passwordless/OTP isolado não cria prova founder.

## 3. Banco de dados (Supabase) — schema novo do zero

- [~] `supabase/schema.sql` com tabelas, constraints, índices e RLS cobrindo: profiles, plans, features,
      plan_features, entitlement_grants, installations, audit_logs, roles, user_roles,
      payment_customers, subscriptions, entitlement_overrides, license_keys,
      license_activations, webhook_events, payment_events, app_versions, system_notices,
      api_rate_limits, admin_otp_challenges, admin_mfa_sessions, referral_profiles, referrals, vouchers, feature_flags,
      voucher_campaigns, voucher_campaign_redemptions. Migration aplicada ao projeto real; criação
      e remoção de usuário, trigger de profile/referral e entitlement próprio foram testados ao vivo.
      Ainda faltam testes positivos/negativos completos das mutações founder.
      Em 2026-07-17 também foram adicionados `stripe_prices`, `checkout_sessions`,
      `referral_profiles` e RPCs transacionais exigidas pelas Edge Functions.
- [x] Seed não sensível de planos (Smoke Test / Regression Runner / Root Cause Analyst / Release Manager) no schema.
- [~] Script idempotente para seed de 4 usuários de teste (um por plano), com senha fornecida apenas por `QTS_TEST_USER_PASSWORD`:
      - `matteusbonotto+st@gmail.com` → Smoke Test (free)
      - `matteusbonotto+rr@gmail.com` → Regression Runner
      - `matteusbonotto+rca@gmail.com` → Root Cause Analyst
      - `matteusbonotto+rm@gmail.com` → Release Manager
- [~] Script de seed de vouchers de teste: desconto, dias extras, vitalício; falta executar no projeto real.
- [~] Estrutura de afiliados/referrals e `reward_referral()` transacional implementadas; falta validar
      a recompensa com um primeiro pagamento assinado completo.

**Estado**: projeto `xhusvkylbouwtpcevgri` ativo; migrations `20260717010000_bootstrap.sql` e
`20260717020000_fix_user_signup.sql` aplicadas. `schema.sql` é fonte reproduzível e deve ficar no Git;
ele não contém chaves, senhas ou vouchers em texto puro.

## 4. Stripe — catálogo novo

- [x] Produtos/Prices Pro e Scale legados arquivados pelo bootstrap idempotente em test mode.
- [x] Catálogo Stripe de teste novo: 3 planos pagos × mensal/anual (6 Prices); produtos Pro/Scale legados arquivados.
- [x] Plano Free com trial de 30 dias concedido transacionalmente pelo Supabase, sem assinatura Stripe de valor zero, conforme o prompt mestre.
- [~] Webhook assinado sincroniza assinatura/entitlement e `access-status` libera a ação contextual
      da Chrome Web Store. Falta apenas a evidência de um pagamento test completo.

**Estado**: chave Stripe de teste configurada; catálogo e endpoint webhook do projeto novo criados.

## 5. Edge Functions (Supabase)

- [x] `checkout-create-session` — publicada; trial gratuito autenticado e sessão paga Stripe test
      autenticada executados ao vivo, com limpeza dos usuários/customer/sessão temporários.
- [~] `stripe-webhook` — publicada e conectada ao Stripe test; assinatura ausente rejeitada ao vivo, falta evento de pagamento completo.
- [~] `voucher-redeem` — publicada; autenticação negativa e CORS validados ao vivo, falta resgate autenticado real.
- [~] `referral-track` — implementada; recompensa transacional de 30 dias é aplicada após primeiro pagamento confirmado.
- [x] `keep-alive` — publicada e validada ao vivo com segredo (`200`), comparação timing-safe e rate limit.
- [x] `access-status` — publicada; só retorna URL oficial da Store para entitlement ativo e não confia
      em query string de retorno do Stripe.

**Estado real em 2026-07-17**: as seis funções têm implementação e passaram em `deno check`;
os 3 testes Deno do helper HTTP/CORS também passam.
O gateway está configurado em `supabase/config.toml`; `scripts/bootstrap-new-backend.ps1`
aplica o schema, envia os segredos e publica todas as funções com um comando. SQL não consegue
publicar código Deno por si só; por isso o deploy usa a API oficial do Supabase.

**Deploy real em 2026-07-17**: migrations aplicadas ao projeto `xhusvkylbouwtpcevgri`; 6 Edge
Functions publicadas; 6 Stripe Prices de teste registrados; webhook Stripe criado para o projeto
novo; CORS validado em 6 funções × 10 origens (132 assertions). Smokes ao vivo: keep-alive `200`,
endpoints de usuário sem sessão `401`, webhook sem assinatura `400`, trial autenticado confirmado,
sessão paga test criada e validada, e `access-status` retornando a Store oficial somente após acesso.

## 6. Extensão Chrome

- [x] Script de build simples (`npm run package:extension`) que gera um `.zip` em `~/Downloads`
      (só manifest.json + icons/ + src/ — exclui explicitamente qualquer artefato local tipo
      node_modules/.wxt, mesmo que sobrem no disco de sessões antigas).
- [x] Arquivo de importação (`apps/extension/fixtures/cinemark-import-example.json`) com o
      cenário real: Cliente Cinemark (sigla "C") / Projeto WebApp (sigla "WEB") / Produto AR,
      4 ambientes com as cores pedidas (Dev cinza, QA amarelo, Beta verde, Produção vermelho),
      1 conta de teste genérica (sandbox, sem dados reais).
- [x] `npm run verify:cinemark` — testa a importação de ponta a ponta no Chrome real (clica em
      "Importar JSON" pela UI de verdade, confirma contagens/badges/nomes). Rodado 3x seguidas,
      estável, 0 erros de console. Evidência em `artifacts/runtime-evidence/cinemark-import-workspace.png`.
      **Não naveguei para os domínios reais do Cinemark** (não seria apropriado bater num site
      de produção de terceiros num teste automatizado) — a cobertura de "breadcrumb reage à
      URL certa" já existe de forma genérica em `smoke-extension.mjs`.

## 7. Segurança e publicação

- [x] `.env.edge.local` confirmado como ignorado e não rastreado; o bootstrap remove variáveis
      `SUPABASE_*`, `VITE_*` e `APP_SUPABASE_*` antes de enviar o arquivo de secrets às Functions.
- [x] `supabase/schema.sql` e migrations mantidos no Git por serem DDL reproduzível sem segredo.
      Senhas, service role, Stripe secret, webhook secret e vouchers reais permanecem fora do Git.
- [x] Histórico remoto auditado em 2026-07-17: 57 commits acessíveis verificados, sem formato real
      de Stripe secret, webhook secret, Supabase secret, GitHub token ou chave privada. O único JWT
      encontrado é fixture assinada de teste com chave pública, sem service role.
- [x] Pages publicado auditado: HTML e bundle `200`, zero formatos de segredo; `.env`, `schema.sql`,
      `supabase/schema.sql` e `/admin/` não existem no artefato publicado atual (`404`).
- [x] Cupons de exemplo hardcoded removidos da LP; validação/consumo ocorre no backend por hash.
- [x] Workflow Pages exige `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` como repository
      variables, constrói landing + admin e falha fechado se a configuração pública estiver ausente.
- [x] Build de produção e smoke Chrome headless locais aprovados para LP, preços reais e `/admin/`.
- [x] MFA administrativo aplicado ao Supabase real em 2026-07-17: migrations `040000`/`050000`,
      sete Edge Functions publicadas e CORS aprovado para 10 origens (224 assertions). O plano Free
      não permite personalizar Magic Link com o remetente padrão; foi usado o e-mail nativo de
      reautenticação do Supabase, que já entrega nonce de 8 dígitos e funcionou no smoke real.
      A migration `060000` também corrigiu o retorno de `auth.users.email` (`varchar` → `text`) na
      RPC `admin_list_users()`, falha encontrada pelo smoke MFA e incorporada ao `schema.sql`.
- [ ] Configurar as duas repository variables no GitHub, publicar/mesclar em `main` e validar a URL
      real do Pages. Bloqueado localmente porque o GitHub CLI (`gh`) ainda não está instalado/autenticado.
- [ ] Criar/confirmar a conta founder e validar o login humano no admin publicado.

---

## O que já está pronto (sessões anteriores)

- [x] Extensão vanilla MV3 reconstruída do zero (sem dados hardcoded, roda em qualquer site).
- [x] Badges white-label (logo/sigla/iniciais) para Cliente/Projeto/Produto + toggle mostrar nome.
- [x] Contas de teste sandbox-only (mascaradas, nunca exportadas com senha).
- [x] i18n completo (pt-BR/es/en) na extensão e na LP.
- [x] Landing page nova (React/Vite), simulador interativo do toolbar, partículas, nav-toolbar.
- [x] CI restaurado e adaptado (quality/verify, CodeQL/analyze, deploy do GitHub Pages).
- [x] PR #24 mergeada + bumps de dependência consolidados + deploy no ar.
