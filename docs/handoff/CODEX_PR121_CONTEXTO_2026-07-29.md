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
