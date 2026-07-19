# Pendências que só você consegue resolver

> Documento vivo. Reescrito do zero em 2026-07-19 — a versão anterior misturava itens já
> resolvidos há dias com os realmente pendentes, e isso gerou confusão. A partir de agora, tudo
> que estiver aqui é **verificado como pendente no momento da última edição**, não copiado de uma
> lista antiga. Nenhum destes itens pode ser feito por mim — todos exigem login, senha, service
> role key, OTP ou uma tela que só você tem acesso.

## 1. Aplicar a migration de feature flags no banco real (BLOQUEIA os planos)

Sem isso, `characterCounter`, `multiClick`, `inputLab`, `fakerFill`, `macroStudio` e `keyView`
continuam ausentes da tabela **Feature flags** do admin e bloqueados pra todo mundo, inclusive
Release Manager.

- [ ] Rode localmente, com sua service-role key:
  ```
  SUPABASE_URL=https://xhusvkylbouwtpcevgri.supabase.co SUPABASE_SERVICE_ROLE_KEY=<sua chave> node scripts/apply-plan-features-migration.mjs
  ```
  Ele mesmo confirma no final ("Done. All 6 tools are now correctly gated...").
- [ ] Se der qualquer erro, roda `node scripts/verify-plan-features.mjs` (mesmas variáveis) e
      cola aqui o que ele imprimir.
- [ ] Depois de rodar, atualiza `/admin/` → **Feature flags** e confirma que as 6 linhas novas
      aparecem com a coluna Release Manager marcada.

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

## 5. Teste ao vivo que ainda falta

- [ ] Fluxo completo de "Esqueci minha senha" com e-mail real (pedir link → abrir e-mail →
      `/redefinir-senha` → trocar senha → logar com a nova).
- [ ] Depois que o item 1 acima estiver resolvido: conferir com uma conta real de plano baixo
      (ex. Smoke Test) que Macro Studio e Key View realmente somem do menu — hoje só está
      validado com plano mockado no smoke automatizado.

## O que já está confirmado certo (verificado de novo em 2026-07-19, não é suposição)

Rodado agora, na `main` já com tudo mergeado: `security:repo`, `security:extension`,
`test-extension-workspace.mjs`, `typecheck` (landing e admin), `test:chrome` (0 erros de console,
0 erros de worker) — todos passando. Todos os PRs desta sessão (#43, #44, #45, #46) estão
mergeados. Login de admin com senha + OTP funciona de ponta a ponta (você confirmou). Publicação
da LP/admin/zip da extensão no GitHub Pages foi simulada localmente passo a passo, idêntica ao
workflow real, sem erro.
