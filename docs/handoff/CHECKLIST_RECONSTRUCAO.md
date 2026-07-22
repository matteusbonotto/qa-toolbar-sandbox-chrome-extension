# Checklist de reconstrução — QA Toolbar Sandbox

> Documento vivo. Atualizado a cada rodada de trabalho para que o progresso não se perca
> entre sessões (limite de uso, troca de agente, etc.). Marque `[x]` somente com evidência executável;
> deixe `[ ]` quando ainda depender de uma ação humana ou externa.

Última atualização: 2026-07-17

## Como usar este documento

- `[x]` = feito e verificado (typecheck/build/smoke test rodado de verdade).
- `[ ]` = pendente ou bloqueado por uma ação humana/externa descrita no próprio item.
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
- [x] Login/cadastro removido do corpo da página e movido para modal aberto por "Entrar" no navbar
      ou pelo CTA de qualquer plano; copy de cliente não menciona Supabase, backend ou detalhes de
      infraestrutura. Modal validado em desktop e viewport de 390 px.
- [x] Seletor de produto `Mobile` agora altera o simulador para um frame real de telefone (`390px`,
      layout vertical), em vez de trocar apenas breadcrumb/URL.
- [x] Plano Free: trial de 30 dias concedido transacionalmente no Supabase, sem criar assinatura
      Stripe de valor zero. Smoke autenticado executado e usuário temporário removido.
- [x] Pós-pagamento validado em 2026-07-17 com cartão Stripe test no Checkout hospedado real:
      redirecionamento para o Pages, `checkout.session.completed`, `invoice.paid`, assinatura ativa,
      entitlement e `access-status` confirmados antes de liberar a ação da Chrome Web Store. O smoke
      remove assinatura, customer, usuários e dados descartáveis no `finally`.
- [x] Quando o acesso fica ativo, a LP repassa a sessão diretamente à extensão publicada
      (`ddaapjklnfjhjigeglgmjmadjnmdodfe`) usando `externally_connectable`; tokens não entram em URL,
      query string, log ou bundle estático.

**Estado**: o stub foi removido. Preços vêm de `stripe_prices`; voucher nunca é validado por lista
hardcoded no browser; senha não é persistida pela LP; URL da Store vem do backend e é validada.

## 2. Painel Admin (`apps/admin`, novo)

- [x] Scaffold do app (React/Vite, mesmo padrão da LP), incluído no artefato Pages em `/admin/`;
      typecheck, build e smoke de carregamento executados em 2026-07-17.
- [x] Autenticação por senha + OTP de e-mail restrita a founder: RLS, `bootstrap_founder()`,
      `admin-email-otp` e route guard implementados para a conta confirmada
      `matteusbonotto+admin@gmail.com`. O código nativo de reautenticação do Supabase tem 8 dígitos,
      expira efetivamente em 10 minutos pelo challenge e só é enviado após uma sessão de senha
      recente. A prova founder é armazenada no banco somente como SHA-256, validada pelo RLS em cada
      operação; o token entregue ao navegador fica apenas na memória da página, nunca em storage
      persistente. A prova expira em no máximo 60 minutos e o frontend encerra a sessão nesse
      momento. Smoke real com
      conta temporária confirmou: senha sem OTP bloqueada, envio de e-mail `200`, OTP incorreto `401`
      prova adulterada e revogada bloqueadas, prova válida aceita, constraint acima de 60 minutos
      rejeitada e limpeza das contas/dados temporários. A tela publicada agora fixa a identidade
      founder correta, exibe as etapas `Senha → Código por e-mail` antes do login e oferece criação
      segura da conta no primeiro acesso. Segurança e fluxo técnico estão concluídos; a criação da
      conta definitiva e o OTP humano permanecem discriminados como ação externa na seção 7.
- [x] Gestão de vouchers e campanhas: criar, listar, editar, ativar/desativar e excluir validados ao
      vivo por uma sessão founder com prova MFA; exclusão de item usado continua bloqueada.
- [x] Gestão de acessos/entitlements manuais: concessão e revogação validadas ao vivo com RLS founder.
- [x] Gestão de licenças (`license_keys` / `license_activations`): criação e revogação validadas ao vivo.
- [x] Gestão de usuários: `admin_list_users()` retornou o diretório real sem expor `auth.users`; roles
      `admin` e `support` foram atribuídas/revogadas em usuário descartável e ele não conseguiu
      acessar ou alterar recursos exclusivos do founder.
- [x] Dashboard e MRR: todas as consultas reais usadas pela tela (`subscriptions`, `stripe_prices`,
      vouchers, licenças, referrals e profiles) passaram sob RLS founder.
- [x] Matriz de roles/RLS validada ao vivo: sem prova MFA o founder é bloqueado; com prova válida é
      autorizado; `admin`/`support` não escalam privilégios; concessão direta de `founder` é rejeitada
      pelo trigger e provas acima de 60 minutos falham na constraint.
- [x] Auditoria administrativa validada ao vivo para mutações de vouchers, campanhas, entitlements,
      licenças e roles; a consulta permanece sanitizada e limitada na UI.

**Estado**: Google OAuth não é necessário. A senha é tratada somente pelo Supabase Auth e nunca é
incluída no Git, migration, seed, log ou bundle. O Gmail recebe o segundo fator pelo e-mail nativo
de reautenticação; login passwordless/OTP isolado não cria prova founder.

## 3. Banco de dados (Supabase) — schema novo do zero

- [x] `supabase/schema.sql` com tabelas, constraints, índices e RLS cobrindo: profiles, plans, features,
      plan_features, entitlement_grants, installations, audit_logs, roles, user_roles,
      payment_customers, subscriptions, entitlement_overrides, license_keys,
      license_activations, webhook_events, payment_events, app_versions, system_notices,
      api_rate_limits, admin_otp_challenges, admin_mfa_sessions, referral_profiles, referrals, vouchers, feature_flags,
      voucher_campaigns, voucher_campaign_redemptions. Migration aplicada ao projeto real; criação
      e remoção de usuário, trigger de profile/referral, entitlement próprio e a matriz positiva/negativa
      de mutações founder foram testados ao vivo.
      Em 2026-07-17 também foram adicionados `stripe_prices`, `checkout_sessions`,
      `referral_profiles` e RPCs transacionais exigidas pelas Edge Functions.
- [x] Seed não sensível de planos (Smoke Test / Regression Runner / Root Cause Analyst / Release Manager) no schema.
- [x] Script idempotente para seed de 4 usuários de teste (um por plano), executado no projeto real
      em modo `--users-only`; nesse modo usa senha aleatória não exibida e o login da LP oferece link
      por e-mail, sem senha compartilhada:
      - `matteusbonotto+st@gmail.com` → Smoke Test (free)
      - `matteusbonotto+rr@gmail.com` → Regression Runner
      - `matteusbonotto+rca@gmail.com` → Root Cause Analyst
      - `matteusbonotto+rm@gmail.com` → Release Manager
      As quatro sessões foram validadas ao vivo por magic link gerado sem envio de e-mail; cada
      `access-status` retornou acesso ativo e exatamente o plano esperado.
- [x] Script de seed de vouchers corrigido: o voucher vitalício usa `grant_days = null`, compatível com
      a constraint e com `redeem_voucher()`. Voucher unitário, campanha, acesso permanente, limite de
      uso e bloqueio de reutilização foram executados no projeto real pelo smoke descartável, sem deixar
      códigos em texto puro ou vouchers artificiais persistentes.
- [x] Estrutura de afiliados/referrals e `reward_referral()` validada com primeiro pagamento Stripe
      assinado completo: referral passou de pendente para premiado e criou grant de 30 dias ao referrer.

**Estado**: projeto `xhusvkylbouwtpcevgri` ativo; as sete migrations de
`20260717010000_bootstrap.sql` a `20260717070000_admin_role_audit_and_mrr.sql` estão aplicadas e
sincronizadas com o repositório. `schema.sql` é fonte reproduzível e deve ficar no Git; ele não contém
chaves, senhas ou vouchers em texto puro.

## 4. Stripe — catálogo novo

- [x] Produtos/Prices Pro e Scale legados arquivados pelo bootstrap idempotente em test mode.
- [x] Catálogo Stripe de teste novo: 3 planos pagos × mensal/anual (6 Prices); produtos Pro/Scale legados arquivados.
- [x] Plano Free com trial de 30 dias concedido transacionalmente pelo Supabase, sem assinatura Stripe de valor zero, conforme o prompt mestre.
- [x] Webhook assinado validado com pagamento Stripe test completo: sincronizou assinatura/entitlement,
      persistiu `invoice.paid` e fez `access-status` liberar a ação contextual da Chrome Web Store.

**Estado**: chave Stripe de teste configurada; catálogo e endpoint webhook do projeto novo criados.

## 5. Edge Functions (Supabase)

- [x] `checkout-create-session` — publicada; trial gratuito autenticado e sessão paga Stripe test
      autenticada executados ao vivo, com limpeza dos usuários/customer/sessão temporários.
- [x] `stripe-webhook` — publicada, assinatura inválida rejeitada e eventos reais `checkout.session.completed`
      e `invoice.paid` processados no Stripe test.
- [x] `voucher-redeem` — publicada; autenticação, resgate unitário/campanha, acesso permanente e bloqueio
      da segunda utilização validados ao vivo.
- [x] `referral-track` — publicada; registro autenticado e recompensa transacional de 30 dias após o
      primeiro pagamento confirmado foram validados ao vivo.
- [x] `keep-alive` — publicada e validada ao vivo com segredo (`200`), comparação timing-safe e rate limit.
- [x] `access-status` — publicada; só retorna URL oficial da Store para entitlement ativo e não confia
      em query string de retorno do Stripe.
- [x] `auth-sign-in` e `auth-refresh` — publicadas para autenticar a extensão sem distribuir chave
      privada ou service role no pacote; login, renovação e `access-status` foram validados ao vivo
      com usuário descartável, removido ao final do smoke.

**Estado real em 2026-07-17**: as nove funções têm implementação e passaram em `deno check`;
os 6 testes Deno dos helpers HTTP/CORS e MFA também passam.
O gateway está configurado em `supabase/config.toml`; `scripts/bootstrap-new-backend.ps1`
aplica o schema, envia os segredos e publica todas as funções com um comando. SQL não consegue
publicar código Deno por si só; por isso o deploy usa a API oficial do Supabase.

**Deploy real em 2026-07-17**: migrations aplicadas ao projeto `xhusvkylbouwtpcevgri`; 9 Edge
Functions publicadas; 6 Stripe Prices de teste registrados; webhook Stripe criado para o projeto
novo; CORS validado em 9 funções × 10 origens (288 assertions). Smokes ao vivo: keep-alive `200`,
endpoints de usuário sem sessão `401`, webhook sem assinatura `400`, trial autenticado confirmado,
sessão paga test criada e validada, `auth-sign-in`/`auth-refresh` positivos, e `access-status`
retornando a Store oficial somente após acesso. `npm run backend:test:live` repete os fluxos de
commerce, webhook, vouchers, referrals e admin/RLS sem imprimir chaves e limpa os dados descartáveis.

## 6. Extensão Chrome

- [x] Autenticação e entitlement obrigatórios em modo fail-closed: sem sessão válida, acesso ativo
      ou conexão com o backend a barra não é registrada. A última sessão válida pode ser renovada;
      sair da conta remove a barra das abas abertas e bloqueia as configurações protegidas.
- [x] Barra alinhada ao fluxo do `tampermonkey.js`: cliente pequeno e discreto na primeira linha;
      projeto, produto e ambiente na segunda; sem o nome “QA Sandbox”; cor vem do ambiente.
- [x] Modo compacto oculta somente os nomes de projeto/produto, mantendo seus ícones e o ambiente.
- [x] URL atual exibida em pill branco, arredondado e com ícone de globo; parâmetros sensíveis são
      mascarados. Navegação SPA (`pushState`, `replaceState`, hash e popstate) reavalia o ambiente.
- [x] Workspace normalizado e reativo: CRUD/duplicação/ativação de clientes, projetos, produtos,
      ambientes, contas sandbox, pagamentos, inspectors, APIs e recursos. Criar, editar ou importar
      URLs de ambiente atualiza o registro da barra imediatamente; sem URL configurada não há injeção.
- [x] Configurações de escopo, aparência, atalhos, dados de teste, integrações e importação/exportação
      segura reconstruídas. Ferramentas do menu podem ser ativadas individualmente; pagamentos e
      recursos aparecem na barra, e inspectors configurados filtram as capturas. Exportação exclui
      senhas, dados de pagamento e tokens locais, inclui checksum SHA-256; falha de importação preserva
      o workspace anterior.
- [x] Kit de produtividade integrado à barra: Contador de caracteres (com/sem espaços, palavras,
      linhas e bytes UTF-8), Multiclick com seleção visual/limites, Input Lab que testa seis classes
      de entrada sem submeter o formulário e restaura o valor original, e Faker Fill local que
      preenche página/formulário com dados sintéticos sem tocar senha, cartão, CVV, token ou segredo.
- [x] Macro Studio declarativo: grava clique/escrita/select/checkbox/tecla; Vibe Code com paleta,
      drag and drop e fluxo conectado; Coder gera Playwright real somente leitura; CRUD, execução,
      importação/exportação versionada e macros fixadas no menu. Reprodução continua na mesma aba
      após navegação completa, com estado efêmero de 10 minutos em `chrome.storage.session`. Upgrade
      de workspace schema 2 → 4 preserva as preferências e habilita os novos kits automaticamente.
- [x] Segurança de macros documentada no ADR 0002: sem `eval`, `new Function`, JavaScript de usuário
      ou código remoto; allowlist de nove ações, limites rígidos, normalização única e bloqueio de
      campos/seletores sensíveis na gravação, importação, Faker e execução.
- [x] Responsive/Breakpoint View centraliza laptop e telefone como um único grupo visual, em vez de
      posicionar cada dispositivo no centro de metade da tela; o conjunto continua responsivo e pode
      reorganizar os frames em janelas estreitas. Smoke mede o centro geométrico no Chrome real.
- [x] Key View local e opt-in: atalhos como `Ctrl+V` usam teclas SVG com efeito 3D e desaparecem em
      3 segundos; temas claro/escuro e grade de 9 posições são configuráveis. Modo Typing mantém até
      2.000 caracteres somente em memória até clicar em Limpar e bloqueia campos sensíveis. O mouse
      visual destaca clique esquerdo/direito/meio e scroll para cima/baixo sem cancelar os eventos.
      Preferências normalizadas no workspace schema 4 e disponíveis tanto no drawer quanto na tela
      completa de configurações, com i18n pt-BR/es/en.
- [x] Smoke em Chrome real cobre bloqueio sem autenticação, login/acesso, hierarquia/URL, contador,
      Key View/Typing/mouse e proteção de senha, Faker protegido, Input Lab, Multiclick,
      gravação/reprodução, Vibe Code/Coder, import/export,
      macro fixada, retomada após navegação, modo compacto, edição de ambiente, SPA, exportação
      segura e logout, com 0 erros de console/worker.
- [x] Script de build simples (`npm run package:extension`) que gera um `.zip` em `~/Downloads`
      (só manifest.json + icons/ + src/ — exclui explicitamente qualquer artefato local tipo
      node_modules/.wxt, mesmo que sobrem no disco de sessões antigas).
- [x] `npm run dev:extension` abre um Chrome real e visível com a extensão carregada via
      `--load-extension` (mesmo mecanismo do `test:chrome`, sem os passos automatizados nem mock de
      rede), com perfil persistente em `artifacts/chrome-dev-profile/` que sobrevive entre execuções.
      Verificado ao vivo: extensão carrega, ID e caminho do service worker aparecem no terminal, e o
      processo Chromium isolado (perfil próprio do Playwright, distinto do Chrome do usuário) encerra
      ao fechar a janela.
- [x] Arquivo de importação (`apps/extension/fixtures/cineluna-import-example.json`) com o
      cenário fictício: Cliente Cineluna (sigla "C") / Projeto WebApp (sigla "WEB") / Produto AR,
      4 ambientes com as cores pedidas (Dev cinza, QA amarelo, Beta verde, Produção vermelho),
      1 conta de teste genérica (sandbox, sem dados reais).
- [x] `npm run verify:cineluna` — testa a importação de ponta a ponta no Chrome real (clica em
      "Importar JSON" pela UI de verdade, confirma contagens/badges/nomes). Rodado 3x seguidas,
      estável, 0 erros de console. Evidência em `artifacts/runtime-evidence/cineluna-import-workspace.png`.
      Domínios do fixture são fictícios (`*.cineluna.example`) — a cobertura de "breadcrumb reage à
      URL certa" já existe de forma genérica em `smoke-extension.mjs`.
- [x] Pacote `v1.0.1` inspecionado: 22 arquivos, sem `manifest.key`, arquivos proibidos ou padrões
      de segredo. Empacotador local e workflow manual usam a mesma whitelist/verificação por
      `npm run release:chrome:update`. O upload deve atualizar o item já publicado; nunca criar uma
      segunda extensão.
- [x] Versão `v1.1.0` preparada com o novo kit de QA e Macro Studio, sem adicionar permissões ao
      Manifest V3. `release:chrome:update` aprovou scanner do repositório, scanner dos 19 arquivos
      da extensão (302,9 KB de fonte), smoke Chrome e gerou ZIP de 88,2 KB. Guia de uso em
      `docs/GUIA_FERRAMENTAS_QA.md` e decisão de segurança no ADR 0002.
- [x] Patch `v1.1.1` centraliza o conjunto do Responsive View, preserva escala compartilhada e
      adiciona cobertura geométrica no smoke Chrome. `release:chrome:update` aprovou scanners,
      smoke completo (0 erros) e gerou ZIP de 88,0 KB a partir de 304,1 KB de fonte inspecionada.
- [x] Versão `v1.1.2` implementa o Key View, migra preferências para o workspace schema 4 e adiciona
      cobertura real de atalhos SVG, expiração, Typing protegido, nove posições, temas e mouse.
      `release:chrome:update` aprovou 348 arquivos no scanner do repositório, bundle com 19 arquivos
      e 341,0 KB de fonte, smoke completo com 0 erros e ZIP final de 96,8 KB.
- [x] Publicação na Chrome Web Store automatizada via Publish API oficial do Google
      (`scripts/publish-chrome-webstore.mjs`), nunca cria item novo (alvo fixo
      `ddaapjklnfjhjigeglgmjmadjnmdodfe` a menos que `--extension-id` seja passado explicitamente).
      `npm run chrome-webstore:oauth-setup` faz a troca OAuth única (conta dona da extensão,
      `client_id`/`client_secret` de um OAuth Client "Desktop app"). Testado ao vivo em 2026-07-17:
      troca de refresh token por access token com o escopo `chromewebstore` correto, e
      `npm run release:chrome:upload` completo (scanners + smoke Chrome real 0 erros + upload)
      aceito pela Store como rascunho do item real. `docs/DEPLOY_CHROME_WEBSTORE.md` documenta o
      setup e os erros comuns (app em modo "Testing" sem test user cadastrado, refresh token não
      reemitido).

## 7. Segurança e publicação

- [x] `.env.edge.local` confirmado como ignorado e não rastreado; o bootstrap remove variáveis
      `SUPABASE_*`, `VITE_*` e `APP_SUPABASE_*` antes de enviar o arquivo de secrets às Functions.
- [x] `supabase/schema.sql` e migrations mantidos no Git por serem DDL reproduzível sem segredo.
      Senhas, service role, Stripe secret, webhook secret e vouchers reais permanecem fora do Git.
- [x] Histórico remoto auditado em 2026-07-17: 57 commits acessíveis verificados, sem formato real
      de Stripe secret, webhook secret, Supabase secret, GitHub token ou chave privada. O único JWT
      encontrado é fixture assinada de teste com chave pública, sem service role.
- [x] Pages publicado auditado após o PR #29 (`77736fb`, workflow `29561893358`): landing e `/admin/`
      retornam `200`; modal por navbar/plano, frame Mobile de `390px`, identidade founder e etapa OTP
      renderizam no Chromium real com 0 erros de console. O bundle publicado contém o handoff para o
      ID oficial, MRR e Auditoria; `.env`, `.env.edge.local`, `schema.sql`, `supabase/schema.sql` e
      `tampermonkey.js` não existem no artefato (`404`).
- [x] Cupons de exemplo hardcoded removidos da LP; validação/consumo ocorre no backend por hash.
- [x] Workflow Pages exige `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` como repository
      variables, constrói landing + admin e falha fechado se a configuração pública estiver ausente.
- [x] Build de produção e smoke Chrome headless locais aprovados para LP, preços reais e `/admin/`.
- [x] MFA administrativo aplicado ao Supabase real em 2026-07-17: migrations `040000`/`050000`,
      nove Edge Functions publicadas e CORS aprovado para 10 origens (288 assertions). O plano Free
      não permite personalizar Magic Link com o remetente padrão; foi usado o e-mail nativo de
      reautenticação do Supabase, que já entrega nonce de 8 dígitos e funcionou no smoke real.
      A migration `060000` também corrigiu o retorno de `auth.users.email` (`varchar` → `text`) na
      RPC `admin_list_users()`, falha encontrada pelo smoke MFA e incorporada ao `schema.sql`.
- [x] Repository variables `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` configuradas sem
      imprimir o valor da chave pública; PR #25 aprovado por `verify` e CodeQL sem novos alertas,
      mesclado em `main` (`18d0ab5`) via API autenticada do GitHub, sem depender de `gh` ou acesso
      administrativo no Windows. Workflow Pages `29557385312` concluído com sucesso e URL real validada.
- [x] PR #29 aprovado por `verify` e CodeQL sem novos alertas após corrigir os dois achados da primeira
      análise, mesclado via API segura em `main` (`77736fb`). Quality `29561893446`, CodeQL
      `29561893367`, Pages `29561893358` e o empacotamento da Store `29561904597` concluíram com
      sucesso. O artefato `chrome-web-store-package` (`8399588287`, 64.240 bytes) está disponível.
- [x] Enviado como rascunho: `npm run release:chrome:upload --env-file .env` rodou de ponta a ponta
      em 2026-07-17 (scanners, smoke Chrome real com 0 erros, empacotamento e upload via Chrome Web
      Store Publish API) para o item existente `ddaapjklnfjhjigeglgmjmadjnmdodfe`. O workflow
      `chrome-store-package.yml` agora também dispara sozinho a cada `push` em `main` que toque
      `apps/extension/**`, rodando os mesmos scanners/smoke num Chrome real com display virtual e
      publicando direto para revisão da Google sem aprovação manual (escolha deliberada) — veja
      `docs/DEPLOY_CHROME_WEBSTORE.md`. Falta configurar os três secrets
      (`CHROME_WEBSTORE_CLIENT_ID/CLIENT_SECRET/REFRESH_TOKEN`) como GitHub Actions repository
      secrets para esse caminho automático funcionar em CI (só existem no `.env` local até agora) e
      confirmar a revisão da loja no rascunho já enviado.
- [x] A tela pública de "Primeiro acesso? Criar conta" foi removida — permitia que qualquer
      visitante de `/admin/` tentasse cadastrar a conta founder antes de você (o e-mail alvo
      fica visível na própria tela). Provisionamento agora é só por script local com a
      service-role key (`supabase/bootstrap-admin-account.mjs`), e "esqueci minha senha" usa o
      fluxo padrão de reset do Supabase.
- [x] Conta admin provisionada e primeiro login real em `/admin/` com senha + OTP humano validado;
      a sessão MFA também foi confirmada após F5, respeitando a expiração de 60 minutos.

---

## O que já está pronto (sessões anteriores)

- [x] Extensão vanilla MV3 reconstruída do zero (sem dados hardcoded); roda somente em URLs de
      ambientes autorizados e após autenticação com entitlement ativo.
- [x] Badges white-label (logo/sigla/iniciais) para Cliente/Projeto/Produto + toggle mostrar nome.
- [x] Contas de teste sandbox-only (mascaradas, nunca exportadas com senha).
- [x] i18n pt-BR/es/en completo na barra, LP e tela reconstruída de configurações: navegação, títulos,
      descrições, formulários, placeholders, ações dinâmicas, estados vazios, confirmações e feedbacks.
      O smoke Chrome alterna EN → ES → PT e valida textos/atributos antes de continuar o CRUD.
- [x] Landing page nova (React/Vite), simulador interativo do toolbar, partículas, nav-toolbar.
- [x] CI restaurado e adaptado (quality/verify, CodeQL/analyze, deploy do GitHub Pages).
- [x] PR #24 mergeada + bumps de dependência consolidados + deploy no ar.
