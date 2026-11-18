# Handoff 2026-10-21: visuais da toolbar, emulação mobile e Multi Testador

Documento de retomada. Escrito para um agente que chega SEM contexto da conversa original. Leia
inteiro antes de mexer em qualquer arquivo. Siga o `AGENTS.md` (workflow, risco, validação).

Os agentes foram pausados pelo fundador por limite de tokens, não por erro. Nada foi publicado,
mergeado nem enviado para a Chrome Web Store.

## Atualização 2026-10-22, fim do dia (leia primeiro; prevalece sobre tudo abaixo)

Mergeados na main (CI verde): #172 PR 1 (v1.4.39), #173 PR 2 emulação mobile (v1.4.40), #174 PR 3
ponteiro/mouse separados com 8 modelos, artes, holofote e ondas (v1.4.41), #175 Multi Testador fase
1 com correções da revisão de segurança (v1.4.42). Chrome Web Store: NADA publicado; só depois do
fundador testar e aprovar.

Backend do Multi Testador AINDA NÃO está em produção. Falta (precisa de permissão explícita na
sessão, o classificador bloqueou o `db push`):
1. Backup direcionado já feito: `artifacts/backups/prod-targeted-2026-10-22T15-21-40-413Z.json`
   (features, plan_features, policies do Realtime, definição de `review_engagement_campaign`). O
   projeto NÃO tem backup automático do Supabase.
2. `npx supabase db push --linked` a partir da main (aplica `20260821010000` antiga + `20261022120000`).
3. `npx supabase functions deploy multi-tester access-status --project-ref xhusvkylbouwtpcevgri --use-api`.
4. Painel do Supabase: Realtime > desligar "Allow public access".
5. Teste real com duas contas Release Manager.
Bug encontrado (não corrigido): `scripts/apply-pending-backend-actions.mjs` diz "nothing pending"
mesmo com migrations pendentes (o CLI passou a responder em JSON).

Pendências restantes: Multi Testador fase 2 (consenso antes de cliques/submits, ADR 0003);
tutorial/Landing do Multi Testador (dependem do backend publicado); Fase 3 (estresse e segurança do
backend de teste); validações manuais (Cineclub, cursores/modelos nos 3 temas, gravação com
holofote/ondas, `chrome://extensions` sem reativação).

## Atualização 2026-10-22, manhã (histórico)

- Push destravado: `gh` agora está logado como `matteusbonotto` (conta ativa).
- PR 1 enviado e aberto: https://github.com/matteusbonotto/qa-toolbar-sandbox-chrome-extension/pull/172
  (merge é do fundador).
- PR 2 IMPLEMENTADO na branch `feat/pr2-breakpoint-mobile-emulation` (commit `e7b2db4`, v1.4.40),
  seguindo o desenho da seção 4. Revisão do agente `security` sem bloqueador; correções aplicadas
  depois: `disable` sem gate de sessão (logout/escopo com viewer aberto), `removeToolbar` chama
  `cleanupBreakpointViewer`, `removeToolbarFromOpenTabs` apaga todas as session rules,
  `urlFilter` `__qtsbpua=1^` (regexFilter foi tentado e, no smoke completo, a regra existia mas não
  reescrevia o header; teste isolado funcionava; ficou urlFilter), teardown só em `changeInfo.url`
  (status "loading" dispara com qualquer iframe e apagava a regra), `console.warn` nas
  remoções, sem global `__qtsMobileEmulationInstalled`, docs com lacunas (subrecursos/XHR do iframe
  phone saem com UA desktop; `@media` de pointer/hover em CSS não é emulado).
- Validação PR 2: `npm test`, `security:*`, `smoke:lp-admin`, `test:chrome:test-package` e
  `test:chrome` verdes (`consoleErrors:0`, `workerErrors:0`), smoke cobre UA por frame no
  servidor, sinais de toque/pointer, escopo da regra e ausência de vazamento após fechar.
  `backend:check` falhou só por cache local corrompido do Deno em `supabase/functions/node_modules`
  (ignorado pelo git); movido para o scratchpad e passou. `automation:clean` não limpa esse cache.
- Pendências que continuam: validação manual (seção 3 e Cineclub, `chrome://extensions` sem pedido
  de reativação na 1.4.40, justificativa da permissão nova no painel da Web Store), tutorial/FAQ e
  mídia do PR 1, Fase 2 (D1 a D4), Fase 3. Achado não corrigido (baixo): a regra é por aba, então
  um viewer aberto pela toolbar de dentro de um iframe na mesma aba compartilha a mesma regra.

---

## 1. Pedido original do fundador (resumo fiel)

1. Corrigir o cursor desenhado (Key View) que fica longe do ponteiro no Breakpoint Viewer, e mostrar
   o nome do testador no ponteiro (estilo Figma/Miro).
2. Padronizar a top bar do Breakpoint Viewer com o tema do QA Toolbar.
3. Janela de gravação: maior e vertical na hora de escolher o que gravar; depois de iniciar, um
   widget pequeno no canto superior direito com tempo, pausar, parar e cancelar.
4. Cursor e ponteiro personalizáveis: formatos, cores e "backgrounds" (flores, corações, caveiras,
   raios), mantendo aparência profissional.
5. URGENTE: o frame mobile do Breakpoint Viewer não simula celular de verdade. Exemplo: Cinemark
   Cineclub mostra 3 tiers lado a lado (desktop) em vez de empilhados (mobile).
6. Chevrons de scroll da linha de fixados aparecendo "cortadinhos" quando não há nada fixado. Só
   devem aparecer quando há itens a rolar.
7. Feature nova "Multi Testador": sessão colaborativa de até 4 release managers, cursores ao vivo
   com nome e cor, chat, consenso de todos antes de clique/submit, sala só por convite do host,
   host remove participantes, código único por sessão que muda ao encerrar, timeout de inatividade
   configurável pelo host, gravações com os dois mouses, relatórios listando os envolvidos.
8. Testes de estresse (estilo Gatling) e de segurança (ex.: SQL injection) contra o PRÓPRIO backend.
9. Deploy na main e publicação na Chrome Web Store.

Decisões do fundador já tomadas nesta conversa:
- Executar tudo em sequência, um PR por fase, sem checkpoints intermediários.
- Deploy: o agente PREPARA (PR, versão, notas). Merge e publicação na Web Store são do fundador.
- Mobile frame: abordagem "declarativeNetRequest + script injetado" (NÃO usar a permissão
  `debugger`/CDP, rejeitada por mostrar banner de depuração e risco na revisão da Web Store).

---

## 2. Estado do git

| Branch | Base | Estado |
|---|---|---|
| `main` | | intocada (último commit `3a8e8a5`, v1.4.38) |
| `feat/pr1-cursor-recorder-breakpoint-visuals` | `main` | commit `8a0de44`, v1.4.39, PRONTO, NÃO enviado ao GitHub |
| `feat/pr2-breakpoint-mobile-emulation` | PR 1 (`8a0de44`) | sem commits próprios; 3 arquivos editados sem commit (ver seção 4) |

Arquivo não rastreado presente no working tree: `docs/adr/0003-multi-testador-sessao-colaborativa.md`
(ADR proposto da Fase 2, ver seção 5). Ele NÃO entrou no PR 1 de propósito.

### Bloqueio do push (só o fundador resolve)

`git push` falhou. O remote é `https://matteusbonotto@github.com/matteusbonotto/qa-toolbar-sandbox-chrome-extension.git`.
- A conta `matteusbonotto` está com token inválido no `gh`.
- A conta ativa do `gh` (`mb-mblabs`) recebe `403 Permission denied` nesse repo.

O fundador precisa: rodar `gh auth login` com a conta `matteusbonotto`, OU dar acesso de push ao
`mb-mblabs`, OU fazer o push ele mesmo. Não tente contornar a autenticação de outro jeito.
Depois de destravado: push das duas branches e abrir PR 1 contra `main` (o PR 2 contra a branch do
PR 1, ou contra `main` depois do merge do PR 1). O fim da descrição do PR deve ter a linha de
atribuição definida pelo sistema.

---

## 3. PR 1: FEITO (commit `8a0de44`, v1.4.39)

Arquivos: `apps/extension/manifest.json`, `src/background/background.js`, `src/recorder/recorder.js`,
`src/recorder/recorder.css`, `src/toolbar/toolbar.js`, `src/toolbar/toolbar.css`.

Conteúdo:
- Cursor do Key View alinhado no Breakpoint Viewer: `cursorDocumentZoom()` + `positionMouseView`
  compensam o `style.zoom` aplicado no `documentElement` do iframe (causa raiz: `clientX` e
  `position:fixed` não compõem linearmente com zoom na raiz). Com zoom 1 o cálculo é idêntico ao
  antigo.
- Nome do testador ao lado do cursor (pill com cor e contraste automático).
- Customização data-driven: `CURSOR_SHAPES` (mouse, seta, seta fina, mãozinha),
  `CURSOR_BACKGROUNDS` (nenhuma, flores, corações, caveiras, raios), `CURSOR_DEFAULTS`,
  `sanitizeCursorConfig`, `getCursorConfig`, `renderCursorFigure(config)`. Persistido em
  `preferences.keyViewCursor` (passthrough, SEM bump de schemaVersion). UI no drawer da Key View
  (não em options: o smoke exige que a config da Key View fique só no drawer).
  `renderCursorFigure` não lê estado, para o Multi Testador reutilizar com cursores remotos.
- Top bar do Breakpoint Viewer (`breakpointStyles()`) usando tokens `--qts-ui-*`, 3 temas.
- Gravador: janela "escolher" 420x620; ao iniciar a captura, `shrinkToWidget()` em `recorder.js`
  reduz para 230x96 no canto superior direito da tela física (via `window.screen.avail*`, sem
  permissão `system.display`). Cancelar também disponível durante a gravação e libera o stream.
- `ensureEdgeScroller` (toolbar.js): sem conteúdo real, remove os chevrons e limpa
  `canScrollStart/End` (resolve o item 6, robusto ao MutationObserver).
- Fixes do code review: regra do widget compacto escopada em `#actions button:not([hidden])`
  (botão "Escolher" fantasma); guarda de reentrância em `begin()` do recorder (bloqueia
  recording/paused/stopping, permite starting); anel de clique como burst (`qts-click-burst`);
  tradução EN "Mouse".

Validação executada e verde: `test-extension-workspace`, `security:repo`, `security:extension`,
`npm test` (inclui "Update experience checks passed for v1.4.39") e `npm run test:chrome`
(`consoleErrors:0`, `workerErrors:0`, inclui "pinned row edge scroller verified").

NÃO validado ao vivo (o smoke não cobre; o fundador ou um agente com Chrome deve conferir):
1. Cursor custom com nome, cor, formato não-mouse e decoração, nos 3 temas.
2. Cursor com "Zoom do site" diferente de 100% dentro do Breakpoint Viewer.
3. Geometria do widget compacto do gravador (mono e multi-monitor) e ausência do botão fantasma.
4. Linha de fixados vazia sem nenhum chevron.
5. Clicar Start repetidamente não reabre o seletor.

Pendências de release do PR 1 ainda não feitas (AGENTS.md "Mudanças de produto"): revisar
tutorial/tour/FAQ e recapturar screenshots/vídeos que mostrem a janela antiga do gravador (380x300)
ou o cursor antigo. Verificar se existem antes de recapturar.

---

## 4. PR 2: emulação mobile no Breakpoint Viewer (HIGH RISK), NÃO FEITO

### O que existe hoje na branch `feat/pr2-breakpoint-mobile-emulation`

Edições SEM commit deixadas pelo agente de docs pausado (descrevem uma permissão que AINDA NÃO
existe no código):
- `docs/permissions.md` (+26 linhas)
- `docs/security.md` (+15 linhas)
- `apps/landing/src/i18n/translations.ts` (+3 linhas; as páginas TrustCenter e PrivacyPolicy
  renderizam a lista compartilhada `t.privacy.permissions` desse arquivo)

Revise essas três edições com `git diff` antes de continuar: confira PT/EN/ES, ausência de
travessão e se batem com o desenho abaixo. Se o PR 2 for cancelado, reverta-as.

O agente do código da extensão foi pausado SEM deixar edições: manifest, background, toolbar,
smoke e o novo `mobile-emulation.js` estão intocados.

### Causa raiz (confirmada)

O iframe da pane já tem a largura real do device (`toolbar.js`, `buildDeviceFrameHtml`, iframe com
`width:${device.width}px`) e o `transform: scale` é só cosmético, então media queries de largura
funcionam. Sites como o Cineclub detectam mobile por User-Agent (servidor e JS),
`navigator.maxTouchPoints`, `(pointer: coarse)`/`(hover: none)` ou `screen.width`, e a extensão não
emulava nenhum desses sinais.

### Desenho aprovado (implementar exatamente isto)

1. Manifest: adicionar `declarativeNetRequestWithHostAccess` (NÃO `declarativeNetRequest`, que gera
   aviso de instalação e faz o Chrome desabilitar a extensão no auto-update; NÃO
   `declarativeNetRequestFeedback`). A extensão já tem `<all_urls>`, então não há aviso novo.
   Bump 1.4.39 -> 1.4.40 com `node scripts/bump-extension-version.mjs`.
2. Marcador: o viewer tem DUAS panes na mesma aba carregando a MESMA URL, e o DNR não distingue
   uma da outra. Por isso só a URL do iframe da pane phone recebe o query param `__qtsbpua=1`
   (com `?` ou `&`, preservando o hash). Panes laptop/tablet ficam com a URL limpa.
3. `background.js`:
   - Constante `MOBILE_EMULATION_HEADERS`: user-agent Chromium Android realista,
     `sec-ch-ua-mobile: ?1`, `sec-ch-ua-platform: "Android"` (com aspas).
   - Handler `qts:bp-mobile-emulation` com `operation` `enable`/`disable`, com a mesma autorização
     dos handlers existentes (`getAccessState` + `isAuthorizedContentSender`, ver `qts:macro-run`
     e `qts:clear-site-data`). `tabId = sender.tab.id`; `ruleId = tabId` (idempotente).
   - enable: `chrome.declarativeNetRequest.updateSessionRules` com
     `condition: { tabIds:[tabId], resourceTypes:["sub_frame"], urlFilter:"__qtsbpua=1" }` e
     `action: { type:"modifyHeaders", requestHeaders:[set user-agent, sec-ch-ua-mobile, sec-ch-ua-platform] }`.
     Tem que ser session rule: `tabIds` só funciona em session rules, e `modifyHeaders` exige
     host access.
   - Teardown (session rules sobrevivem à morte do service worker, regra 14): `tabs.onRemoved`,
     `tabs.onUpdated` com `status === "loading"` ou `changeInfo.url`, e varredura
     `getSessionRules()` em `onStartup`/`onInstalled`. Tudo em try/catch, sem erro de console.
   - Registrar em `applyContentScriptRegistrationNow()` (junto do pagebridge):
     `{ id:"qts-mobile-emu", js:["src/pagebridge/mobile-emulation.js"], world:"MAIN", runAt:"document_start", allFrames:true }`
     com os mesmos `matches` do pagebridge.
4. Novo `apps/extension/src/pagebridge/mobile-emulation.js` (IIFE clássica, estilo do
   `pagebridge.js`): sai imediatamente se `location.search` não contém `__qtsbpua=1`. Quando ativo,
   falsifica `navigator.userAgent` (mesma string do background, comentário cruzado), `platform`,
   `maxTouchPoints` (5), `screen.width/height/availWidth/availHeight`, e faz patch de
   `window.matchMedia` para `pointer: coarse` e `hover: none` (inclusive `any-pointer`/`any-hover`).
   Roda antes dos scripts do site por ser MAIN + document_start.
5. `toolbar.js` (`openBreakpointViewer`, `fitAndLoad`): toggle "Emular celular" na top bar (só
   aparece com pane phone, ligado por padrão; strings PT/EN/ES no mesmo mecanismo de
   `syncScroll`/`syncClick`). Enviar enable, AGUARDAR o ack e só então setar o `src` da pane phone
   com marcador. Disable ao fechar, Esc, sem pane phone restante ou toggle desligado (recarregar a
   pane sem marcador). Reaplicar no layout inicial, na troca dos selects A/B e no Recarregar. Erro
   do background: carregar sem marcador e mostrar toast discreto.
6. Teste de regressão em `scripts/smoke-extension.mjs` (servidor HTTP local que registra
   `user-agent` e `Sec-Fetch-Dest`):
   (a) main_frame chega com UA desktop;
   (b) sub_frame com marcador chega com UA mobile, sem marcador com UA desktop;
   (c) dentro do iframe phone, `maxTouchPoints > 0` e `matchMedia('(pointer: coarse)').matches`;
   (d) `context.serviceWorkers()[0].evaluate(() => chrome.declarativeNetRequest.getSessionRules())`
       tem a regra com o viewer aberto e fica vazio após fechar;
   (e) depois de fechar, novo request do tab chega com UA desktop (sem vazamento).
7. Docs (já parcialmente feitos, revisar): `docs/permissions.md`, `docs/security.md`, textos
   públicos da permissão em `apps/landing/src/i18n/translations.ts` (PT/EN/ES).

Limitações a documentar no PR: o servidor recebe `__qtsbpua=1`; `navigator.userAgentData` de alta
entropia, `devicePixelRatio`, toque real e orientation não são emulados; navegação de documento
inteiro dentro da pane phone perde o marcador e volta ao desktop; UA emulado é Chromium Android
mesmo em presets "iPhone".

Validação obrigatória (HIGH RISK): `npm run test:all:clean` completo, `npm run smoke:lp-admin`
(Landing mudou), revisão pelo agente `security`, conferir em `chrome://extensions` que o update
para 1.4.40 NÃO pede reativação, e validação manual no Cinemark Cineclub (tiers empilhados na pane
phone).

---

## 5. Fase 2: Multi Testador, NÃO INICIADA (bloqueada por decisões do fundador)

Leia `docs/adr/0003-multi-testador-sessao-colaborativa.md` (status: proposto). Fatos que mudam o
desenho:
- Não existe nenhuma camada de realtime no projeto; seria construída do zero.
- "Release manager" é um PLANO (`plans`), não um papel. Hoje nenhum usuário vê dado de outro.
- A extensão só fala com Edge Functions, nunca direto com o Postgres.
- Consenso: re-despachar um clique gera `isTrusted:false`, que o navegador ignora em ações
  sensíveis. O caminho recomendado é segurar a requisição de rede/submit no `pagebridge`.

Decisões pendentes do fundador antes de qualquer código (D1 a D4 no ADR):
- D1: que identidade aparece para os outros participantes (apelido, nunca e-mail).
- D2: exclusivo do plano release-manager? (reforço por RLS de qualquer forma).
- D3: aceitar canal direto extensão para Supabase Realtime (Opção A) ou relay WebSocket em Edge
  Function (Opção B).
- D4: qualquer escrita no Supabase de produção exige aprovação humana explícita no momento.

Requisitos do fundador para cobrir na implementação: máximo 4 testadores; só o host convida e
remove; código de sala gerado no servidor e rotacionado ao encerrar; timeout de inatividade com
duração escolhida pelo host; convidado nunca executa ação sem o host; gravação capturando todos
os cursores; relatório listando os envolvidos (hoje `buildReportText` em `toolbar.js` não tem
conceito de participante). Reaproveitar `renderCursorFigure` do PR 1 para os cursores remotos.

---

## 6. Fase 3: testes de estresse e segurança do próprio backend, NÃO INICIADA

Escopo: testes de carga (ferramenta estilo Gatling ou k6) e testes de segurança (injeção SQL,
autorização, RLS) contra o backend de TESTE do próprio projeto, nunca produção e nunca terceiros.
Projeto separado da extensão. Antes de começar: ler `docs/testing-strategy.md`, `docs/security.md`
e `COMMANDS.md`; justificar por escrito qualquer dependência nova (regra 3 do AGENTS.md); usar só o
ambiente de teste (`backend:test:start`).

---

## 7. Dicas operacionais aprendidas

- `npm run test:chrome` falha às vezes com "Target page, context or browser has been closed" por
  pressão de memória. Procedimento: matar SOMENTE os `chrome.exe` cujo command line contém
  `chrome-smoke-profile` (nunca taskkill genérico: o Chrome pessoal do fundador fica aberto),
  rodar `npm run automation:clean` e repetir. Na última rodada passou de primeira.
- O CI (`check-extension-version-bump.mjs`) falha se `apps/extension/**` mudar sem bump.
- O hook de pre-commit roda `security:repo` (inclui a regra de travessão).
- Não editar `toolbar.js` com dois agentes em paralelo (arquivo único de ~9k linhas).

---

## 8. Ordem sugerida de retomada

1. Fundador destrava o push; agente faz push do PR 1 e abre o PR contra `main`.
2. Agente revisa as 3 edições de docs do PR 2 e implementa o código do PR 2 (seção 4), valida e
   commita na branch do PR 2.
3. Fundador valida manualmente os itens da seção 3 e o Cineclub.
4. Fundador decide D1 a D4; só então começa a Fase 2.
5. Fase 3 em paralelo ou depois, conforme o fundador priorizar.
6. Merge e publicação na Chrome Web Store: somente o fundador.
