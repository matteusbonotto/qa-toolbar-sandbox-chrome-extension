# QA Toolbar Sandbox — extensão MV3

Extensão Chrome local-first em HTML/CSS/JS, sem build e sem segredo no pacote.

## Fluxo de uso

1. Carregue `apps/extension` em `chrome://extensions` ou instale a versão oficial.
2. Clique no ícone da extensão e entre em **Minha conta**. Uma sessão anterior válida é renovada e reutilizada; sem sessão ou acesso ativo nenhuma toolbar/configuração protegida é liberada.
3. Em **Workspace**, cadastre Cliente → Projeto → Produto → Ambiente e adicione uma ou mais URLs ao ambiente.
4. A toolbar aparece somente nas URLs de ambientes ativos. A lista personalizada em **Barra e aparência**
   funciona como uma restrição adicional: a URL precisa corresponder ao ambiente e à lista.

O login também pode ser feito na landing page oficial. Quando a versão publicada está instalada, a landing repassa a sessão diretamente à extensão após validar o acesso.

## Configuração disponível

- conta e validação de plano/entitlement;
- escopo por URLs dos ambientes ou padrões personalizados;
- modo compacto, conteúdo reservado no topo, atalhos fixados e visibilidade individual das ferramentas;
- CRUD com editar, duplicar, ativar/desativar e excluir para clientes, projetos, produtos e ambientes;
- contas e pagamentos exclusivamente sandbox, filtrados pelo ambiente atual e mascarados na barra;
- APIs, inspectors declarativos com filtro de captura e recursos/links seguros no menu;
- busca, importação normalizada com rollback, exportação segura com checksum SHA-256 e reset apenas do workspace local.

Senhas de contas sandbox, valores de pagamento e tokens de API permanecem em `chrome.storage.local` e são removidos da exportação. Logout remove a UI injetada, mas preserva o workspace.

## Rodar localmente num Chrome de verdade

`npm run dev:extension` abre uma janela real e visível do Chrome (o mesmo Chromium que o Playwright
usa nos smokes) já com `apps/extension` carregada via `--load-extension`, sem mockar a rede — fala
com o backend real, igual o Chrome de um usuário. O perfil fica em `artifacts/chrome-dev-profile/` e
sobrevive entre execuções (login e workspace continuam lá); apague a pasta para recomeçar do zero.
Feche a janela do Chrome para encerrar o comando.

## Verificação

`npm run test:chrome` executa em Chromium real o contrato deslogado → login → CRUD → toolbar → modo compacto → edição de URL → navegação SPA → pagamentos/recursos → exportação segura → logout.

`npm run verify:cineluna` importa pela UI o fixture white-label fictício de referência e confirma vínculos, contagens, badges e ambientes.

## Atualização na Chrome Web Store

`npm run release:chrome:update` executa os scanners, o smoke em Chrome real e gera o ZIP verificado em
Downloads. O pacote usa whitelist (`manifest.json`, `icons/` e `src/`) e rejeita `manifest.key`, `.env`,
source maps, fixtures, testes e padrões de segredo.

Duas formas de enviar essa atualização para o item existente `ddaapjklnfjhjigeglgmjmadjnmdodfe` (nunca
cria um segundo item):

- **Manual**: arraste o ZIP gerado no painel do desenvolvedor da Store.
- **Automatizado**: `npm run release:chrome:upload` (envia como rascunho) ou
  `npm run release:chrome:publish` (envia e já manda para revisão), via
  [Chrome Web Store Publish API](../../docs/DEPLOY_CHROME_WEBSTORE.md). Exige uma configuração OAuth
  única, feita uma vez pela conta dona da extensão — veja `docs/DEPLOY_CHROME_WEBSTORE.md`. A
  revisão manual da Google acontece do mesmo jeito nos dois casos.
