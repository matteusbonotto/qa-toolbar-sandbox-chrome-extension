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
- [ ] Plano Free: checkout no Stripe com valor R$0 por 30 dias, depois vira free limitado.
- [ ] Pós-pagamento: liberar download + redirecionar para Chrome Web Store.

**Nota**: os dois últimos itens desta seção dependem do backend (Stripe + Supabase) que
ainda não existe — o checkout hoje é um stub honesto (mostra mensagem "ainda não configurado"
em vez de fingir sucesso). Serão implementados quando o backend novo estiver de pé.

## 2. Painel Admin (`apps/admin`, novo)

- [ ] Scaffold do app (React/Vite, mesmo padrão da LP).
- [ ] Autenticação restrita a founder (Google OAuth, e-mail verificado).
- [ ] CRUD de vouchers (código, plano, dias concedidos, limite de resgates, ativo/inativo).
- [ ] CRUD de acessos/entitlements manuais (conceder/revogar plano a um usuário).
- [ ] Gestão de licenças (`license_keys` / `license_activations`).
- [ ] Gestão de usuários (listar, ver plano atual, roles).
- [ ] Dashboard (métricas: assinaturas ativas, MRR estimado, vouchers resgatados, etc.).
- [ ] Sistema de roles (founder/admin/support — ver schema `roles`/`user_roles`).

**Bloqueio**: painel vai chamar Supabase (tabelas abaixo). Sem projeto novo configurado,
fica funcional na UI mas sem dados reais até você plugar as credenciais.

## 3. Banco de dados (Supabase) — schema novo do zero

- [ ] `supabase/schema.sql` robusto, à prova de erros, cobrindo: profiles, plans, features,
      plan_features, entitlement_grants, installations, audit_logs, roles, user_roles,
      payment_customers, subscriptions, entitlement_overrides, license_keys,
      license_activations, webhook_events, payment_events, app_versions, system_notices,
      api_rate_limits, referral_profiles, referrals, vouchers, feature_flags,
      voucher_campaigns, voucher_campaign_redemptions — mais RLS policies.
- [ ] Seed de planos (Smoke Test / Regression Runner / Root Cause Analyst / Release Manager).
- [ ] Seed de 4 usuários de teste (um por plano), senha `Qwert@1234`:
      - `matteusbonotto+st@gmail.com` → Smoke Test (free)
      - `matteusbonotto+rr@gmail.com` → Regression Runner
      - `matteusbonotto+rca@gmail.com` → Root Cause Analyst
      - `matteusbonotto+rm@gmail.com` → Release Manager
- [ ] Seed de vouchers de teste: desconto, dias extras, vitalício.
- [ ] Esquema de afiliados: código de referral, vantagem para quem indicou quando o indicado paga.

**Bloqueio**: preciso que você crie o projeto Supabase novo e rode este `schema.sql` lá —
não tenho como executar contra um banco real a partir daqui.

## 4. Stripe — catálogo novo

- [ ] Zerar/arquivar catálogo de produtos e preços atual (ação manual sua no dashboard Stripe,
      ou script que eu preparo pra você rodar).
- [ ] Catálogo novo: 4 planos, cada um com 2 tipos de cobrança (mensal/anual).
- [ ] Preço R$0 / 30 dias para o plano Free (trial via checkout, não bypass).
- [ ] Webhook de confirmação de pagamento → libera download + redireciona pra Chrome Web Store.

**Bloqueio**: preciso de uma chave Stripe seguindo o fluxo combinado (nunca colada em texto
puro no chat) e acesso ao dashboard para criar produtos/preços.

## 5. Edge Functions (Supabase)

- [ ] `checkout-create-session` — cria sessão Stripe Checkout (planos + voucher).
- [ ] `stripe-webhook` — processa eventos de pagamento, atualiza `subscriptions`/`entitlement_grants`.
- [ ] `voucher-redeem` — resgata voucher/campanha, cria `entitlement_grants`.
- [ ] `referral-track` — registra indicação e aplica recompensa ao indicador.
- [ ] `keep-alive` — ping periódico para manter o projeto Supabase free-tier ativo.

**Bloqueio**: código pronto, mas o deploy (`supabase functions deploy`) precisa ser feito
por você (ou me dar acesso ao CLI autenticado).

## 6. Extensão Chrome

- [ ] Script de build simples (`npm run package:extension`) que gera um `.zip` pronto em
      `~/Downloads`, pra carregar via "Carregar sem compactação" (pasta) ou upload direto.
- [ ] Arquivo de importação (workspace JSON) com o cenário real do Cinemark para validar
      a extensão de ponta a ponta (Cliente Cinemark / Projeto WebApp / Produto AR, 4 ambientes,
      1 conta de teste, 1 cartão de teste).
- [ ] Teste manual real no Chrome com esse workspace importado, revisando bugs restantes
      antes de nova publicação na Web Store.

---

## O que já está pronto (sessões anteriores)

- [x] Extensão vanilla MV3 reconstruída do zero (sem dados hardcoded, roda em qualquer site).
- [x] Badges white-label (logo/sigla/iniciais) para Cliente/Projeto/Produto + toggle mostrar nome.
- [x] Contas de teste sandbox-only (mascaradas, nunca exportadas com senha).
- [x] i18n completo (pt-BR/es/en) na extensão e na LP.
- [x] Landing page nova (React/Vite), simulador interativo do toolbar, partículas, nav-toolbar.
- [x] CI restaurado e adaptado (quality/verify, CodeQL/analyze, deploy do GitHub Pages).
- [x] PR #24 mergeada + bumps de dependência consolidados + deploy no ar.
