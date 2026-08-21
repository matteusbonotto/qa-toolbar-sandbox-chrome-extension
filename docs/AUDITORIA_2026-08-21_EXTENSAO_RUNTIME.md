# Auditoria — runtime, lifecycle e segurança da extensão (2026-08-21)

> Auditoria read-only (nenhum arquivo foi alterado). Escopo: `apps/extension/src/background/`,
> `toolbar/`, `pagebridge/`, `popup/`, `options/`, `lib/`, `manifest.json`. Objetivo: verificar as
> claims de `docs/permissions.md`/`docs/security.md` contra o código real e caçar listeners órfãos,
> timeouts mágicos e suposições inválidas sobre o lifecycle do service worker/Manifest V3.

## Achado médio: memory leak real em itens flutuantes (marcadores/notas/formas/linhas)

**Arquivo**: `apps/extension/src/toolbar/toolbar.js:3239-3327` (funções `makeDraggable`/
`makeResizable`/`makeLineResizable`), acionadas a partir de `placeMarker`/`placeNote`/`placeShape`/
`placeLine` (linhas 2823, 2870-2871, 2945, 3015-3019, 3166-3167).

Cada item flutuante criado registra listeners **no `document`**, não no próprio elemento:

```js
document.addEventListener("mousemove", (event) => { ... });
document.addEventListener("mouseup", () => { dragging = false; });
```

O botão de remover (linha 2827, `marker.querySelector(".qts-remove-btn")...remove()`) e
`clearAllFloatingItems()` (linhas 3329-3332) removem só o nó do DOM — os listeners globais
continuam vivos indefinidamente, presos em closures que ainda referenciam o elemento removido
(impedindo GC) e executando a cada `mousemove` da página inteira pelo resto da sessão.

**Impacto**: numa sessão de QA típica (várias marcações/notas/formas/linhas criadas e apagadas ao
longo do teste), listeners "mortos" se acumulam — degradação de performance progressiva, não um
crash imediato. É exatamente o padrão que `docs/testing-strategy.md`/`AGENTS.md` pedem para
verificar ("abrir → fechar → navegar → voltar → repetir 50 vezes").

**Causa raiz**: as três funções (`makeDraggable`, `makeResizable`, `makeLineResizable`) não guardam
a referência do handler nem expõem uma forma de `removeEventListener` correspondente na hora de
remover o item. É um padrão repetido nas três funções, não um caso isolado — a correção precisa
tratar as três, não só uma.

## Achado baixo: timeout mágico sem justificativa

**Arquivo**: `apps/extension/src/toolbar/toolbar.js:1417`

```js
window.history.replaceState({}, "", url.toString());
window.setTimeout(() => openDetachedTool(toolKey), 150);
```

Chamado de dentro de `maybeOpenDetachedTool()` (linha 1382), **depois** de `render()` (linha 1378)
já ter populado `state.shadowRoot` de forma síncrona — ou seja, no momento do delay o shadow DOM já
deveria existir. Sem comentário explicando por que 150ms é necessário (transição de CSS? webfont?
algo assíncrono dentro de `render()`?). Viola a regra do projeto de não aceitar timeout mágico sem
explicar a causa. Risco: se `render()` passar a depender de algo assíncrono no futuro, ou em página
lenta, a chamada pode disparar cedo/tarde demais sem sinalização real de "pronto".

## Não é um achado (mencionado por completude)

O retry com backoff `[80, 240, 600, 1200]` para reanexar o contexto do tour
(`toolbar.js:1716`) **tem** comentário explicando o motivo — não viola a regra literalmente, mas
estruturalmente ainda mascara a ausência de um evento real de "superfície disponível". Registrado
como nota, não como bug.

## Confirmado: sem recorrência do bug histórico de observer auto-reentrante

Já houve um bug real de loop infinito (o monitor de headers fixed/sticky observava as mesmas
mutações de estilo que ele próprio aplicava) — corrigido antes, documentado em
`docs/CHECKLIST_BUGFIX_PASS2.md`. Confirmado nesta auditoria que a correção continua correta
(`toolbar.js:339-379`, `offsetSiteFixedHeaders`, desconecta o `MutationObserver` antes de mutar
`style`/`class` e reconecta depois) e que o padrão não se repete no único outro `MutationObserver`
do arquivo (`installIntegrityMonitor`, linhas 1994-2006).

## Confirmado: escopo de host e autorização de mensagens batem com a documentação

`apps/extension/src/background/background.js:21-43` implementa exatamente o descrito em
`docs/permissions.md`:

```js
async function patternsForAuthorizedWorkspace() {
  const scope = await getSiteScope();
  if (scope.mode === "all") return ["<all_urls>"];
  if (scope.mode === "custom") return (scope.patterns || []).filter(isChromeMatchPattern);
  const workspace = await getWorkspace();
  return [...new Set((workspace.urlBindings || [])
    .filter((binding) => binding.active !== false)
    .flatMap((binding) => binding.patterns || [])
    .filter(isChromeMatchPattern))];
}

async function isAuthorizedContentSender(sender) {
  if (!sender?.tab?.id || !sender.tab.url) return false;
  const [registrationPatterns, workspace, scope] = await Promise.all([...]);
  const matches = (patterns) => patterns.some((pattern) => {
    try { return patternToRegExp(pattern).test(sender.tab.url); } catch { return false; }
  });
  const bindingPatterns = (workspace.urlBindings || []).filter(...).flatMap(...).filter(isChromeMatchPattern);
  return matches(registrationPatterns) && (scope.mode === "all" || matches(bindingPatterns));
}
```

Usadas nos 4 handlers de mensagem sensíveis: `qts:capture-visible-tab`, `qts:clear-site-data`,
`qts:close-detached-window`, `qts:open-tool-window` (linhas 416/425/449/467).

## Confirmado: sem estado de negócio fora de `chrome.storage`

Só dois casos de estado mutável em nível de módulo no service worker, ambos inofensivos:

- `background.js:115` — `let registrationQueue = Promise.resolve();` (serializa registros no ciclo
  de vida atual; reset correto num restart).
- `auth.js:51` — `let cachedAccessTokenPublicKey = null;` (cache derivado de constante pública
  embutida no código; perder o cache só recalcula, sem perda de dado).

Nenhum estado real de sessão/token/workspace vive fora de `chrome.storage.local`/`.session`.

## Confirmado: sem duplicação de listener por reinjeção

`toolbar.js:2` (`if (window.__QTS_TOOLBAR_SCRIPT_ACTIVE__) return;`) e `pagebridge.js:9`
(`if (window.__qtsPageBridgeInstalled) return;`) têm guarda de execução única por documento — os
listeners de módulo não duplicam em SPA/navegação. `injectIntoOpenTabs` também checa
`qts:sync-toolbar`/`existing.present` antes de reexecutar `executeScript`. O único vazamento real de
listener encontrado é o dos itens flutuantes (achado acima), que é por-item-criado, não
por-reinjeção de script.

## Permissões do manifest

**Confere exatamente com `docs/permissions.md`.** `apps/extension/manifest.json:26-36`:
`permissions: ["storage","scripting","tabs","contextMenus","alarms","browsingData"]`,
`host_permissions: ["<all_urls>"]`, sem `activeTab`.

## Paridade ESM/clássico do `FEATURE_REGISTRY`

**OK, mas com uma doc desatualizada.** `storage.js:34-62` e `storage-content.js:10-30` têm as
mesmas 27 entradas, mesma ordem, mesmos campos (`key,label,menuItemId,icon,planFeature`).
`schemaVersion` é **18** nos dois arquivos (`storage.js:354`, `storage-content.js:209`) — bate entre
si, mas diverge do "17" citado em `docs/architecture.md`/`docs/ecosystem-audit.md`. Não é um bug
funcional, é doc desatualizada — atualizar na próxima passada de documentação.

## Verificação de sintaxe

`node --check` passou sem erro em `background.js`, `auth.js`, `toolbar.js`, `pagebridge.js`,
`storage.js`, `storage-content.js`.
