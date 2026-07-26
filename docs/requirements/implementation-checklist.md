# Checklist de implementação do prompt-mestre

Atualizado em 2026-07-25. Este arquivo registra evidência do repositório; `[x]` significa que o
comportamento foi encontrado e coberto por teste, não apenas que existe código relacionado.

## Estado geral

- [x] Auditoria inicial de branch, histórico recente e worktree
- [x] Regressão crítica de autenticação por deep link corrigida
- [x] Auditoria item a item concluída
- [x] Bugs críticos técnicos concluídos
- [x] Feature registry/flags canônico, com teste de paridade entre os dois formatos de carregamento
- [x] Ativação/desativação transversal, incluindo comando global e estados incompatíveis
- [x] Toolbar com posições cima/baixo/esquerda/direita e regressões vertical/horizontal cobertas
- [x] Sidebars e componentes compartilhados
- [x] Captura/Spy — implementação e smoke existentes; falta conferir todos os critérios visuais
- [x] Steps/Macros/GIF — implementação e smoke existentes; falta auditoria mobile
- [x] Pixel Perfect — modos principais e context menu cobertos no Chrome
- [x] Inspectores/JSON/Data — abertura, drawers e mídia atualizada
- [x] Marcadores Pass/Fail/Warning/Question e overlays principais
- [x] Temas e atalhos — 24 temas e atalhos customizáveis com conflito/reset
- [x] LP/Admin — focus trap, restauração de foco, 404 consciente, chunks e smoke
- [x] Tutoriais — 30 pares PNG/WebM recapturados no Sandbox local atual
- [x] Testes finais da extensão

PR, merge, publicação e deploy são gates externos de release, não pendências técnicas deste
checklist. Eles só podem ocorrer após autorização explícita e uso das credenciais do responsável.

## Auditoria confirmada

| Área | Estado | Evidência/observação |
|---|---|---|
| Login da extensão | Corrigido localmente | O background comparava `sender.url` por igualdade e descartava mensagens vindas de `options.html?tab=account` ou com hash. O smoke agora autentica a partir de um deep link. |
| Primeiro acesso deslogado | Corrigido localmente; smoke bloqueado por perfil aberto | A instalação agora cria o workspace demo protegido e registra o content script antes de abrir o site inicial. A toolbar reduzida mostra “Entrar”, oculta Tools e abre explicitamente `Minha conta`. |
| Tour sem autenticação | Corrigido localmente; smoke bloqueado por perfil aberto | `qtsTutorial=1` não inicia overlay quando `state.authorized` é falso; remove os parâmetros e abre `Configurações > Minha conta`. |
| Tema padrão | Corrigido localmente; testes de normalização aprovados | Workspace novo e ação “Restaurar padrão” usam `blue-light` (`#2563eb`) com aparência clara. Escolhas explícitas existentes são preservadas. |
| Marcadores menores | Corrigido e coberto | Pass/Fail/Warning/Question usam 24×24 px por padrão, controles refluem em tamanho reduzido e Warning/Question têm nomes/ícones inequívocos. |
| Controles compartilhados de sidebar | Concluído e coberto | Sidebars recebem busca, posição persistida, fixar, minimizar, fechar, resize e janela destacada. O atalho minimizado sobrevive a renders/storage updates. |
| Regressões do header/sidebar | Corrigido localmente | Modais não recebem mais seletor/pin/minimizar/busca de sidebar; fechar usa vermelho semântico; ícones são centralizados; minimizar remove o drawer e cria atalho destacado na toolbar; checkboxes de drawers usam toggle visual. |
| Breakpoint Viewer | Concluído | Topbar própria ganhou “Gravar tela cheia” e fechar vermelho. A lógica MediaRecorder é coberta deterministicamente; o seletor nativo de tela permanece uma permissão do Chrome e não é falsamente autoaprovado pelo teste. |
| Configuração de posição | Concluído | Sidebar: esquerda/direita/cima/baixo. Toolbar: horizontal em cima/baixo e vertical à esquerda/direita. |
| Abrir em nova janela | Concluído e coberto | Background cria popup real, o content script recebe gatilho determinístico após carregar, oculta a página/barra e mostra somente a ferramenta solicitada. Há fallback para nova aba. |
| Todos os sites | Concluído | Scope `all` registra `<all_urls>` e cria contexto visual “Todos os sites” quando não existe binding. |
| Mídia de tutorial/tour | Concluído | Captura local sem cache, `blue-light`, 3s por ação, staging obrigatório e publicação somente quando os 30 pares PNG/WebM existem. |
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

## Fechamento das prioridades confirmadas

1. Registry de features centralizado no runtime e protegido por teste de paridade.
2. Comando global desativa todos os modos ativos.
3. Menu Tools limitado a oito linhas, com scroll e reposicionamento.
4. Popup salva a URL da aba ativa no vínculo oficial do Workspace.
5. Elementos flutuantes usam controles compartilhados e limpeza centralizada.
6. Mobile possui posições independentes e bottom sheet padrão.
7. Atalhos customizáveis recusam conflitos/reservados e oferecem reset.
8. QR Code é gerado localmente, sem serviço externo e sem query/hash por padrão.
9. Validador compara arquivo JSON de idioma com o texto visível.
10. JSON/Data/Inspectors possuem busca, colapso, cards, localizar, copiar e mascaramento.
11. Roleta fica ausente até “Tentar a sorte” abrir o modal; prêmios e resultado são explícitos.
12. LP/Admin possuem focus trap, restauração de foco, 404 e chunks menores que 500 kB.

## Evidência desta rodada

- `node --check` nos três arquivos JS alterados: aprovado.
- `npm run test:chrome`: aprovado com autenticação via
  `options.html?tab=account#login`, `consoleErrors: 0` e `workerErrors: 0`.
- Nenhum deploy, publicação, alteração de Stripe ou Supabase produtivo foi executado.

## Fechamento visual e tutorial — 2026-07-25

- Smoke Chrome integral aprovado após limpeza, com fingerprint
  `afc97bf2fda529867a2aaa46ef598e8d167d50f2f8eceb0b2dd1fc9457d48a63`.
- Janela destacada validada abrindo `Input Lab` em popup isolado; toolbar/página-base ficam ocultas.
- Key View validado por geometria: toggle e texto não se sobrepõem nem ficam comprimidos.
- Smoke confirmou todas as ferramentas, Steps, Macro, CRUD, tutorial/tour, FAQ, SPA, temas,
  `consoleErrors: 0` e `workerErrors: 0`.
- Os 30 screenshots e 30 vídeos foram recapturados em 1440×960 usando o Sandbox local atual,
  perfil descartável, `no-store`, tema `blue-light` e pausa de 3 segundos em cada ação.
- A captura publica por staging: qualquer falha preserva integralmente o lote oficial anterior.
- Versão da extensão atualizada para `1.4.6`.
- Landing ganhou testes Vitest das invariantes dos planos; Admin ganhou testes de mensagens de
  erro/Supabase e hash seguro de vouchers. A suíte não depende mais de `passWithNoTests`.

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
- Defeito de cobertura resolvido nesta rodada: Landing e Admin agora possuem testes Vitest reais;
  o smoke de LP/Admin continua obrigatório para comportamento renderizado.
- Defeito de cobertura: o smoke visual do Admin valida somente o gate/login inicial. O fluxo live
  completo existe em `smoke-live-admin.mjs`, mas exige backend isolado e credenciais de serviço e
  não deve usar produção para fabricar aprovação.
- Defeito técnico: os bundles de LP (~592 kB) e Admin (~502 kB) ultrapassam o limite de aviso de
  500 kB do Vite; avaliar code splitting sem esconder o alerta.
- Regra permanente adicionada em `AGENTS.md`: afirmações do usuário/fundador têm precedência como
  regras de negócio; PRs devem atualizar testes, tutorial, tour, FAQ, i18n, prints, vídeos, versão,
  release notes e superfícies afetadas.
- Correção visual concluída: o indicador de scroll do Mouse View foi migrado de
  `--qts-ui-secondary` para `--qts-ui-primary`; o smoke aplica o preset azul, dispara `wheel` e
  exige o fill azul no SVG. A proteção contra perfil/cache antigo também recusou corretamente uma
  execução concorrente enquanto o perfil Chrome estava bloqueado.

## Correção global de texto em 2026-07-25

- Corrigida a cascata CSS que aplicava o padding genérico de formulário ao seletor compacto de
  posição do cabeçalho, cortando verticalmente textos como `Direita`.
- Inputs, selects e textareas de todas as sidebars/modais compartilhadas agora usam
  `box-sizing: border-box`, altura mínima e `line-height` consistentes.
- Títulos, descrições, labels, botões e opções agora quebram palavras longas sem invadir ou serem
  escondidos por outros controles.
- Em sidebars estreitas, o título ocupa uma linha própria e os controles permanecem agrupados e
  visíveis na linha seguinte.
- Adicionado teste geométrico que compara a altura útil do seletor com a altura necessária para
  renderizar o texto e falha se padding, borda ou altura voltarem a cortá-lo.
- Smoke do pacote `[TESTE]` executado após limpeza de cache/perfis: todas as ferramentas,
  sidebars, modais, janela destacada, temas, tutoriais e tours passaram com
  `consoleErrors: 0` e `workerErrors: 0`.
- Evidência visual `extension-toolbar-drawer-theme-light.png` revisada: cabeçalho, seletor
  `Direita`, busca, descrição e botão aparecem integralmente.
- Versão da extensão atualizada para `1.4.7`.

## Pontas de linha por ícones em 2026-07-25

- As opções de ponta esquerda e direita deixaram de exibir texto dentro dos botões.
- Cada lado apresenta cinco ícones distintos: nenhuma ponta, seta, triângulo, círculo preenchido
  e círculo vazado; os desenhos respeitam visualmente o lado configurado.
- Tooltips e `aria-label` preservam os nomes traduzidos para mouse, teclado e leitores de tela.
- O smoke exige dois grupos, cinco botões e cinco SVGs distintos por grupo, nenhum texto visível
  dentro dos botões e cinco nomes acessíveis únicos.
- A ponta padrão continua sendo seta à direita e nenhuma à esquerda.
- Versão da extensão atualizada para `1.4.8`.

## Responsividade da janela separada em 2026-07-25

- Sidebars e modais destacados agora ocupam exatamente a viewport disponível, sem herdar padding,
  largura ou altura do modal centralizado e sem overflow horizontal.
- Cabeçalho e corpo usam dimensões flexíveis; o corpo mantém rolagem interna e cartões, grids,
  relatórios, ações e etapas reorganizam suas colunas em janelas estreitas.
- O botão vermelho exibe `Fechar janela` no modo destacado e solicita ao service worker o
  fechamento da janela popup real.
- Se o navegador tiver usado uma aba normal como fallback, somente essa aba é fechada; a janela
  normal do usuário nunca é removida inteira.
- O smoke redimensiona uma sidebar e um modal destacados para 360×540 e exige ocupação integral
  da viewport e ausência de overflow horizontal em ambos.
- O smoke clica no botão vermelho e exige o evento real de fechamento nas duas variantes.
- Versão da extensão atualizada para `1.4.9`.

## Tour no menu compacto em 2026-07-25

- Etapas que apontam para itens fora das oito opções visíveis agora abrem o menu, centralizam o
  botão real dentro da área rolável e somente depois calculam spotlight e balão.
- O cálculo usa o `offsetTop` atual do item, portanto continua correto depois de buscas,
  ordenações ou mudanças futuras na ordem das ferramentas.
- O reposicionamento aguarda dois frames de layout antes de medir a geometria final.
- O smoke inicia diretamente em `Meios de pagamento`, exige `scrollTop > 0`, confirma que o botão
  está integralmente dentro do menu e que o spotlight contém exatamente o alvo visível.
- O mesmo teste abre a ferramenta real e confirma a transição para a ajuda contextual sem manter
  o escurecimento sobre o drawer.
- Versão da extensão atualizada para `1.4.10`.

## Switch, popup da URL ativa e revalidação em 2026-07-25

- Corrigida a causa estrutural do switch circular: a altura de `22px` era anulada pelo
  `min-height: 40px` global. O trilho agora mede `38×22` e o knob `16×16`.
- Modo Typing e Visualizar mouse persistem imediatamente no clique.
- O ícone da extensão abre um popup que captura a aba ativa e permite selecionar Cliente,
  Projeto, Produto e Ambiente, escopo da URL, nome e modo de exibição.
- Query e hash são removidos por padrão; páginas internas são recusadas e conflitos são explícitos.
- O cadastro usa `urlBindings`, a coleção oficial, e recarrega a aba para reconhecimento imediato.
- Smoke do pacote `[TESTE]` aprovado após limpeza: popup, clique e marcadores Warning/Question,
  Mouse/Key View, SPA, tour rolável, `consoleErrors: 0` e `workerErrors: 0`.
- Versão da extensão atualizada para `1.4.11`.

## Fechamento integral em 2026-07-26

- Registry canônico protegido contra divergência e comando global de desativação cobertos.
- Posições mobile independentes, bottom sheet e atalhos personalizados concluídos.
- Validador de textos e QR Code offline adicionados ao produto, tour e tutorial.
- Macro Studio lista os elementos interativos visíveis no modo manual.
- Roleta removida do estado inicial e exibida somente após “Tentar a sorte”.
- Landing/Admin receberam 404, focus trap e code splitting; React Router vulnerável foi removido
  do Admin, e `npm audit --omit=dev` passou com zero vulnerabilidades.
- Os 30 pares PNG/WebM foram recapturados com tema `blue-light`, cache limpo e pausa de 3 segundos.
- Após a recaptura final, `npm run test:all:clean` passou novamente em 280,1 s; fingerprint:
  `5583b16720d4917562367ceff3930764685c40099df1e483711f9ef47ce194ca`.
- Resultado final: `consoleErrors: 0`, `workerErrors: 0`, `npm audit --omit=dev`: 0 vulnerabilidades.
- Versão da extensão atualizada para `1.4.12`.
