# Pendências que só você consegue resolver

> Documento vivo. Reescrito do zero em 2026-07-19 — a versão anterior misturava itens já
> resolvidos há dias com os realmente pendentes, e isso gerou confusão. A partir de agora, tudo
> que estiver aqui é **verificado como pendente no momento da última edição**, não copiado de uma
> lista antiga. Nenhum destes itens pode ser feito por mim — todos exigem login, senha, service
> role key, OTP ou uma tela que só você tem acesso.

## 1. [RESOLVIDO] Feature flags aplicadas no banco real

`characterCounter`, `multiClick`, `inputLab`, `fakerFill`, `macroStudio`, `keyView` e
`elementCapture` foram aplicadas em produção pela API em 2026-07-20, sem Supabase CLI nem acesso
de administrador do Windows. A leitura anterior mostrou somente `elementCapture.enabled` ausente;
depois do upsert idempotente, a verificação confirmou as 28 células plano × ferramenta.

- [x] Aplicado com a service-role key local:
  ```
  SUPABASE_URL=https://xhusvkylbouwtpcevgri.supabase.co SUPABASE_SERVICE_ROLE_KEY=<sua chave> node scripts/apply-plan-features-migration.mjs
  ```
  Ele mesmo confirma no final ("Done. All 7 tools are now correctly gated...").
- [x] `node scripts/verify-plan-features.mjs` executado depois da escrita: nenhuma divergência.
- [x] A API confirmou as 7 flags e Release Manager marcado em todas; não depende de conferência
      visual no admin para considerar a matriz aplicada.

## 2. Redeploy das Edge Functions (a correção do login de admin só entra em vigor depois disso)

Mergeamos a correção do bug que travava o login do admin (`invalid_session`), mas Edge Functions
não atualizam sozinhas com o merge — o código antigo continua rodando até você reenviar.

- [ ] Se ainda não rodou depois do merge do PR #46, rode:
  ```
  npx supabase@latest functions deploy --project-ref xhusvkylbouwtpcevgri --use-api
  ```
- [ ] Confirma logando de novo em `/admin/` com senha + OTP.

## 3. [RESOLVIDO] Sessão do admin agora sobrevive a um F5

Era proposital (token de MFA só em memória, pra um script injetado nunca reutilizá-lo após
reload) — você escolheu a opção B (meio-termo): o token de MFA agora vive em `sessionStorage`,
sobrevive a reload e a navegar entre abas da mesma sessão do navegador, mas some ao fechar a
aba/janela e continua expirando nos 60 minutos normais. Verificado ao vivo: login completo
(senha + OTP) via Playwright contra o bundle real, reload da página, painel continuou logado.

## 4. Chrome Web Store (pausado a pedido seu)

Confirmado com dados reais: o workflow de auto-publish falha desde 18/07, em 7 pushes seguidos,
sem relação com nada desta sessão — provavelmente a revisão do Google ainda pendente/cancelada
bloqueando o upload. Você pediu pra não investigar isso agora. Quando quiser retomar: abra a run
mais recente de **Build Chrome Web Store package** → job **publish-to-store** → passo **"Upload to
Chrome Web Store"** e cola aqui a mensagem de erro.

## 6. Nova migration: status da Chrome Web Store na LP (2026-07-20)

A LP agora mostra a versão do pacote e, se a Chrome Web Store estiver desatualizada, um aviso
"em análise do Google" — mas isso lê de uma tabela nova que só existe depois que você aplicar a
migration.

- [ ] Aplique `supabase/migrations/20260720010000_store_listing_status.sql` (cole no SQL Editor
      do Supabase, ou rode via CLI — é idempotente).
- [ ] Sempre que checar o painel real da Chrome Web Store, atualize a linha única da tabela
      `store_listing_status` (Table Editor do Supabase) com a versão publicada e o status
      (`pending_review` / `live` / `rejected`). Isso é manual de propósito — automatizar exigiria
      um novo secret de CI com escrita no banco, que não criei sem sua aprovação.

## 5. Teste ao vivo que ainda falta

- [ ] Fluxo completo de "Esqueci minha senha" com e-mail real (pedir link → abrir e-mail →
      `/redefinir-senha` → trocar senha → logar com a nova).
- [ ] Conferir com uma conta real de plano baixo (ex. Smoke Test) que Macro Studio, Key View e
      Capturar Elementos realmente somem do menu — a matriz real já foi verificada via API, mas
      esse teste visual ainda exige uma segunda conta/assinatura.

## O que já está confirmado certo (verificado de novo em 2026-07-19, não é suposição)

Rodado agora, na `main` já com tudo mergeado: `security:repo`, `security:extension`,
`test-extension-workspace.mjs`, `typecheck` (landing e admin), `test:chrome` (0 erros de console,
0 erros de worker) — todos passando. Todos os PRs desta sessão (#43, #44, #45, #46) estão
mergeados. Login de admin com senha + OTP funciona de ponta a ponta (você confirmou). Publicação
da LP/admin/zip da extensão no GitHub Pages foi simulada localmente passo a passo, idêntica ao
workflow real, sem erro.
