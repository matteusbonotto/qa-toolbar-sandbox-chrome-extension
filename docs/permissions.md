# Permissões — QA Toolbar Sandbox

> Referência técnica. A explicação em linguagem simples fica em `/permissoes` na Landing
> (`apps/landing/src/pages/TrustCenterPage.tsx`) e na política de privacidade
> (`apps/landing/src/pages/PrivacyPolicyPage.tsx`). Este documento é para quem vai revisar ou
> alterar o `manifest.json` e precisa saber exatamente por que cada permissão existe e como
> validar que o texto público continua batendo com o código real.

## O que o `manifest.json` pede hoje

```json
"permissions": ["storage", "scripting", "tabs", "contextMenus", "alarms", "browsingData", "declarativeNetRequestWithHostAccess"],
"host_permissions": ["<all_urls>"]
```

Não há `optional_permissions` nem `optional_host_permissions` declarados — tudo acima é
obrigatório na instalação. Isso é uma decisão consciente, não uma omissão: várias ferramentas
(Network Inspector, Auto preenchimento, captura de elementos) dependem de rodar em qualquer site que o
QA esteja testando, e o Chrome não permite pedir host permission sob demanda por aba sem
interromper o fluxo de teste com um prompt a cada navegação.

| Permissão | Por que existe | Onde é usada |
|---|---|---|
| `storage` | Workspace, preferências, histórico local (`chrome.storage.local`) | `lib/storage.js`/`storage-content.js` |
| `scripting` | Registrar/desregistrar a barra e o pagebridge dinamicamente, só nos domínios autorizados | `background.js` (`registerContentScripts`/`unregisterContentScripts`) |
| `tabs` | Abrir aba de configurações/handoff de login, detectar URL da aba ativa, screenshot da aba visível ao capturar evidência (`chrome.tabs.captureVisibleTab`) | `background.js`, popup |
| `contextMenus` | Menu de contexto "QA Sandbox" (contar seleção, capturar elemento, etc.) | `background.js` |
| `alarms` | Verificação periódica de `access-status` (plano/entitlement) | `background.js` |
| `browsingData` | Limpar dados do site atual sob comando explícito do QA (ferramenta "Limpar dados do site") | `background.js` |
| (nenhuma) | A gravação de evidência roda em `src/recorder/` (janela popup própria via `chrome.windows.create`, `getDisplayMedia` + `MediaRecorder` em página da extensão). `chrome.windows` e `getDisplayMedia` não exigem permissão no manifest; o seletor nativo de tela do Chrome continua sendo o consentimento do usuário. Decisão de 2026-10-14: `desktopCapture`/`offscreen`/`downloads` foram descartadas porque adicionariam aviso de permissão e desativariam a extensão na atualização até o usuário aceitar | `recorder.js`, `background.js` |
| `declarativeNetRequestWithHostAccess` | Emulação de celular no Breakpoint Viewer (PR 2). Quando uma pane está num device "phone" (sempre: desde a v1.4.46 não existe mais o toggle "Emular celular", a emulação é o padrão de toda pane phone), o service worker cria uma regra de **sessão** (`chrome.declarativeNetRequest.updateSessionRules`) que sobrescreve os headers `user-agent`, `sec-ch-ua-mobile` e `sec-ch-ua-platform` para um Chromium Android. Escopo exato da regra: `tabIds: [aba do viewer]` + `resourceTypes: ["sub_frame", "xmlhttprequest"]` + `urlFilter: "__qtsbpua=1^"` (marcador de query; o `^` exige separador ou fim da URL depois do valor, que só a URL do iframe phone e as chamadas `fetch`/XHR da mesma origem feitas por ele recebem). Nunca afeta `main_frame`, outras abas, a página real embaixo do viewer nem a navegação normal. Teardown: a regra é removida ao fechar o viewer, Esc, trocar para laptop/tablet, a aba navegar para outra URL (`tabs.onUpdated` com `changeInfo.url`; não com `status: "loading"`, que o Chrome também dispara quando qualquer iframe carrega e apagaria a regra logo após criá-la. Um recarregamento na mesma URL mantém a regra até a aba fechar, navegar ou o viewer abrir/fechar de novo, ainda restrita aos sub_frames marcados daquela aba), fechar a aba (`tabs.onRemoved`), no logout ou mudança de escopo (o `disable` não exige sessão ativa, e a remoção da barra em todas as abas apaga todas as regras) e numa varredura em `onStartup`/`onInstalled`. Session rules vivem só em memória do navegador e são apagadas no shutdown e no update da extensão; nada é persistido em disco. **Não gera aviso de instalação**: a variante `WithHostAccess` só atua onde já existe host permission, e a extensão já tem `<all_urls>`, então nenhum aviso novo aparece e o Chrome não desativa a extensão no auto-update (compatível com a decisão de 2026-10-14 acima). Por que não `declarativeNetRequest` "nua": ela gera o aviso "Bloquear conteúdo em qualquer página" e desativaria a extensão na atualização até o usuário aceitar. `declarativeNetRequestFeedback` não é usado. Por que não `debugger` (CDP, emulação completa): exibe o banner de depuração do Chrome em toda a janela e tem alto risco na revisão da Chrome Web Store; rejeitada pelo fundador | `background.js` (regras de sessão e teardown), `src/pagebridge/mobile-emulation.js` (content script MAIN world, `document_start`, `allFrames`: inerte em qualquer frame sem o marcador; no iframe phone falsifica `navigator.userAgent`/`platform`/`maxTouchPoints`, `screen.*` e `matchMedia` de `pointer`/`hover`), `toolbar.js` (URL marcada e nome `qts-bp-phone` do iframe phone) |
| `<all_urls>` (host) | Injetar a barra e o pagebridge no domínio que o QA está testando; também satisfaz o requisito de host permission do `captureVisibleTab`, tornando `activeTab` redundante (removida em 2026-08-04) | `background.js` |

## `web_accessible_resources`

Arquivos que uma página pode carregar pela URL `chrome-extension://`, todos estáticos e sem dado do
usuário: `src/assets/sounds/*.mp3` (efeitos sonoros da barra), `src/assets/platforms/*.png` (ícones de
plataforma) e `icons/icon-48.png` (logo da barra no modo "Todos os sites", desde a v1.4.46). A barra
usa a URL da extensão e não `data:` porque um `img-src` rígido no CSP da página bloquearia `data:`.
Custo aceito: um site consegue detectar que a extensão está instalada pedindo esse arquivo, o que
os sons e ícones de plataforma já permitiam.

## Limitações conhecidas da emulação de celular (`declarativeNetRequestWithHostAccess`)

Registradas para que o texto público nunca prometa mais do que o código entrega:

- O servidor recebe o query param `__qtsbpua=1` na URL do iframe phone; um site que varie o
  render por query param desconhecido pode se comportar diferente.
- `navigator.userAgentData` de alta entropia, `devicePixelRatio`, toque real e `orientation` não
  são emulados.
- Navegação de documento inteiro dentro do iframe phone perde o marcador na URL. Desde a v1.4.46 o
  iframe phone tem o nome `qts-bp-phone` (sobrevive à navegação), e `mobile-emulation.js` recarrega
  o documento novo com o marcador em `document_start`, uma vez a cada 5 s no máximo (carimbo em
  `sessionStorage`), para um servidor que remova query params desconhecidos não causar loop.
- O UA emulado é sempre Chromium Android, mesmo em presets chamados iPhone (o preset controla só
  o tamanho da pane).
- O documento do iframe phone e as chamadas `fetch`/XHR **da mesma origem** feitas por ele
  recebem o UA Android no header (desde a v1.4.46: `mobile-emulation.js` acrescenta o marcador a
  essas URLs e a regra cobre `xmlhttprequest`). Motivo: frameworks SPA (Next.js RSC, por exemplo)
  buscam a renderização da próxima página por `fetch`, e o servidor escolhe o layout pelo UA dessa
  chamada. Chamadas de outra origem, scripts, imagens e CSS continuam com o UA desktop (acrescentar
  parâmetro em URL de terceiros pode quebrar URL assinada).
- `@media (pointer: ...)`/`(hover: ...)` escritos em CSS não são emulados; só `matchMedia`
  chamado por JavaScript.
- Emulação completa via `debugger`/CDP foi rejeitada (banner de depuração e risco na revisão da
  Chrome Web Store), então essas lacunas são aceitas por decisão de produto, não por omissão.

## `<all_urls>` não significa "sempre ativo em todo lugar"

`background.js` calcula, a cada mudança de workspace ou de escopo, **quais padrões de URL a
barra realmente registra** (`patternsForAuthorizedWorkspace()`), e desregistra o que sair do
escopo. Três modos de escopo (`getSiteScope()`/`saveSiteScope()` em Configurações):

- **`all`** — registra `<all_urls>` de fato (usa a permissão inteira).
- **`custom`** — só os padrões que o usuário cadastrar manualmente.
- **qualquer outro valor (padrão)** — só os padrões dos ambientes/URLs configurados no workspace
  (`workspace.urlBindings`), nada além disso.

`isAuthorizedContentSender()` faz a mesma checagem do lado do service worker antes de aceitar
qualquer mensagem de um content script — não é só a barra que respeita o escopo, o canal de
comunicação inteiro é fechado fora dele.

**Regra para quem mexer aqui**: se o texto público (`/permissoes`, política de privacidade)
afirma que um escopo restringe algo, essa afirmação só pode continuar publicada se
`patternsForAuthorizedWorkspace()`/`isAuthorizedContentSender()` realmente implementarem isso.
Auditoria feita nesta sessão confirmou que está correto — não altere um lado sem revisar o outro.

## O que a extensão nunca faz com essas permissões

- Não injeta em `chrome://`, Web Store ou outras extensões (Manifest V3 já bloqueia isso).
- Não lê `history`/bookmarks — nenhuma dessas permissões foi solicitada.
- Não bloqueia, redireciona nem lê requisições: a única regra de `declarativeNetRequest` criada é
  a de sessão do Breakpoint Viewer (troca de headers de UA no `sub_frame` marcado da aba do
  viewer), e `declarativeNetRequestFeedback` não é solicitada, então a extensão não consegue ver
  quais requisições casaram com a regra.
- Não faz upload de conteúdo de página, cookies ou credenciais reais para servidor algum; o que
  sai para o Supabase é sessão/plano/telemetria de erro sanitizada (ver `docs/security.md`).

## Ao adicionar uma nova permissão

1. Justifique por escrito aqui (motivo + arquivo que usa).
2. Atualize a tabela de `/permissoes` (`TrustCenterPage.tsx`) e a política de privacidade nos 3
   idiomas.
3. Rode `npm run test:chrome` — o smoke verifica que a extensão carrega e a barra injeta
   corretamente; uma permissão nova mal declarada quebra isso antes de chegar à Web Store.
4. Confirme na documentação oficial do Chrome se a permissão gera aviso de instalação. Se gerar,
   ela desativa a extensão no auto-update até o usuário aceitar (ver decisão de 2026-10-14 na
   tabela): só entra com aprovação explícita do fundador. Prefira a variante que reaproveita a
   host permission existente (ex.: `declarativeNetRequestWithHostAccess` em vez de
   `declarativeNetRequest`).
