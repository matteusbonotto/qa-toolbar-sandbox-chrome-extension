# Auditoria — acessibilidade, performance, SEO e RBAC de Landing/Admin (2026-08-21)

> Auditoria read-only, spot-check (não é uma auditoria WCAG formal nem Lighthouse real — ver seção
> de cobertura no final). Escopo: `apps/landing/src`, `apps/admin/src`. Nenhum arquivo foi alterado.

## Acessibilidade

| Severidade | Achado | Local |
|---|---|---|
| Médio | Matriz de feature flags por plano sem nome acessível por célula — `<th>` marca só colunas de plano, os `<input>` de cada célula não têm `aria-label`/`aria-labelledby` ligando plano+feature. Tela crítica (controla acesso real ao produto); leitor de tela só ouve "checkbox", sem saber qual plano/feature está sendo alterado | `apps/admin/src/pages/FeatureFlagsPage.tsx:75-116` |
| Médio | Formulários com `placeholder` como único rótulo, sem `<label>`/`aria-label` — padrão inconsistente com outras páginas do mesmo app que fazem certo (`AccessPage.tsx:67-86`, `LegalRegistrationPage.tsx:126-176`) | `VouchersPage.tsx:214-241,305-339`, `UsersPage.tsx:58,69`, `LicensesPage.tsx:63,72` |
| Médio | Indicador de página ativa na navegação lateral do admin depende só de classe CSS, sem `aria-current="page"` | `apps/admin/src/components/Layout.tsx:32-38` |
| Médio / não confirmado | Modal de autenticação tem `role="dialog"`/`aria-modal="true"`/fecha com Escape, mas sem lib de focus-trap nem `onKeyDown` capturando Tab — só `autoFocus` no e-mail garante foco inicial. Não confirmado em runtime se o foco escapa do overlay | `apps/landing/src/sections/PricingSection.tsx:585-588,151,642` |
| Baixo | Botões só-ícone do simulador de toolbar (demo mais visível do produto na landing) usam só `title`, sem `aria-label`; menu "ferramentas" sem `aria-expanded`/`aria-haspopup`; itens do menu sem `role="menuitem"` | `apps/landing/src/components/MockToolbar.tsx:113-205` |
| — (confirmado OK) | Status de sucesso/erro/aprovação sempre acompanhado de texto redundante à cor (toasts com `role="status"`, badges com label textual, campos com `aria-invalid`+`aria-describedby`) | `Toast.tsx`, `PricingSection.tsx` |

## Performance

| Severidade | Achado | Local |
|---|---|---|
| Alto | Logo SVG usado em toda a aplicação (favicon, nav, modal de auth, sidebar do admin) pesa **485 KB** (claro) / **412 KB** (escuro) — carregado em praticamente toda página de ambas as apps para um ícone de 22-28px. Maior gargalo real de peso encontrado — afeta LCP/first paint de todas as rotas | `apps/landing/public/qa-toolbar-sandbox-logo.svg` (+ variante dark) |
| Baixo | 3 SVGs órfãos em `apps/landing/src/assets/` somando **~6,8 MB** (`logo-colorido.svg` 2,27 MB, `qaSBTB.svg` 2,25 MB, `logo-branco.svg` 2,25 MB) — sem import encontrado em `apps/`, parecem não entrar no bundle, mas são peso morto no repo e risco se alguém importar futuramente | `apps/landing/src/assets/` |
| — (confirmado OK) | Vídeos tutoriais (`public/tutorial-videos/*.webm`, 270-690 KB) usam `preload="none"`; GIF de demonstração usa `loading="lazy"`; sem fonte externa via `@import`/Google Fonts | `TutorialVideosSection.tsx:30`, `SemiAutoSection.tsx:20` |
| Informativo | `vite.config.ts` de landing e admin já têm `manualChunks` separando `supabase`/`react`/`vendor` (code-splitting básico existe). Sem plugin de compressão/otimização de imagem configurado — GitHub Pages costuma servir gzip/brotli via Fastly automaticamente, então o impacto real é menor, mas **não medido** | `apps/landing/vite.config.ts`, `apps/admin/vite.config.ts` |

## SEO (landing)

| Severidade | Achado |
|---|---|
| Alto | Sem Open Graph, Twitter Card ou `<link rel="canonical">` em `apps/landing/index.html` — só há `<meta name="description">` e `<title>`. Compartilhamento em redes sociais não gera preview de card |
| Alto | Sem `apps/landing/public/robots.txt` nem `sitemap.xml` (confirmado por listagem direta) |
| — (confirmado OK) | `apps/admin/index.html:6` tem `<meta name="robots" content="noindex, nofollow">` — correto para o app founder-only |

## RBAC na UI do Admin

Verificados 5 fluxos destrutivos/sensíveis: excluir voucher (`VouchersPage.tsx:287`), excluir
campanha (`:382`), revogar/excluir chave de licença (`LicensesPage.tsx:101-117`), remover role de
usuário (`UsersPage.tsx:105-114`), ajustar pontos de reward/revisar campanha/gerenciar afiliado
(`api.ts:346-380`).

**Nenhum caso encontrado onde uma ação sensível depende só de gate client-side.** A única barreira
de renderização visual é o `Gate` global em `App.tsx:23-25` (cosmético, redireciona para login se
`status !== "founder"`). A autorização real está no backend em todos os casos verificados: toda
mutação em `api.ts` cai em `.from(table).insert/update/delete()` ou `.rpc(...)`, e
`supabase/schema.sql` confirma RLS com `is_founder()` cobrindo `vouchers`, `voucher_campaigns`,
`license_keys`, `license_activations`, `user_roles`, `entitlement_grants` (linhas 1318-1357), mais
guards explícitos dentro de `manage_affiliate_profile` (linha 1083), `review_engagement_campaign`
(linhas 1127/1870) e `credit_reward_points` (linha 1728). Este é o padrão correto — regra do próprio
projeto ("Admin não pode depender de esconder botão") está sendo respeitada.

## Cobertura desta auditoria (o que NÃO foi verificado)

Não é auditoria WCAG formal nem Lighthouse real — sem ferramentas automatizadas (axe, Lighthouse,
WAVE), sem medição de Core Web Vitals, sem teste de navegação por teclado/leitor de tela em runtime,
sem verificação numérica de contraste, sem revisão detalhada de `IntellectualPropertyPage`,
`TrustCenterPage`, `NotFoundPage` (ambos apps), `AuditPage`, `DashboardPage`, `CampaignsPage`, sem
confirmação em runtime do escape de foco do modal de auth, sem `vite build` real para medir bundle
size, sem confirmação se os SVGs de 485/412 KB têm raster embutido ou são complexos de fato (só
tamanho em disco).
