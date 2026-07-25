# Checklist de implementação do prompt-mestre

Atualizado em 2026-07-25. Este arquivo registra evidência do repositório; `[x]` significa que o
comportamento foi encontrado e coberto por teste, não apenas que existe código relacionado.

## Estado geral

- [x] Auditoria inicial de branch, histórico recente e worktree
- [x] Regressão crítica de autenticação por deep link corrigida
- [ ] Auditoria item a item concluída
- [ ] Bugs críticos restantes concluídos
- [ ] Feature registry/flags canônico
- [ ] Ativação/desativação transversal
- [ ] Toolbar e mobile
- [ ] Sidebars e componentes
- [x] Captura/Spy — implementação e smoke existentes; falta conferir todos os critérios visuais
- [x] Steps/Macros/GIF — implementação e smoke existentes; falta auditoria mobile
- [x] Pixel Perfect — modos principais e context menu cobertos no Chrome
- [ ] Inspectores/JSON/Data
- [x] Marcadores Pass/Fail/Warning/Question e overlays principais
- [ ] Temas e atalhos — 24 temas concluídos; atalhos customizáveis pendentes
- [ ] LP/Admin
- [ ] Tutoriais
- [ ] Testes finais
- [ ] PR
- [ ] Deploy — bloqueado até autorização explícita

## Auditoria confirmada

| Área | Estado | Evidência/observação |
|---|---|---|
| Login da extensão | Corrigido localmente | O background comparava `sender.url` por igualdade e descartava mensagens vindas de `options.html?tab=account` ou com hash. O smoke agora autentica a partir de um deep link. |
| Erro de conexão do runtime | Corrigido localmente | `runtimeMessage` agora consome `chrome.runtime.lastError` e retorna mensagem acionável, evitando `Unchecked runtime.lastError`. |
| CORS do backend | Parcial/operacional | O backend aceita somente IDs presentes em `ALLOWED_EXTENSION_IDS`. Extensão de produção carregada diretamente de pasta recebe ID aleatório e não deve acessar produção; usar Web Store ou pacote sideload com ID fixo. O pacote `[TESTE]` usa backend local/isolado. |
| `legal-registration` 403 | Diagnosticado | É uma consulta paralela e tolerante a falha. O 403 indica ID/origem não autorizado e não é a autenticação em si. Não houve alteração em segredo ou função de produção. |
| Workspace demonstrativo | Implementado, reauditar importação | Normalização, entidades protegidas e smoke de CRUD/tour existem. |
| Site demonstrativo próprio | Implementado | Smoke usa servidor próprio e seletores estáveis. |
| Capturar Elementos | Implementado | Registrado em storage, menu Tools, tutorial, i18n e smoke com CSV seguro. |
| Warning/Question | Implementado | PR #91 e smoke real confirmam marcadores distintos. |
| Temas | Implementado | 24 presets, persistência, claro/escuro e contraste cobertos no smoke. |
| Key View repetição/pressionado | Implementado | Eventos reais e contador cobertos no smoke. |
| Pixel Perfect | Implementado | Linhas, régua, bounds, scroll de ancestrais e context menu cobertos. |

## Pendências prioritárias confirmadas

1. Fonte canônica única de features; hoje a lista está duplicada entre `storage.js`,
   `storage-content.js`, `toolbar.js`, opções, tutoriais, planos e backend.
2. Comando global para desativar ferramentas e resolução explícita de modos incompatíveis.
3. Limite/rolagem/reposicionamento do menu Tools em viewport baixa e zoom elevado.
4. Popup para salvar a URL da aba atual no ambiente.
5. Menu hamburger compartilhado para elementos flutuantes e limpeza centralizada.
6. Bottom sheets mobile e redimensionamento/posição persistente de drawers.
7. Atalhos customizáveis com conflitos e reset.
8. Gerador de QR Code.
9. Validador de textos por arquivo de idioma.
10. Auditoria completa de JSON/Data/inspectores.
11. Roleta sob demanda dentro da experiência prevista.
12. Focus trap do login, 404 e demais critérios da LP/Admin.

## Evidência desta rodada

- `node --check` nos três arquivos JS alterados: aprovado.
- `npm run test:chrome`: aprovado com autenticação via
  `options.html?tab=account#login`, `consoleErrors: 0` e `workerErrors: 0`.
- Nenhum deploy, publicação, alteração de Stripe ou Supabase produtivo foi executado.

## Auditoria de automação em 2026-07-25

- Foi encontrado um falso positivo: o smoke confirmava que o login abria o site demonstrativo,
  mas fechava a aba sem conferir a presença da toolbar. Agora `#qts-toolbar-host` é obrigatório e
  a falha inclui registros dinâmicos, bindings, scope e acesso.
- A suíte agora começa removendo perfis Chrome, extensão `[TESTE]` gerada, evidências e builds web.
  O smoke imprime o caminho e a fingerprint SHA-256 do código realmente carregado.
- O pacote `[TESTE]` com o mesmo ID fixo visto no ambiente manual
  (`dppfhjpccijidcpbmmcdlbhoknkdjoll`) foi reconstruído e passou o smoke, incluindo toolbar no
  GitHub Pages e zero erros de console/worker.
- A limpeza detectou `artifacts/chrome-test-profile/first_party_sets.db` bloqueado por uma instância
  Chrome manual ainda aberta. Esse é o mecanismo concreto que permitia reutilização do perfil
  anterior. `test:all:clean` e `dev:extension:test` agora encadeiam a limpeza com `&&` e falham antes
  de testar se o perfil não puder ser removido.
- `smoke:lp-admin` reconstrói LP/Admin e valida preços, simulador, modal de conta e artefato Admin.
- Defeito de cobertura: Landing e Admin executam Vitest com `passWithNoTests`; não existem testes
  unitários encontrados nessas workspaces.
- Defeito de cobertura: o smoke visual do Admin valida somente o gate/login inicial. O fluxo live
  completo existe em `smoke-live-admin.mjs`, mas exige backend isolado e credenciais de serviço e
  não deve usar produção para fabricar aprovação.
- Defeito técnico: os bundles de LP (~592 kB) e Admin (~502 kB) ultrapassam o limite de aviso de
  500 kB do Vite; avaliar code splitting sem esconder o alerta.
- Regra permanente adicionada em `AGENTS.md`: afirmações do usuário/fundador têm precedência como
  regras de negócio; PRs devem atualizar testes, tutorial, tour, FAQ, i18n, prints, vídeos, versão,
  release notes e superfícies afetadas.
- Correção visual pendente de smoke após fechar o Chrome manual: o indicador de scroll do Mouse
  View usava `--qts-ui-secondary` e permanecia amarelo. Foi migrado para `--qts-ui-primary`; o
  smoke agora aplica o preset azul, dispara `wheel` e exige o fill azul no SVG. A limpeza recusou
  continuar porque `chrome-test-profile/first_party_sets.db-journal` estava bloqueado, comprovando
  que a proteção contra perfil/cache antigo está ativa.
