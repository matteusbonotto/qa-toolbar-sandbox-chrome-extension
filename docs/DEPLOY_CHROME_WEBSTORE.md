# Publicar na Chrome Web Store por script/CI

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

## Automático a cada merge em `main`

O workflow `chrome-store-package.yml` dispara sozinho em todo `push` em `main` que toque
`apps/extension/**` (ou os scripts de empacotamento/smoke). Ele builda, roda os scanners de
segurança, faz o smoke em Chrome real (com display virtual no runner) e, se tudo passar, **já
publica direto para revisão da Google** — sem clique manual no meio. Essa foi uma escolha
deliberada: todo commit que chega em `main` por esse caminho é tratado como pronto para ir para
revisão. Se algum scanner ou o smoke falhar, o job para e nada é enviado.

Pré-requisito: os três repository secrets (`CHROME_WEBSTORE_CLIENT_ID`,
`CHROME_WEBSTORE_CLIENT_SECRET`, `CHROME_WEBSTORE_REFRESH_TOKEN`) precisam estar configurados em
**Settings → Secrets and variables → Actions** antes do primeiro push com mudanças na extensão,
senão o job falha cedo com uma mensagem clara (não falha silenciosamente).

## Uso manual (sob demanda, sem precisar de um novo commit)

- **Local, só enviar como rascunho**:
  ```
  npm run release:chrome:upload
  ```
- **Local, enviar e já mandar para revisão/publicação**:
  ```
  npm run release:chrome:publish
  ```
- **Pelo GitHub Actions**: workflow `Build Chrome Web Store package` → *Run workflow* → marque
  `upload_to_store` (e opcionalmente `publish_live`). Útil para reenviar sem esperar um novo push
  em `main` (ex.: depois de corrigir algo que a Store rejeitou).

Tanto os scripts locais quanto o job de CI rodam os scanners de segurança (`security:repo`,
`security:extension`) e o smoke em Chrome real (`test:chrome`) antes de empacotar e enviar — nada
é enviado se algum desses passos falhar.

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
