# Master backlog checklist

Este documento é o registro vivo de aceite do `P.R.O.M.P.T. MESTRE FINAL`. Um item só recebe `Concluído` após implementação, teste e documentação. Limitações de plataforma exigem fallback implementado e explicação ao usuário.

| Bloco | Requisitos | Estado | Evidência principal |
| --- | --- | --- | --- |
| Diagnóstico e arquitetura | 1–8 | Concluído | `docs/architecture`, baseline `npm run check` |
| Login e ações contextuais | 9–11 | Concluído | LP mantém o usuário no fluxo; instalação exige ação e entitlement |
| Vouchers, planos e billing | 12–21, 27 | Concluído | Stripe mensal/anual, `30OFF`, `30DIAS`, migrations, RLS e webhooks |
| LP comercial | 22–30 | Concluído | Hero, mockup realista, recursos, segurança, FAQ, About, temas e privacidade |
| Modelo e CRUD da extensão | 31–35 | Concluído | Schema v2, hierarquia, central CRUD, imagens locais e validação |
| Toolbar e ferramentas | 36–47 | Concluído | Test Status, screenshot, Observatory, consented payload bridge, inspectors e JSON Studio reais |
| Recording e Convertio | 48–59 | Concluído | MediaRecorder capability-first, MP4/WebM, pause/resume/stop/download e GIF/Convertio com consentimento, progresso, cancelamento e cleanup |
| Breakpoint Viewer | 60–64 | Concluído | presets CRUD/reorder/favorites, custom, orientação, zoom, SVGs, lado a lado, URLs, screenshots e scroll sync same-origin |
| i18n, temas e acessibilidade visual | 65–68 | Concluído | PT-BR/EN/ES persistidos, política legal explícita por idioma, temas isolados e gate axe/WCAG |
| FAQ, About e Settings | 69–72 | Concluído | FAQ offline pesquisável, About, diagnóstico redigido, conexão e licença |
| Import/export, cache e reset | 73–76 | Concluído | schema v2, checksum, preview, merge/replace, rollback, export seguro/completo e reset por escopo |
| Paridade, handoff e offline | 77–80 | Concluído | matriz detalhada, token PS256 por instalação, validade curta e grace period |
| Testes e qualidade | 81–86 | Concluído | 40 testes automatizados, WCAG sério/crítico, secret/bundle scans, typecheck, builds e plano manual controlado |
| Documentação e entrega | 87–91 | Concluído | arquitetura, produto, segurança, QA, billing, release, operação e rollback versionados |

## Addendum — sessão 2026-07-16 (painel admin + correções)

Este bloco documenta o trabalho feito contra `docs/handoff/PROMPT_MESTRE_RECONSTRUCAO_TOTAL.md`
(a versão do prompt mestre que introduziu o painel administrativo). Estado honesto, não
retroativamente marcado "Concluído" sem prova:

| Item | Estado | Evidência |
| --- | --- | --- |
| Bug: conta permanente exibida como trial | Corrigido | `supabase/functions/billing-status/index.ts`, commit `2738fb4` |
| Bug crítico: `bootstrap_founder` sem checagem de e-mail | Corrigido | migration `20260716090000_admin_panel_foundation.sql` |
| Painel admin (`apps/admin`) — login Google, CRUD vouchers/planos/preços/features/notices/versions, entitlements, licenças, auditoria | Concluído e testado (typecheck+testes+build) | commits `f7c456b`, `45bbff1`; smoke real via `npm run test:chrome` |
| CORS: matriz positiva + negativa + POST real | Concluído | `scripts/check-cors.mjs`, commit `675d1eb` |
| Stripe: preços editáveis pelo admin sem quebrar checkout/webhook | Concluído | `_shared/stripe.ts`, `stripe-webhook/index.ts` |
| Landing page: GIF externo (Tenor) e typo "sabooour" | Corrigido | `apps/landing/src/App.tsx`, commit `fa1afe7` |
| Deploy do admin junto com a LP (`/admin/` subpath) | Configurado no CI, **não deployado ainda** (requer merge em `main`) | `.github/workflows/landing-pages.yml` |
| Habilitar Google como provider no Supabase Auth | **Pendente — ação manual externa, fora do alcance deste repositório** | `docs/deploy/admin-panel.md` |
| Bootstrap do founder (`matteusbonotto+qa@gmail.com`) | **Pendente — comando documentado, não executado automaticamente** | `docs/deploy/admin-panel.md` |
| Rotação das chaves Stripe/Supabase coladas em texto puro nesta conversa | **Pendente — decisão do usuário, não rotacionadas nesta sessão** | — |

## Regra de encerramento

- Zero botões decorativos ou dados mockados em produção.
- Zero secrets no frontend ou bundle.
- Typecheck, testes, builds, RLS e verificações de segurança aprovados.
- Supabase e Stripe sincronizados com a configuração versionada.
- Limitações reais de Manifest V3 tratadas com fallback utilizável.
