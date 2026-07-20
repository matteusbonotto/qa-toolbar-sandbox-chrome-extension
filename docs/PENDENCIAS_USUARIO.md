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

## 4. [RESOLVIDO] Chrome Web Store recebeu a versão 1.1.3

O log mostrou a causa real das falhas anteriores: o pacote continuava em `1.1.2`, exatamente a
mesma versão já publicada, e a Store exige número crescente. O manifest foi atualizado para
`1.1.3`; na run `29759225436`, pacote, scanners, smoke em Chrome real, upload e solicitação de
publicação terminaram com sucesso. O Google ainda pode manter a versão em análise antes de ela
ficar pública na listagem — isso é estado da revisão, não falha do deploy.

## 5. Nova migration: status da Chrome Web Store na LP (2026-07-20)

A LP agora mostra a versão do pacote e, se a Chrome Web Store estiver desatualizada, um aviso
"em análise do Google" — mas isso lê de uma tabela nova que só existe depois que você aplicar a
migration.

- [ ] Aplique `supabase/migrations/20260720010000_store_listing_status.sql` (cole no SQL Editor
      do Supabase, ou rode via CLI — é idempotente).
- [ ] Sempre que checar o painel real da Chrome Web Store, atualize a linha única da tabela
      `store_listing_status` (Table Editor do Supabase) com a versão publicada e o status
      (`pending_review` / `live` / `rejected`). Isso é manual de propósito — automatizar exigiria
      um novo secret de CI com escrita no banco, que não criei sem sua aprovação.

## 7. Exclusão de conta (LGPD) — nova edge function + migration (2026-07-20)

Nova tela "Excluir minha conta" (aba Minha conta): cancela a assinatura Stripe ativa na hora,
apaga os dados pessoais, mantém registros financeiros anonimizados. Verificado ao vivo com
respostas simuladas (senha errada, pagamento pendente, sucesso) — mas a função ainda não existe
em produção até você fazer os dois passos abaixo.

- [ ] Aplique `supabase/migrations/20260720030000_payment_events_user_delete_set_null.sql` (SQL
      Editor do Supabase ou CLI — idempotente). Sem isso, excluir a conta de qualquer usuário com
      histórico de pagamento falha (a constraint antiga bloqueia, em vez de anonimizar).
- [ ] Deploy da nova edge function `account-delete`:
  ```
  npx supabase@latest functions deploy account-delete --project-ref xhusvkylbouwtpcevgri --use-api
  ```
- [ ] Teste ao vivo com uma conta de teste real (sem assinatura ativa) para confirmar a exclusão
      de ponta a ponta antes de anunciar a funcionalidade.

## 8. Notificação de pagamento falhado — feito só o lado sem custo, e-mail fica pra você decidir (2026-07-20)

Pedido: quando o pagamento falha, bloquear recursos pagos automaticamente (**já funcionava antes
desta sessão** — `access-status` já exigia `subscription.status === 'active'`) e notificar o
usuário. Como não existe nenhum provedor de e-mail configurado no projeto (nem Resend, nem
SendGrid, nem SMTP), implementei só o que não depende de conta/custo externo:

- [x] Extensão: quando `billing.status` vem `past_due`/`unpaid` do `access-status`, aparece um
      badge vermelho "!" no ícone da extensão (`chrome.action.setBadgeText`) e um aviso destacado
      na aba "Minha conta" explicando o que aconteceu — some sozinho assim que o pagamento é
      regularizado. Verificado ao vivo com Playwright (badge aparece/some, aviso aparece/some).
- [ ] **E-mail continua pendente** — depende de você escolher/criar uma conta em um provedor. Não
      deixei nenhum código pela metade esperando isso (nada de stub/TODO no meio do webhook); quando
      você tiver a chave, é uma implementação pequena e direta em
      `supabase/functions/stripe-webhook/index.ts`, no bloco
      `if (["invoice.paid", "invoice.payment_failed"].includes(event.type))` — o `userId` e a
      assinatura já estão resolvidos ali, só falta buscar o e-mail (`admin.auth.admin.getUserById`)
      e chamar a API do provedor escolhido.

**Como fazer de graça (passo a passo, Resend — o mais simples pra Edge Functions em Deno):**

1. Crie uma conta grátis em resend.com (não pede cartão). O plano free dá 100 e-mails/dia e 3.000
   por mês, o suficiente para avisos de cobrança de um produto começando.
2. Sem verificar domínio, você já pode enviar usando o remetente de teste deles
   (`onboarding@resend.dev`) — funciona para começar a testar, mas o Gmail/Outlook do destinatário
   pode marcar como suspeito por não ser o seu domínio.
3. Para enviar como você (ex. `contato@matheusbonotto.com.br` ou o domínio da LP), verifique um
   domínio grátis: Resend → Domains → Add Domain → ele te dá 3 registros DNS (SPF, DKIM, um
   opcional de rastreio) para colar onde seu domínio está hospedado (Cloudflare, Registro.br, etc,
   todos com DNS grátis). Leva de alguns minutos a algumas horas para propagar.
4. Gere uma API key em Resend → API Keys → Create API Key.
5. Salve a chave como secret da Supabase (nunca no código):
   ```
   npx supabase@latest secrets set RESEND_API_KEY=re_xxx --project-ref xhusvkylbouwtpcevgri
   ```
6. Me avise quando tiver feito isso — aí eu escrevo a chamada `fetch("https://api.resend.com/emails", ...)`
   dentro do `stripe-webhook` e faço o redeploy da função.

## 6. Teste ao vivo que ainda falta

- [ ] Fluxo completo de "Esqueci minha senha" com e-mail real (pedir link → abrir e-mail →
      `/redefinir-senha` → trocar senha → logar com a nova).
- [ ] Conferir com uma conta real de plano baixo (ex. Smoke Test) que Macro Studio, Key View e
      Capturar Elementos realmente somem do menu — a matriz real já foi verificada via API, mas
      esse teste visual ainda exige uma segunda conta/assinatura.

## O que já está confirmado certo (verificado de novo em 2026-07-20, não é suposição)

Rodado na versão final: `security:repo`, `security:extension`, testes unitários, `typecheck`
(landing e admin), `test:pages` e `test:chrome` (0 erros de console e de worker) — todos passando.
Os PRs funcionais #49 e #50 estão mergeados na `main`; Landing Page e Admin foram publicados e
verificados no GitHub Pages. O workflow da Chrome Web Store aceitou o pacote `1.1.3` e a
solicitação de publicação.
