# Permissões — QA Toolbar Sandbox

> Referência técnica. A explicação em linguagem simples fica em `/permissoes` na Landing
> (`apps/landing/src/pages/TrustCenterPage.tsx`) e na política de privacidade
> (`apps/landing/src/pages/PrivacyPolicyPage.tsx`). Este documento é para quem vai revisar ou
> alterar o `manifest.json` e precisa saber exatamente por que cada permissão existe e como
> validar que o texto público continua batendo com o código real.

## O que o `manifest.json` pede hoje

```json
"permissions": ["storage", "scripting", "tabs", "contextMenus", "alarms", "browsingData"],
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
| `<all_urls>` (host) | Injetar a barra e o pagebridge no domínio que o QA está testando; também satisfaz o requisito de host permission do `captureVisibleTab`, tornando `activeTab` redundante (removida em 2026-08-04) | `background.js` |

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
- Não faz upload de conteúdo de página, cookies ou credenciais reais para servidor algum; o que
  sai para o Supabase é sessão/plano/telemetria de erro sanitizada (ver `docs/security.md`).

## Ao adicionar uma nova permissão

1. Justifique por escrito aqui (motivo + arquivo que usa).
2. Atualize a tabela de `/permissoes` (`TrustCenterPage.tsx`) e a política de privacidade nos 3
   idiomas.
3. Rode `npm run test:chrome` — o smoke verifica que a extensão carrega e a barra injeta
   corretamente; uma permissão nova mal declarada quebra isso antes de chegar à Web Store.
