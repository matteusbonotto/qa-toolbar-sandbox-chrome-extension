# Contexto atual da PR 121

Atualizado em 29/07/2026 durante a auditoria final do backlog.

## PR e branch

- PR: https://github.com/matteusbonotto/qa-toolbar-sandbox-chrome-extension/pull/121
- Branch: `agent/workspace-relational-ux`
- Base: `main`
- Versão preparada: `1.4.21`
- A PR continua como rascunho.
- Nenhum merge, deploy, upload na Chrome Web Store ou publicação foi autorizado nesta etapa.
- Checks remotos observados: `verify`, `analyze` e `CodeQL` aprovados.

## Escopo já presente na PR

- Hierarquia real de Cliente, Projeto e Produto com accordions, filtros e drag and drop.
- Ambientes e URLs reunidos no mesmo contexto.
- Agrupamentos relacionais para contas, pagamentos e dispositivos.
- Previews desktop e mobile para posicionamento.
- Menus inferiores abrindo para cima.
- Ícones PNG de Windows, Linux e Android.
- FAQ, tutorial textual, Tour e traduções atualizados.
- Correção do `EBUSY` nos perfis Chrome descartáveis.
- Manifesto atualizado para `1.4.21`.

## Auditoria desta sessão

O checklist geral dizia que 30 PNGs e 30 WebMs tinham sido recapturados, mas a PR não continha
mídia nova. O documento específico do Workspace registrava corretamente que a mídia estava
pendente. A regra válida é: recapturar somente a mídia afetada depois da validação funcional.

O segredo `ACCESS_TOKEN_PRIVATE_KEY_JWK` existe no Supabase produtivo, corresponde à chave pública
embutida na extensão e a função `access-status` foi republicada. O fundador confirmou que o login
foi resolvido. Documentos antigos que ainda tratam esse ponto como não integrado estão
desatualizados.

## Regressão encontrada e corrigida

`npm run test:all:clean` encontrou uma falha real no Pixel Perfect. Depois de restaurar o tema
padrão, o token CSS já era azul, mas o seletor de cor do Pixel Perfect podia ler a família anterior
mantida em memória e abrir com `#e11d48`.

Correção local ainda não commitada:

- `apps/extension/src/toolbar/toolbar.js`
- `effectivePixelPerfectColor()` agora lê primeiro `--qts-ui-primary` realmente aplicado no
  documento e usa o estado armazenado apenas como fallback.

Validação posterior:

- `npm run automation:clean`
- `npm run test:chrome:test-package`
- Aprovado até o final.
- Fingerprint: `1e77834dddb7aacd885b05bc9d64ec8ec3cff38649b757cf0f9dd683b897cc5f`
- Console: zero erros.
- Service worker: zero erros.

## Identidade colorida e versão 1.4.22

- A fonte oficial escolhida pelo fundador é
  `apps/landing/src/assets/logo-colorido.svg`.
- Landing Page e Admin usam a logo colorida em SVG no cabeçalho, login, rodapé e favicon.
- A página sandbox pública também usa o mesmo SVG.
- As cópias públicas do SVG removem apenas uma imagem raster embutida que estava fora do
  `viewBox`. O desenho vetorial visível foi preservado e revisado.
- O manifest e o botão da extensão usam PNGs transparentes de 16, 32, 48 e 128 pixels,
  renderizados diretamente do SVG oficial. Isso atende ao formato de ícones suportado pelo Chrome.
- A verificação do bundle agora falha se o manifest deixar de apontar para os ícones oficiais ou
  se algum PNG tiver formato ou dimensão incorretos.
- O smoke de Landing Page e Admin comprova que o SVG correto é referenciado e carregado.
- A versão da extensão foi atualizada para `1.4.22` e as notas PT-BR, EN e ES foram atualizadas.

### Mídias de tutorial

- As 30 imagens e os 30 vídeos existentes foram auditados. Parte deles contém a identidade antiga
  dentro da página sandbox gravada.
- Duas tentativas de recaptura completa não finalizaram os encoders do Playwright. A tentativa
  seletiva também não conseguiu injetar a toolbar dentro do tempo limite.
- Nenhuma mídia parcial ou antiga foi substituída silenciosamente. Os arquivos oficiais continuam
  preservados até o capturador ser corrigido e a captura poder ser concluída de forma atômica.
- Essa limitação deve permanecer explícita na PR. Não declarar os tutoriais visuais atualizados.

## Correção crítica de foco nas buscas

- Os filtros de Inspectors, Monitor de Erros, contas de teste, pagamentos e recursos reconstruíam
  o próprio campo de busca a cada caractere.
- A restauração anterior dependia do elemento ativo do Shadow DOM e não era confiável durante
  digitação rápida. Agora o valor, foco e cursor são preservados a partir do próprio evento.
- Atualizações de rede de Inspectors e Monitor de Erros ficam em espera enquanto um campo do
  sidebar está em edição. A atualização mais recente é aplicada depois que a pessoa termina.
- Um detalhe aberto de Inspector ou erro não volta sozinho para a listagem quando chegam eventos.
- O smoke Chrome agora digita caractere por caractere na busca global das Configurações, na busca
  compartilhada do sidebar e na busca de Inspectors, inclusive durante uma atualização ao vivo.
- Tutoriais, FAQ e mídia não descrevem o comportamento interno de foco dos filtros e não exigem
  alteração por esta correção.
- `npm run test:all:clean` foi aprovado no estado final da extensão `1.4.22`.
- A busca global, a busca compartilhada e a busca de Inspectors foram validadas com digitação
  caractere por caractere e preservação do cursor.
- O evento de rede recebido durante a digitação ficou em espera e o detalhe aberto permaneceu
  na mesma tela.
- Console da página: zero erros. Service worker: zero erros.
- Fingerprint do pacote validado:
  `df859c6bbae7f955759eee22da87dc7ff7508e465354c300e47bf9e177317125`.

## Versão 1.4.23

- A correção crítica das buscas é uma mudança funcional posterior ao pacote `1.4.22`.
- Por regra de release e exigência da Chrome Web Store, o manifest foi incrementado para `1.4.23`.
- Toda alteração destinada à Chrome Web Store deve incrementar a versão antes de gerar o pacote.
- O pacote de produção desta entrega deve ser gerado somente depois da validação limpa e deve
  declarar `1.4.23` no manifest interno.
- `npm run test:all:clean` foi aprovado novamente com a versão `1.4.23`.
- Fingerprint do pacote de teste:
  `24f5458e90f5fdade1a799601a2bf3813f849af4c5a31cae6939301ea30984a8`.
- Pacote preparado para upload manual:
  `artifacts/chrome-web-store-package-v1.4.23.zip`.

## Versão 1.4.24

- O dispositivo usado passou a ser selecionável no Gravador de Passos, no editor de roteiros, no
  Report Builder e no resumo da sessão de teste.
- Cópias, exportações, rascunhos, relatórios criados a partir da sessão e histórico local preservam
  a referência do dispositivo selecionado.
- Os formulários de criação rápida dos sidebars de contas, pagamentos e recursos foram alinhados
  aos catálogos e relacionamentos dos Settings.
- Imagens de tipos de conta e pagamento passaram a aparecer com 44 px e margem consistente nas
  listas e filtros dos sidebars.
- O botão de maximizar ou abrir em janela passou a ficar imediatamente ao lado do botão de fechar.
- Foi criado um balloon de ajuda reutilizável com símbolo `?`, navegação por teclado e conteúdo em
  PT-BR, EN e ES nos formulários afetados.
- Por regra de release estabelecida pelo fundador, a extensão foi incrementada para `1.4.24`.
- `npm run test:all:clean` foi aprovado com LP/Admin, 9 testes de backend, segurança e smoke
  completo da extensão.
- O smoke terminou com `consoleErrors: 0`, `workerErrors: 0` e fingerprint
  `6363cce1cd50bdd6cab2efa84c8373ceadfa80cbfbddfb8f795f54da3f555fbd`.
- Pacote preparado para upload manual:
  `artifacts/chrome-web-store-package-v1.4.24.zip`.
- SHA-256 do pacote:
  `3d7e0f76893cc828c3ad7d8f6986d6b083363da564ca7f1a26ca4a4e6e8d4f31`.

## Versão 1.4.25

- Os formulários paralelos criados nos sidebars foram removidos. Cada botão Adicionar agora abre
  diretamente o composer original dos Settings na aba correta.
- O deep-link aceita apenas os composers de conta, pagamento e recurso previstos, mantendo os
  mesmos campos, relações N:N, upload, validações e campos personalizados dos Settings.
- Dispositivos passaram a exibir nome, sistemas operacionais e navegadores nos seletores e no texto
  exportado pelo Report Builder e pelo resumo da sessão.
- Imagens de tipos de conta e pagamento são resolvidas pelo ID atual e também pelo nome legado.
  Elas aparecem nos Settings, cards e filtros dos sidebars.
- Imagens de catálogo usam 44 px e margem lateral consistente.
- O balloon de ajuda deixou de usar pseudo-elemento preso ao container rolável. Agora é um popover
  fixo com `z-index: 2147483647`, posicionado dentro da viewport.
- A extensão foi incrementada para `1.4.25` somente depois da revisão dos critérios solicitados.
- `npm run test:all:clean` foi aprovado com LP/Admin, 9 testes de backend, verificações de
  segurança e smoke completo da extensão.
- O smoke validou o composer original dos Settings, dispositivo com sistema/navegador, imagens de
  44 px nos Settings e sidebars e o popover acima da pilha visual.
- Resultado final: `consoleErrors: 0`, `workerErrors: 0` e fingerprint
  `4f4db78682ffe74fd66a97a07f1d7d8d3291f834da3ce5d98dce297edf7cd652`.
- Pacote preparado para upload manual:
  `artifacts/chrome-web-store-package-v1.4.25.zip`.

## Continuação 1.4.26

- O catálogo comum de ferramentas passou a usar nomes de módulos e coleções. Exemplos:
  `Macros`, `Roteiros de teste`, `Sessões de teste`, `Relatórios` e
  `Monitor de endpoint`.
- O submenu de Macros lista todas as macros salvas e identifica as fixadas.
- O Monitor de endpoint persiste até 500 registros locais com data, hora, método, status,
  URL e relação com os Inspectors configurados.
- O histórico pode ser exportado em CSV ou limpo pelo usuário.
- Relatórios mantém a exportação Markdown e adiciona uma composição visual A4, minimalista e
  organizada, pronta para salvar como PDF pela caixa de impressão do Chrome.
- Os novos textos foram adicionados em PT-BR, EN e ES.
- No mobile, Pass e Fail saíram de Tools e passaram a aparecer no mesmo menu compacto de
  marcadores que Warning e Question.
- A extensão foi incrementada para `1.4.26`.
- SHA-256 do pacote:
  `00728d7e93c0749802e016d9ba0a0e8f6123a218d4dee66a7f7e8e6111ecc2ac`.

## Correções visuais e de imagens concluídas em 29/07/2026

- O modal de URL preserva os nomes completos de ambientes e produtos. Um seletor CSS amplo estava
  reduzindo todo `span` interno para 8 px, por isso apareciam apenas fragmentos de letras.
- A árvore de Ambientes e URLs voltou a exibir imagem cadastrada ou avatar de iniciais para cliente,
  projeto e produto.
- Os accordions relacionais de contas, pagamentos e dispositivos não herdam mais o limite de altura
  da lista genérica. O corpo expandido cresce e passa a usar rolagem interna somente acima de 420 px.
- As prévias mobile de sidebar e toolbar possuem coordenadas próprias para topo, base, esquerda e
  direita. Nenhuma barra usa mais as dimensões do mockup desktop.
- O agrupamento de contas por tipo reutiliza a imagem cadastrada no catálogo de tipos.
- O renderizador compartilhado de avatar reconhece `logoUrl`, `icon`, `imageUrl` e
  `accountTypeImage`. Imagem remota e upload em data URL seguem o mesmo caminho.
- O smoke exporta e normaliza novamente imagens de cliente, projeto, produto, tipo de conta, tipo de
  pagamento, sistema, navegador, pagamento e recurso. Isso prova a preservação no JSON e no caminho
  real usado pela importação.
- `npm run test:chrome:test-package` foi aprovado com console e service worker sem erros.
- O script principal da toolbar agora possui inicialização idempotente e escopo isolado. Reinjeções na
  mesma página não redeclaram variáveis nem registram listeners duplicados.
- Esperas do smoke para badge, macro fixada e logout observam o estado real em vez de atrasos fixos.
- `npm run test:all:clean` foi aprovado no estado final.
- Fingerprint do pacote Chrome desta rodada: `f8d3c313b0de67ba0ff31cc3f6c5fc5921a57ad51d6acde8e125c6e545b96fde`.
- Mídias de tutorial não foram regravadas nesta rodada, conforme a orientação de estabilizar primeiro
  todas as correções visuais e evitar retrabalho.

## Deduplicação visual solicitada em 29/07/2026

- Tags de Cliente, Projeto, Produto e agrupamentos relacionais foram alinhadas ao topo.
- Ambientes e URLs não repete mais Ambiente, QA ou Produto dentro da linha já agrupada pelos
  respectivos accordions.
- Contas e pagamentos omitem o badge da dimensão que já está representada pelo accordion pai.
- Sem ambiente é exibido uma única vez.
- Os dois contadores sem rótulo do cabeçalho de Ambientes e URLs foram removidos.
- O botão genérico Adicionar URL foi removido. A criação acontece em Adicionar URL neste ambiente.
- Tour, capturador seletivo e smoke foram atualizados para a ação contextual.
- O fingerprint do smoke agora cobre todo o pacote carregado, inclusive Options, imagens e estilos.
- Smoke Chrome aprovado com fingerprint completo
  `8693fb2856c5c63d38fd7e6662a082cdd045473ba94560e6e97acee82da956f1`.
- Console: zero erros. Service worker: zero erros.

## Catálogo de ferramentas e Breakpoint em 29/07/2026

- Settings e menu Tools agora renderizam nomes pelo mesmo `FEATURE_REGISTRY`.
- O smoke compara todos os nomes item a item e falha diante de qualquer divergência.
- Testar tamanhos de tela mantém o zoom superior apenas para dimensionar os frames.
- Cada frame desktop, tablet ou mobile possui Zoom do site independente entre 50% e 200%.
- O zoom interno altera o documento do iframe sem modificar as dimensões do dispositivo.
- Páginas de outra origem continuam protegidas pela política do navegador e recebem uma mensagem
  clara quando o zoom interno não pode ser aplicado.
- Tutorial, FAQ gerada pelo tutorial e Tour contextual foram atualizados.
- Smoke Chrome aprovado com fingerprint completo
  `b43fbff17b055a69d2c2e889a8bf35497c039dbe7464605be3814f6ef7e11fcb`.
- Console: zero erros. Service worker: zero erros.

## Evidência mobile adicionada

Alteração local ainda não commitada em `scripts/smoke-extension.mjs`:

- viewport do Workspace alterado temporariamente para 390 por 844;
- validação de overflow horizontal;
- validação de que os três níveis da hierarquia continuam presentes;
- screenshot `extension-options-workspace-studio-mobile.png`;
- viewport desktop restaurado antes de continuar o smoke.

Essa nova asserção ainda precisa passar dentro de `npm run test:all:clean`.

## Estratégia de mídia decidida pelo fundador

Não recapturar os 30 tutoriais quando somente o Workspace mudou. A estratégia correta é captura
seletiva:

```powershell
npm run automation:clean
$env:QTS_TUTORIAL_CAPTURE_ONLY='workspace'
npm run tutorial:capture
```

Somente `workspace-setup.png` e `workspace-setup.webm` devem ser substituídos.

O texto da FAQ não exige vídeo próprio. A única entrada de tutorial alterada no diff é
`workspace-setup`.

## Correções no capturador seletivo

Arquivo local ainda não commitado: `scripts/capture-tutorial-media.mjs`.

- O walkthrough não procura mais botões antigos com
  `data-open-composer="projectComposer"` e `data-open-composer="productComposer"`.
- Usa `data-tree-create="project"` e `data-tree-create="product"`, que são os controles reais da
  hierarquia.
- O setup invisível ao usuário deixou de preencher vários modais animados.
- Os dados de demonstração agora são criados por `window.QTS_STORAGE`, a API oficial de
  armazenamento da extensão.
- O walkthrough visível continua abrindo os CRUDs reais.
- A sincronização depois do seed usa o DOM protegido em vez de aguardar o evento de load da página,
  que não encerrava de modo confiável no Chrome com gravação ativa.

## Resultado final da captura

- Captura seletiva concluída com sucesso.
- `workspace-setup.png` atualizado e revisado visualmente.
- `workspace-setup.webm` atualizado e comprimido de aproximadamente 8,4 MB para 2,5 MB.
- A inspeção da primeira imagem encontrou os botões de criação abaixo dos ramos, em desacordo com
  a regra do fundador.
- A hierarquia foi corrigida. Adicionar cliente fica no cabeçalho da seção. Adicionar projeto e
  Adicionar produto ficam no cabeçalho do respectivo card pai.
- A mídia do Workspace foi recapturada depois dessa correção.
- Um processo filho da captura completa interrompida alterou mídias não relacionadas em segundo
  plano. Todas foram restauradas a partir de `HEAD`. Somente o par `workspace-setup` permanece
  modificado, conforme a estratégia seletiva.

## Próximos passos obrigatórios

1. Corrigir o corpo da PR, que ainda informa versão `1.4.20` e mídia adiada.
2. Commitar, enviar a branch e atualizar a PR com resultados e fingerprint final.
3. Manter publicação e deploy bloqueados até autorização explícita.

## Validação final

`npm run test:all:clean` foi executado novamente sobre o estado exato depois da restauração
seletiva e terminou com sucesso.

- Landing e Admin: typecheck, testes, build e smoke aprovados.
- Backend: 9 testes Deno aprovados e Edge Functions verificadas.
- Segurança do repositório e do bundle aprovada.
- Bundle: versão `1.4.21`, 105 arquivos, aproximadamente 16,5 MB de fonte.
- Smoke Chrome completo aprovado.
- Fingerprint: `1e77834dddb7aacd885b05bc9d64ec8ec3cff38649b757cf0f9dd683b897cc5f`.
- Console: zero erros.
- Service worker: zero erros.

## Pendências externas que não podem ser declaradas concluídas por teste local

- Fluxo real de recuperação de senha por e-mail.
- Teste visual com uma conta real de plano inferior.
- Estado final de revisão e publicação na Chrome Web Store.
- Merge, publicação da LP e qualquer nova alteração produtiva.

## Ajustes finais solicitados em 29/07/2026

- Em Ambientes e URLs, o cabeçalho do accordion não repete mais a tag Ambiente nem o nome do
  ambiente abaixo da prévia. A prévia colorida da toolbar é a identificação única.
- URLs sem ambiente continuam exibindo Sem ambiente, pois esse texto representa um estado real.
- Barra e aparência agora oferece onze famílias de cor. Preto e Cinza foram adicionados com
  variantes claras e escuras, sem gradientes.
- Textos PT-BR, EN e ES, checklist e teste Chrome foram atualizados.
- `npm run test:chrome:test-package` foi aprovado.
- `npm run test:all:clean` também foi aprovado no estado final exato.
- Landing Page e Admin: typecheck, testes, build e smoke aprovados.
- Backend: 9 testes aprovados. Segurança do repositório e do bundle aprovada.
- Fingerprint desta validação: `2625fdd307e2f188b97b92c1039b5d63a300000a3fa44d58faea580fd042927a`.
- Console: zero erros.
- Service worker: zero erros.
