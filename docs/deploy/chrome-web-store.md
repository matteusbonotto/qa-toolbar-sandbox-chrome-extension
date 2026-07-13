# Publicação segura na Chrome Web Store

## Fluxo local

1. Trabalhe em um checkout limpo e revise `git diff`.
2. Atualize a versão em `apps/extension/package.json`.
3. Execute:

   ```bash
   npm ci
   npm run release:chrome
   ```

4. Teste o ZIP de `artifacts/` em um perfil descartável.
5. Faça upload desse ZIP no painel da Chrome Web Store.

`release:chrome` executa scan do repositório, typecheck, testes, build, scan do bundle, geração do ZIP e checksum. Ele falha se detectar source maps, `.env`, chaves, código-fonte, permissões perigosas ou marcadores de secrets no bundle.

## Fluxo pelo GitHub Actions

Abra **Actions → Build Chrome Web Store package → Run workflow**. Ao concluir, baixe o artifact `chrome-web-store-package`. O artifact expira em 14 dias e não é commitado.

No painel da Chrome Web Store, informe como URL da política de privacidade:

```text
https://matteusbonotto.github.io/qa-toolbar-sandbox-chrome-extension/privacy-policy/
```

As declarações da aba **Privacy practices** devem permanecer idênticas ao comportamento da extensão e ao texto publicado. Revise especialmente e-mail de conta, autenticação, conteúdo/URLs processados localmente, pagamentos via Stripe e permissões de host sob demanda.

O workflow da landing page também gera e verifica o ZIP, mas o envia ao bucket privado por `publish-release`. Configure `SUPABASE_RELEASE_UPLOAD_URL` como variável do repositório e `SUPABASE_RELEASE_UPLOAD_SECRET` como secret. O GitHub Pages recebe somente o checksum; usuários recebem um link temporário após `download-release` confirmar trial ou assinatura no servidor.

## Regras de versão e rollback

- A Chrome Web Store só aceita uma versão maior do que a já publicada.
- Não reutilize números de versão, mesmo que um envio seja rejeitado.
- Preserve localmente o ZIP e o checksum de cada versão aprovada em armazenamento privado.
- Para rollback funcional, corrija o código, incremente a versão e envie uma nova release; não altere um ZIP já assinado/registrado.

## Nunca colocar no pacote

Secrets do Supabase/Stripe/GitHub, `.env`, tokens de deploy, certificados/chaves privadas, perfis do Chrome, exports/backups, dados de clientes, runbooks internos, source maps ou credenciais de teste. Chaves publicáveis podem estar no cliente, mas todo acesso continua protegido no servidor por autenticação, autorização e RLS.
