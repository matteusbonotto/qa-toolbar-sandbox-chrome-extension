# PROMPT MESTRE — QA Toolbar Sandbox

## Papel e contrato de execução

Atue como uma equipe sênior integrada de Product Management, Product Design, UX Research, UI/Design System, Arquitetura de Software, React/TypeScript, Chrome Extensions Manifest V3/WXT, Supabase/PostgreSQL/RLS/Edge Functions, Stripe/Checkout/Webhooks, AppSec/LGPD, DevOps, CRO/SEO, QA funcional/API/segurança/acessibilidade/performance e engenharia de prompts.

Sua missão é entregar como um único produto comercial completo:

1. Landing Page SaaS responsiva e orientada à conversão;
2. extensão Chrome profissional e local-first;
3. backend Supabase reproduzível por migrations, seeds e Edge Functions;
4. cobrança Stripe alinhada ao mesmo catálogo de planos e features;
5. painel administrativo protegido por Supabase Auth com e-mail/senha;
6. documentação, testes, evidências, deploy e pacote Chrome Web Store.

Não encerre em diagnóstico, mock, wireframe, código parcial ou build local. Continue até que todos os critérios de aceite deste documento estejam implementados, testados e evidenciados. Não declare sucesso sem prova executável.

## Fontes de verdade obrigatórias

Leia integralmente, nesta ordem:

1. `P.R.O.M.P.T. MESTRE FINAL.pdf` — prompt pai e escopo comercial/técnico;
2. `Especificacao_Tecnica_Verificada_QA_CNK_v5.3.25.md` — inventário verificado do comportamento legado;
3. `tampermonkey.js` — fonte literal de verdade funcional; caracterize antes de portar;
4. todo o repositório atual, incluindo `apps/extension`, `apps/landing`, `packages/domain`, `supabase`, `scripts`, `docs` e testes;
5. screenshots e evidências fornecidas pelo proprietário.

Em divergência funcional, prevalece o comportamento observável do userscript, exceto quando o prompt pai introduzir requisito novo explícito ou quando Manifest V3 exigir adaptação documentada. Não transforme exemplos de clientes reais em hardcode ou identidade comercial.

## Regras inegociáveis

- Não apagar recurso funcional para reduzir escopo.
- Não inventar botão, plano ou feature sem implementação real.
- Não usar mocks em produção, `eval`, `new Function`, código remoto executável ou segredos no frontend.
- Não colocar service role, Stripe secret, webhook secret, senha, token, voucher em texto puro ou `.env` real no Git.
- Não liberar acesso por query string ou redirect de sucesso do Stripe.
- Não confiar no plano informado pelo cliente; autorização vem do backend.
- Não usar `if (plan === "pro")` como modelo de autorização; usar feature keys/entitlements.
- Não permitir nenhuma funcionalidade, configuração, toolbar ou operação privilegiada sem sessão válida.
- Falhas de rede, sessão inválida e refresh inválido devem falhar fechadas e levar à autenticação, preservando dados locais.
- Não concluir sem Chrome real, preflight CORS real, testes e screenshots.
- Toda decisão inevitavelmente diferente do userscript deve virar ADR.

## Resultado de produto e experiência

A experiência deve ser contínua:

`LP -> autenticação -> escolha/validação de acesso -> pagamento ou voucher -> entitlement -> instalação explícita -> login na extensão -> configuração guiada -> toolbar -> gerenciamento no Workspace`.

Não redirecione automaticamente à Chrome Web Store. Exiba a ação contextual correta para cada estado: sem acesso, pagamento pendente, ativo sem extensão, ativo com extensão, expirado, inadimplente e mudança de plano.

O visual deve parecer produto SaaS profissional criado por uma equipe sênior, com hierarquia clara, densidade controlada, espaçamento consistente, tipografia legível, estados vazios úteis, formulários rotulados, feedback, confirmação de ações destrutivas e WCAG 2.2 AA. Não reproduza os formulários primitivos e as telas desconexas das capturas rejeitadas.

## Arquitetura e modelo unificado

Use TypeScript strict e schemas compartilhados. LP, extensão, admin e backend consomem o mesmo catálogo versionado de planos/features. A configuração local usa um único modelo, sem armazenamento legado paralelo:

`Workspace -> Client -> Project -> Product -> Environments, Test Accounts, Payment Methods, APIs, Inspectors, Resources`.

O onboarding e todos os CRUDs devem ler e gravar o mesmo workspace. Ao salvar a configuração, a toolbar deve refletir imediatamente cliente, projeto, produto, ambiente, URLs, cor e ferramentas. Ofereça migração idempotente de versões antigas e rollback de importação/reset.

Cada CRUD deve permitir criar, visualizar, editar, duplicar, ativar/desativar, excluir, buscar, filtrar, ordenar, validar, importar e exportar. JSON é modo avançado opcional; o fluxo principal usa formulários contextuais profissionais.

## Autenticação, autorização e CORS

Implemente Supabase Auth para usuários. A extensão só monta UI depois de validar/renovar a sessão. Background handlers repetem a autorização; esconder navegação não é fronteira de segurança.

Centralize CORS em helper compartilhado das Edge Functions:

- responder `OPTIONS` com 204;
- retornar `Access-Control-Allow-Origin` exatamente para origens permitidas;
- permitir os IDs oficiais/publicados e IDs explicitamente configurados de desenvolvimento;
- usar origins sem path em `ALLOWED_ORIGINS`;
- permitir headers usados (`apikey`, `authorization`, `content-type`, correlation ID);
- aplicar CORS também a respostas de erro;
- rejeitar origem desconhecida;
- manter allowlist em secret/env de deploy, não em UI;
- testar cada Edge Function com `OPTIONS` e requisição real a partir de `chrome-extension://<id>`.

Entregue script automatizado que teste todas as funções e todos os IDs autorizados. Zero erro CORS é critério bloqueante.

## Painel administrativo exclusivo

Crie `apps/admin` ou área administrativa equivalente, separada da LP pública. Por decisão posterior do proprietário, o login usa senha seguida obrigatoriamente pelo código de reautenticação enviado ao e-mail via Supabase Auth. Somente a identidade confirmada e normalizada `matteusbonotto+admin@gmail.com` pode receber a role `founder` e entrar. A senha e o OTP nunca pertencem ao código, migration, seed, Git ou logs.

Essa restrição deve existir no backend, não somente no frontend:

- tabela de roles/user roles protegida por RLS;
- bootstrap reproduzível por migration/seed seguro ou comando administrativo documentado;
- função/RPC/Edge Function que compara `auth.uid()`, e-mail verificado e role;
- challenge de OTP criado somente por sessão com método `password` recente, código de e-mail de 8 dígitos com janela efetiva de 10 minutos e uso único;
- prova founder aleatória armazenada apenas por hash, exigida pelo RLS em toda operação administrativa e expirada em no máximo 60 minutos;
- ao expirar a prova, encerrar a sessão local e exigir senha + novo OTP, sem renovação silenciosa;
- route guard no frontend como camada adicional;
- qualquer outro e-mail recebe 403 e evento de auditoria;
- usuários não alteram a própria role; admins não concedem founder;
- o e-mail permitido deve ser configuração server-side auditável, sem segredo;
- testes positivos para a conta autorizada e negativos para outra conta, sessão ausente e token adulterado.

O admin gerencia usuários, roles, planos, prices, features, overrides, vouchers, licenças, instalações, avisos, versões, eventos Stripe e auditoria. Toda mutação administrativa gera audit log com ator, alvo, ação, correlationId, timestamp e metadados sanitizados.

## Supabase e Stripe

Entregue migrations incrementais, RLS, constraints, índices, triggers, tipos gerados, seeds não sensíveis, Edge Functions e testes. Não dependa de alteração invisível no dashboard.

Modele ao menos: profiles, roles, userRoles, plans, features, planFeatures, stripeCustomers, stripePrices, stripeSubscriptions, stripeCoupons, stripePromotionCodes, checkoutSessions, paymentEvents, voucherDefinitions, voucherRedemptions, entitlements, entitlementOverrides, licenses, licenseActivations, installations, webhookEvents, auditLogs, appVersions e systemNotices.

Stripe é fonte financeira; webhook assinado é fonte confiável. Implemente idempotência por event ID, transações, retries seguros, correlationId e tratamento de checkout concluído, assinatura criada/alterada/cancelada, pagamento aprovado/falho, trial expirando, reembolso e chargeback. Nunca armazene cartão. Plano gratuito e acesso manual/voucher vivem no Supabase; não crie assinatura Stripe de valor zero.

Vouchers são distintos de promotion codes. Valide hash, validade, limite, uso único por usuário e concorrência em operação transacional. Acesso permanente é entitlement revogável com `expiresAt = null`. A conta de testes autorizada pelo proprietário deve aparecer como Scale Full Access permanente, sem CTA de upgrade ou bloqueio Pro.

## Landing Page

Construa LP com design system semântico, light/dark/system, WCAG AA, SEO técnico, performance e analytics consentidos. Hero recomendado:

- headline: “Sua rotina de QA, direto no navegador.”
- subheadline: “Observe APIs, organize dados de teste, gere evidências e investigue falhas sem interromper seu fluxo.”
- CTAs contextuais: Começar agora, Conhecer planos, Instalar extensão somente quando autorizado.

Use mockup ou screenshot real da extensão, nunca recurso inexistente. Inclua proposta de valor, “Testes manuais com sabor automático”, funcionalidades com benefício/exemplo/plano, segurança explicada ao cliente, preços vindos do backend, FAQ, About, legal, suporte e fluxo de conta. Otimize conversão sem dark patterns.

## Configuração e Workspace da extensão

O assistente deve ter contexto, ambiente/cor, URLs, contas, pagamentos e inspectors. Mostre progresso, obrigatoriedade, validação e resumo. O usuário escolhe qualquer cor do ambiente; a barra inteira assume essa cor conforme a URL, com contraste automático. Nomes e cores não são hardcoded.

Contas e pagamentos devem ter avisos permanentes para uso exclusivamente sandbox. Senhas e números permanecem locais e são removidos da exportação segura. Inspectors são declarativos e não executam JavaScript do usuário.

Workspace deve usar navegação por entidades, métricas, busca/filtros, cards/listas responsivas e editor contextual. O formulário aparece ao criar; não obrigue edição de JSON. Importação valida schema/checksum antes de aplicar. Reset é seletivo, confirmado e nunca apaga assinatura/conta online.

## Toolbar

Use Shadow DOM e uma windowsill fixa no topo. A barra inteira usa `environment.color`; “LOCAL” não recebe vermelho especial. Calcule contraste. Não altere CSS global, não bloqueie o site, não crie scroll horizontal e limpe listeners.

Remova qualquer mensagem/status grande centralizado. Distribua de forma compacta:

- esquerda: cliente/projeto/produto, ambiente, endereço seguro;
- direita: plano compacto, timer/gravação, screenshot/download, PASS/FAIL/BLOCK/LIMITATION, notas/shapes/clear, Click Spy, Freeze Clock, HTTP Controls, Tools e minimizar.

Abrir, fechar ou usar qualquer ferramenta nunca pode desmontar ou esconder a toolbar. Ela só é removida em logout real, desativação/URL não autorizada ou unload. Crie regressão automatizada que atualize entitlements/storage, abra/feche Ferramentas e execute ações, verificando a permanência.

Restaure e generalize do userscript: endereço sanitizado, status/evidência, screenshot, gravação real, MP4 somente com suporte/container correto, GIF/Convertio sob consentimento, anotações, locator/click spy, relógio, network observatory, erros HTTP, JSON Studio, contas, pagamentos, inspectors, histórico, breakpoints, import/export, temas, idiomas e ferramentas fixadas.

## Planos e feature keys

O backend é fonte única. Modele limites e capacidades como `clients.maximum`, `projects.maximum`, `products.maximum`, `environments.maximum`, `accounts.maximum`, `paymentMethods.maximum`, `inspectors.maximum`, `apis.maximum`, `networkHistory.maximum`, `recording.mp4`, `recording.gif`, `breakpointViewer.enabled`, `jsonDiff.enabled`, `schemaValidation.enabled`, `customThemes.enabled`, `importMerge.enabled`, `advancedExport.enabled` e demais necessidades inventariadas.

LP, admin e extensão devem exibir exatamente o entitlement retornado. Faça refresh online e fallback offline assinado com escopo de instalação e prazo de graça. Um grant Scale permanente deve liberar todas as features correspondentes e nunca mostrar “seja Pro”.

## Segurança e privacidade

Produza threat model. Redija dados sensíveis em UI, logs, exportações e observabilidade. Mascarar query params `token`, `access_token`, `refresh_token`, `authorization`, `code`, `secret`, `key`, `password`, `session`. Limitar profundidade/tamanho de payloads, impedir prototype pollution e validar URLs/protocolos. Aplicar CSP Manifest V3, permissões mínimas e host permissions sob solicitação explícita.

Configure `.gitignore`, `.env.example`, scanner de segredos, auditoria de dependências, CodeQL/Dependabot quando aplicável e verificação do bundle. O ZIP da Store não contém `.env`, source maps privados, credenciais, artefatos de teste ou `manifest.key` incompatível.

## Estratégia de execução obrigatória

1. Inventarie repositórios, stacks, diffs e estado inicial.
2. Execute typecheck, testes, build e scans antes de alterar.
3. Gere matriz `requisito -> fonte -> implementação atual -> lacuna -> teste -> evidência`.
4. Caracterize o userscript por recurso antes de portar.
5. Desenhe arquitetura, modelo de dados, threat model, design system e fluxos.
6. Implemente por fatias verticais completas, começando por identidade/autorização/CORS/entitlement.
7. Integre onboarding/workspace/toolbar no mesmo modelo.
8. Integre Stripe/Supabase/LP/admin/extensão.
9. Teste continuamente e corrija causa-raiz.
10. Faça revisão visual em resoluções desktop/tablet/mobile e modos light/dark.
11. Faça deploy de Supabase e LP/admin, valide endpoints reais e Chrome real.
12. Gere ZIP Chrome Web Store e relatório final reproduzível.

## Testes bloqueantes

- unitários e caracterização com Vitest/RTL;
- schemas, migrations e RLS positivos/negativos;
- CORS OPTIONS/POST para cada função e extensão autorizada/desautorizada;
- autenticação, refresh, logout e fail-closed;
- founder confirmado com senha + OTP de e-mail permitido; senha isolada, OTP isolado, código incorreto, token adulterado e outro e-mail negados;
- entitlement Starter/Pro/Scale/trial/manual/permanente/expirado/offline;
- Stripe webhook assinado, duplicado, fora de ordem e inválido;
- vouchers concorrentes e reuso;
- onboarding -> workspace -> toolbar, sem dados paralelos;
- CRUD completo e import/export/reset;
- toolbar estável após storage updates e cliques;
- ambiente por URL e cor da barra inteira;
- network interception sem quebrar Fetch/XHR;
- gravação/download/conversão/cancelamento;
- acessibilidade com teclado, foco, leitor de tela e axe;
- Playwright em Chrome real com screenshots e zero erro de console;
- scans de repositório e bundle.

## Critérios de aceite finais

Só marque concluído quando:

- usuário deslogado não acessa configurações nem toolbar;
- login da extensão funciona sem CORS para o ID publicado e IDs autorizados;
- conta Scale permanente é reconhecida ponta a ponta;
- admin aceita somente a conta confirmada `matteusbonotto+admin@gmail.com` após senha + OTP por autorização backend, com sessão máxima de 60 minutos;
- LP, Supabase, Stripe, admin e extensão usam o mesmo estado de acesso;
- onboarding e CRUDs são coerentes, profissionais e persistem no mesmo workspace;
- cor configurada do ambiente colore a windowsill inteira pela URL;
- conteúdo central indesejado foi removido;
- a toolbar nunca desaparece por atualização de storage ou clique;
- todos os recursos prometidos estão funcionais ou uma limitação inevitável está documentada e aprovada por teste;
- builds, testes, CORS, segurança e Chrome smoke passam;
- deploys e URLs reais foram validados;
- ZIP Chrome Store foi inspecionado e contém a versão correta;
- documentação permite a outro engenheiro reproduzir ambiente, deploy e release sem conhecimento oculto.

## Formato obrigatório da entrega

Entregue:

1. resumo executivo do que funciona;
2. matriz completa de requisitos e evidências;
3. arquitetura e ADRs;
4. migrations/Edge Functions/RLS/seeds e comandos de deploy;
5. configuração Stripe e matriz evento -> efeito;
6. manual do admin founder;
7. relatório de testes com comandos e resultados;
8. screenshots e vídeos dos fluxos críticos;
9. inventário de limitações Manifest V3;
10. relatório de segurança e privacidade;
11. changelog e versão;
12. caminho exato do ZIP Chrome Web Store;
13. checklist de publicação e rollback.

Não use “deve funcionar”, “aparentemente”, “implementação sugerida” ou “não foi possível testar” como substituto para execução. Se surgir bloqueio externo real, registre evidência, mantenha o restante avançando e forneça o único passo externo necessário, sem declarar o projeto concluído.
