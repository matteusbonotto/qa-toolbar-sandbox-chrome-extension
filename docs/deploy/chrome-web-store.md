# Publicação segura na Chrome Web Store

## Fluxo local do mantenedor

1. Trabalhe em um checkout limpo e revise `git diff`.
2. Execute:

   ```bash
   npm ci
   npm run release:chrome:update
   ```

3. Teste o ZIP de `artifacts/` em um perfil descartável.
4. No item existente, abra **Package → Upload new package** e envie o ZIP mais recente.

`release:chrome:update` incrementa automaticamente a versão patch e chama `release:chrome`, que executa scan do repositório, typecheck, testes, build, scan do bundle, geração do ZIP e checksum. O processo falha se detectar source maps, `.env`, chaves, código-fonte, permissões perigosas, marcadores de secrets ou o campo `manifest.key`. A Chrome Web Store preserva a chave e o ID do item existente.

O ZIP é um artefato privado do mantenedor. A landing page nunca publica ou entrega o pacote diretamente ao cliente. Depois que o backend confirma trial, voucher ou pagamento, a pessoa é direcionada à página oficial configurada em `CHROME_WEB_STORE_URL`.

## Fluxo pelo GitHub Actions

Abra **Actions → Build Chrome Web Store package → Run workflow**. Ao concluir, baixe o artifact `chrome-web-store-package`. O artifact expira em 14 dias e não é commitado. O workflow da landing page publica somente os arquivos estáticos da página.

No painel da Chrome Web Store, informe como URL da política de privacidade:

```text
https://matteusbonotto.github.io/qa-toolbar-sandbox-chrome-extension/privacy-policy/
```

As declarações da aba **Privacy practices** devem permanecer idênticas ao comportamento da extensão e ao texto publicado. Revise especialmente e-mail de conta, autenticação, conteúdo/URLs processados localmente, pagamentos via Stripe e permissões de host sob demanda.

## Regras de versão e rollback

- A Chrome Web Store só aceita uma versão maior do que a já publicada.
- Não reutilize números de versão, mesmo que um envio seja rejeitado.
- Preserve localmente o ZIP e o checksum de cada versão aprovada em armazenamento privado.
- Para rollback funcional, corrija o código, incremente a versão e envie uma nova release; não altere um ZIP já assinado/registrado.

## Nunca colocar no pacote

Secrets do Supabase/Stripe/GitHub, `.env`, tokens de deploy, certificados/chaves privadas, perfis do Chrome, exports/backups, dados de clientes, runbooks internos, source maps ou credenciais de teste. Chaves publicáveis podem estar no cliente, mas todo acesso continua protegido no servidor por autenticação, autorização e RLS.
