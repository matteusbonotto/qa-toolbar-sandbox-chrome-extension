# Publicar na Chrome Web Store por script/CI

## Atualização das instalações antigas

Quando uma versão com número maior é aprovada e publicada no mesmo item da Chrome Web Store,
o próprio Chrome distribui a atualização automaticamente às instalações existentes. Normalmente
ele verifica na inicialização e depois periodicamente; a aplicação pode ocorrer quando a extensão
fica ociosa ou após reiniciar o navegador.

Ao receber a atualização, a extensão agora:

- preserva e normaliza o workspace antigo pelo schema atual;
- grava a versão anterior e a nova versão localmente;
- mostra o selo `NEW` no ícone;
- adiciona “Atualizado para a versão X” ao sino da toolbar;
- exibe um resumo traduzido das novidades na toolbar ou nas Configurações;
- remove o selo somente depois da confirmação do usuário.

Instalações carregadas manualmente com **Carregar sem compactação** são ambientes de desenvolvimento
e não recebem atualização da Chrome Web Store. Elas devem ser atualizadas pelo pacote de teste e
pelo botão **Atualizar** de `chrome://extensions`.

Antes de cada release, revise o conteúdo de `releaseNotesCopy()` em `toolbar.js` e
`showPendingReleaseNotes()` em `options.js`, para que o resumo corresponda à versão publicada.

Automatiza o que hoje é feito manualmente arrastando o `.zip` no painel do desenvolvedor
(`chrome.google.com/webstore/devconsole`), usando a [Chrome Web Store Publish API](https://developer.chrome.com/docs/webstore/using-api)
oficial do Google. Nunca cria um item novo: o alvo é sempre o item já publicado
(`ddaapjklnfjhjigeglgmjmadjnmdodfe`), a menos que você passe `--extension-id` explicitamente.
A revisão humana da Google continua acontecendo do mesmo jeito — isso só troca "arrastar o
arquivo" por "rodar um comando".

## Configuração única (feita por você, uma vez)

Precisa ser feita pela conta Google que é dona do item na Store. Nenhum desses passos pode ser
automatizado por mim — é uma autorização OAuth real, feita no seu navegador, com a sua conta.

1. Abra o [Google Cloud Console](https://console.cloud.google.com/) e crie (ou reaproveite) um
   projeto.
2. Em **APIs e serviços → Biblioteca**, ative a **Chrome Web Store API**.
3. Em **APIs e serviços → Tela de consentimento OAuth**, configure como "Externo" + modo de teste
   (não precisa publicar o app OAuth; só a sua própria conta vai usá-lo).
4. Em **APIs e serviços → Credenciais → Criar credenciais → ID do cliente OAuth**, escolha o tipo
   **"App para computador" (Desktop app)** — não use "Aplicativo da Web". Copie o **Client ID** e o
   **Client Secret** gerados.
5. Rode localmente (com as duas variáveis acima disponíveis no shell, ou em um arquivo passado via
   `--env-file`):
   ```
   CHROME_WEBSTORE_CLIENT_ID=... CHROME_WEBSTORE_CLIENT_SECRET=... npm run chrome-webstore:oauth-setup
   ```
   O script abre uma URL de autorização do Google para você colar no navegador (logado com a
   conta dona da extensão), sobe um servidor local só para capturar o retorno, troca o código por
   tokens e imprime um **refresh token** uma única vez.
6. Guarde os três valores (`CHROME_WEBSTORE_CLIENT_ID`, `CHROME_WEBSTORE_CLIENT_SECRET`,
   `CHROME_WEBSTORE_REFRESH_TOKEN`):
   - localmente, em `.env.edge.local` (já ignorado pelo Git) para rodar via `--env-file`;
   - e/ou como **GitHub Actions repository secrets** (`Settings → Secrets and variables →
     Actions`) com esses mesmos três nomes, para o workflow funcionar.

O refresh token não expira por tempo (só se você revogar o acesso em
`myaccount.google.com/permissions` ou trocar a senha da conta Google). Não precisa repetir esse
passo depois — é literalmente único.

## Seguro a cada merge em `main`

O workflow `chrome-store-package.yml` dispara em todo `push` em `main` que toque a extensão. Ele
gera o artefato de produção, mas **não envia nada automaticamente à Chrome Web Store**. A promoção
é manual para impedir que código ainda em avaliação chegue aos usuários por engano.

Pré-requisito: os três repository secrets (`CHROME_WEBSTORE_CLIENT_ID`,
`CHROME_WEBSTORE_CLIENT_SECRET`, `CHROME_WEBSTORE_REFRESH_TOKEN`) precisam estar configurados em
**Settings → Secrets and variables → Actions** antes da primeira publicação manual. Um push ou
merge comum não usa esses segredos e nunca envia o pacote à Store.

## Publicação manual depois da aprovação

No GitHub Actions, execute `Build Chrome Web Store package` somente na branch `main` e digite
`PUBLICAR PRODUCAO`. O job usa o environment protegido `production`; configure revisores
obrigatórios em `Settings → Environments → production` para obter uma segunda confirmação.

Uso local, também restrito à `main` e com confirmação explícita:

- **Local, só enviar como rascunho**:
  ```
  npm run release:chrome:upload
  ```
- **Local, enviar e já mandar para revisão/publicação**:
  ```
  npm run release:chrome:publish
  ```
- **Pelo GitHub Actions**: workflow `Build Chrome Web Store package` → *Run workflow* → branch
  `main` → confirmação `PUBLICAR PRODUCAO` → opcionalmente enviar para revisão.

Tanto os scripts locais quanto o job de CI rodam os scanners de segurança (`security:repo`,
`security:extension`) e o smoke em Chrome real (`test:chrome`) antes de empacotar e enviar — nada
é enviado se algum desses passos falhar. Veja também o guia para iniciantes
[`AMBIENTES_TESTE_E_PRODUCAO.md`](./AMBIENTES_TESTE_E_PRODUCAO.md).

## Se algo der errado

- Erro `CHROME_WEBSTORE_*obrigatórios`: variáveis não configuradas no ambiente/CI — repita o
  passo 6 acima.
- Erro no `chrome-webstore-oauth-setup.mjs` dizendo que não veio `refresh_token`: normalmente
  significa que essa conta já autorizou esse client antes e o Google não reemite por padrão;
  revogue o acesso em `myaccount.google.com/permissions` e rode de novo (o script já pede
  `prompt=consent` para evitar isso na maioria dos casos).
- Erro de `uploadState` diferente de `SUCCESS`: o corpo do erro (`itemError`) vem impresso no
  terminal com o motivo exato reportado pela Store (ex.: manifest inválido, permissão nova sem
  justificativa etc.).
