# Pendências que só você consegue resolver

> Documento vivo, criado em 2026-07-17 pra reunir num lugar só tudo que ficou pendente
> depois da sessão que adicionou: badge de ilustração na LP, fix da política de privacidade,
> automação de deploy pra Chrome Web Store, fluxo de esqueci senha, gating de ferramentas por
> plano + aba de feature flags no admin, e o fix de recompra. Tudo isso está no branch
> `agent/lp-privacy-and-tooling`, ainda não mergeado em `main`.

Marque `[x]` conforme for resolvendo. Nenhum destes itens pode ser feito por mim — todos exigem
login, senha, OTP ou uma tela que só você tem acesso.

## 1. Antes de mergear o PR

- [ ] **Dispensar o alerta médio do CodeQL** ("File data in outbound network request" em
      `scripts/publish-chrome-webstore.mjs`). Não é bug — é o script mandando o `.zip` pro
      endpoint oficial do Google, que é literalmente a função dele. Na aba **Files changed** do
      PR (ou em **Security → Code scanning alerts**), abra o alerta → **Dismiss alert** →
      motivo **"False positive"** → comentário sugerido: *"Upload intencional do pacote da
      extensão pro endpoint oficial da Chrome Web Store API, não é exfiltração."*
      O alerta **alto** (clear-text logging) já foi corrigido no commit `9750aa8` — depois de
      dispensar o médio, o check do CodeQL deve reavaliar e desbloquear o merge.
- [ ] **Revisar e mergear o PR**: https://github.com/matteusbonotto/qa-toolbar-sandbox-chrome-extension/pull/new/agent/lp-privacy-and-tooling
      (ou a PR já aberta, se você já criou uma a partir desse link). Dar push direto em `main`
      foi bloqueado pelo próprio Claude Code — só você consegue mergear.

## 2. GitHub Actions — 3 secrets (pra automação de deploy da extensão funcionar)

Sem isso, o workflow `chrome-store-package.yml` falha logo no início com uma mensagem clara
(não falha silenciosamente).

- [ ] `Settings → Secrets and variables → Actions → New repository secret`, criar os três, com
      esses nomes exatos:
  - [ ] `CHROME_WEBSTORE_CLIENT_ID`
  - [ ] `CHROME_WEBSTORE_CLIENT_SECRET`
  - [ ] `CHROME_WEBSTORE_REFRESH_TOKEN`
- [ ] Os valores: copie do seu `.env` local (linhas com esses mesmos nomes, sem as aspas). Não
      estão neste documento nem foram colados no chat de propósito.

## 3. Supabase — permitir o redirect do "esqueci minha senha"

- [ ] `Authentication → URL Configuration → Redirect URLs → Add URL`, adicionar exatamente:
      ```
      https://matteusbonotto.github.io/qa-toolbar-sandbox-chrome-extension/redefinir-senha
      ```
      (sem barra no final — é a URL que o código monta de verdade). Sem isso, o e-mail de reset
      de senha é enviado, mas o link de volta pode cair numa página de erro do Supabase em vez
      de abrir `/redefinir-senha`.

## 4. Chrome Web Store

- [ ] **Aguardar a revisão pendente da Google terminar** (aprovada ou rejeitada) — enquanto isso,
      o painel mostra os botões de editar/publicar desabilitados e o app não aparece na busca
      pública; isso é comportamento normal da Store, não bug daqui.
- [ ] Depois que a revisão atual resolver, rodar de novo `npm run release:chrome:upload`
      (ou deixar o push em `main` disparar sozinho, já que o workflow ficou automático) pra
      enviar o pacote com todas as mudanças desta sessão.
- [ ] Do checklist antigo, ainda pendente: no primeiro acesso ao admin publicado, clicar em
      "Primeiro acesso? Criar conta", definir a senha de `matteusbonotto+admin@gmail.com`,
      confirmar o e-mail e validar o OTP humano.

## 5. Testes ao vivo que eu não consegui fazer (sem sessão/credencial real)

- [ ] Logar no admin (`/admin/`) com a conta founder → aba **Feature flags** (nova) → conferir
      se a tabela carrega e se marcar/desmarcar uma célula salva de verdade.
- [ ] Testar o fluxo completo de "Esqueci minha senha" com um e-mail real: pedir o link, abrir o
      e-mail, clicar, cair em `/redefinir-senha`, trocar a senha, logar com a senha nova.
- [ ] Com um usuário de plano baixo (ex.: Smoke Test) autenticado na extensão de verdade,
      conferir se Macro Studio e Key View realmente somem do menu (já validei isso com um mock
      automatizado, mas vale conferir com uma conta real depois que a distribuição de planos for
      pra produção).

## O que NÃO está pendente (já feito e verificado nesta sessão)

Typecheck, testes, scanners de segurança (`security:repo`/`security:extension`), build da LP e do
admin, smoke completo em Chrome real (0 erros), e uma revisão de segurança formal (3 achados
investigados, 0 confirmados) — tudo isso já rodou e passou. Detalhes técnicos de cada mudança
estão nas mensagens de commit do branch e em `docs/handoff/CHECKLIST_RECONSTRUCAO.md`.
