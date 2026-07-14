# Matriz de paridade funcional

| Recurso original | Implementação atual | Teste/evidência | Status |
| --- | --- | --- | --- |
| Toolbar por ambiente e regras de URL | Shadow DOM, matching seguro e cor configurável | `workspace.test.ts`, `ToolbarApp.test.tsx` | Concluído |
| Gravação e screenshot | MediaRecorder capability-first e captura MV3 | `recording.test.ts`, background message | Concluído |
| Pass, Fail, Block e Limitation | Evidência persistida por URL e data | `evidence.test.ts` | Concluído |
| Textos, shapes e clear individual | Overlay local removível | `ToolbarApp.tsx` | Concluído |
| Contas e métodos sandbox | Schema v2, CRUD e drawers | `WorkspaceManager.tsx` | Concluído |
| Fetch, XHR, Response JSON e histórico | PerformanceObserver + bridge consentida com limites/redaction | suites `networkObservatory` e `payloadBridge` | Concluído |
| Erros HTTP e alertas | Somente sinais reais 4xx/5xx observados | `ToolbarApp.tsx` | Concluído |
| JSON Studio | format, compact, busca, diff, copy e export | `jsonStudio.test.ts` | Concluído |
| Inspectors configuráveis | Matching apenas de endpoints configurados | `payloadBridge.test.ts` | Concluído |
| Page Locator e Click Spy | seletor CSS estável copiado no próximo clique | `ToolbarApp.tsx` | Concluído |
| Freeze Clock | substituição reversível de Date no MAIN world | `background.ts` | Concluído |
| Status Fetch forçado | interceptação explícita, por padrão de URL e reversível | `background.ts` | Concluído com limitação MV3: XHR não é falsificado |
| Importação, exportação e reset | checksum, preview, merge/replace, rollback e escopos | `localWorkspace.test.ts` | Concluído |
| Idiomas e temas | catálogos PT-BR/EN/ES, persistência, política localizada e temas isolados | `i18n.test.ts`, testes SSR e acessibilidade | Concluído |
| Diagnóstico, FAQ e About | offline, pesquisável e com redaction | `HelpCenter.tsx` | Concluído |
| Minimização, restauração e pin/unpin | persistência, reordenação e overflow | `ToolbarApp.tsx` | Concluído |

## Limitações de plataforma

- O controle HTTP atua em chamadas `fetch` feitas após a ativação. Falsificar XHR nativo exigiria uma substituição mais invasiva e poderia quebrar a aplicação testada.
- O Breakpoint Viewer respeita CSP e `X-Frame-Options`; quando um site bloqueia iframe, oferece abertura externa e captura estática.
- MP4 depende dos codecs expostos pelo navegador. Quando indisponível, o produto gera WebM válido e informa o fallback.
