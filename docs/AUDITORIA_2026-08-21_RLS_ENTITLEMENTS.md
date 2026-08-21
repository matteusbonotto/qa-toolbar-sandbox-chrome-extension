# Auditoria — RLS e entitlements (2026-08-21)

> Auditoria read-only (nenhum arquivo de código/schema foi alterado durante esta análise). Escopo:
> `supabase/schema.sql`, todas as migrations em `supabase/migrations/`, Edge Functions em
> `supabase/functions/`. Objetivo: caçar outras instâncias da mesma classe do bug de escalonamento
> de trial corrigido em 2026-08-04 (commit `cc3e0a3`) — coluna sensível gravável por policy de RLS
> self-service sem restrição de coluna, com lógica de servidor confiando cegamente nesse dado.

## Contexto do bug de referência

Em 2026-08-04, um pentest encontrou que `profiles.trial_ends_at` podia ser sobrescrito por qualquer
usuário autenticado via PostgREST — a policy de `UPDATE` self-service (`auth.uid() = id`) validava
só o dono da linha, não quais colunas eram graváveis. `activate_free_trial()` confiava cegamente
nessa data a cada login, concedendo o plano pago "Release Manager" de graça e indefinidamente. A
correção (migration `20260804020000_lock_down_profiles_update.sql`) removeu a policy self-service
inteira.

## Achado crítico: a mesma vulnerabilidade continua em `schema.sql`

**A correção de produção nunca foi replicada em `supabase/schema.sql`.**

- `supabase/schema.sql:1314` ainda define a policy antiga:
  `"user updates own profile" ... using (auth.uid() = id or public.is_founder()) with check
  (auth.uid() = id or public.is_founder())` — sem restrição de coluna.
- A migration `20260804020000_lock_down_profiles_update.sql:11-12` remove essa policy e cria
  `"founder updates profiles"` (`using/with check (is_founder())`) — mas só nas migrations, não em
  `schema.sql`.
- `activate_free_trial()`, `bootstrap_founder()` e a trigger `handle_new_user()` em `schema.sql` são
  idênticos aos das migrations — a lógica de negócio não mudou, só a policy de RLS não foi
  atualizada.

**Consequência prática**: qualquer projeto Supabase provisionado do zero a partir de `schema.sql`
(fluxo documentado como `npm run backend:bootstrap`, usado para disaster recovery ou ambiente novo)
nasce com o bug exato encontrado no pentest — qualquer usuário autenticado pode fazer `PATCH` em
`profiles.trial_ends_at` via PostgREST e obter o plano "Release Manager" grátis e indefinidamente.

A produção atual **não está exposta** (a migration já rodou lá), mas o arquivo de referência do
repositório está. Isso viola diretamente a regra do próprio projeto em `docs/migration-strategy.md`:
*"se a migration adiciona algo que schema.sql também deveria ter desde o início, replique a mudança
em schema.sql também — os dois precisam concordar, senão um projeto novo criado do zero fica com um
estado diferente do que está em produção."*

**Recomendação**: aplicar a mesma correção em `schema.sql` (substituir a policy pela versão
`is_founder()`-only) antes de qualquer bootstrap novo. Fix mecânico, de baixo risco, sem tocar
produção — mas pendente de autorização explícita antes de eu aplicar (ver `AGENTS.md`, regra de
schema).

## Achado secundário: grant de `credit_reward_points()` também não replicado

- `schema.sql:1741` só tem `grant execute ... to service_role`.
- A migration `20260804010000_fix_credit_reward_points_grant.sql:7` adiciona
  `grant execute ... to authenticated` (necessário para o founder autenticado usar o ajuste manual
  de pontos no Admin).
- Impacto: não é falha de segurança (a função já nega internamente quem não é founder/service_role),
  mas quebra funcionalmente o ajuste manual de pontos em qualquer projeto bootstrapado do zero.

Ambas as lacunas vêm do mesmo commit (`cc3e0a3`, 2026-08-04) — sugere que, ao aplicar as duas
migrations no banco de produção, a atualização correspondente de `schema.sql` foi esquecida.

## Varredura completa de policies self-service

| Tabela | Policy/mecanismo | Quem pode escrever | Colunas expostas | Risco | Motivo |
|---|---|---|---|---|---|
| `profiles` (`schema.sql`) | `"user updates own profile"` (linha 1314) | qualquer autenticado, própria linha | todas, incl. `trial_ends_at` | **ALTO** | Mesmo bug de `cc3e0a3`, reintroduzido via `schema.sql` desatualizado |
| `profiles` (migrations pós `20260804020000`) | `"founder updates profiles"` | apenas founder | n/a | nenhum | Corrigido corretamente nas migrations |
| `installations` | insert/update own (linhas 1332-1333) | autenticado, própria linha | `label`, `last_seen_at`, `revoked_at` | baixo | Nenhuma função/trigger/Edge Function lê essas colunas para decidir plano/licença — tabela ainda não conectada a lógica de negócio sensível (contagem real de ativação é `license_activations`, founder-only) |
| `engagement_campaign_submissions` | insert/update own (linhas 1368-1369) | autenticado, própria linha, só enquanto `status` fica `pending`/`rejected` e `reward_grant_id` nulo | `review_notes`, `reviewed_at`, `reviewed_by`, `review_criteria`, `resubmission_count` fora do `WITH CHECK` | baixo | `review_engagement_campaign()` usa o parâmetro passado explicitamente pelo founder/service_role na chamada, não a coluna armazenada — valores forjados nessas colunas não influenciam aprovação/pontos |
| `reward_wallets`, `reward_point_entries`, `reward_spins`, `reward_benefits` | apenas `SELECT` própria linha | — | — | nenhum | Toda escrita via RPC `security definer` com checagem de role — padrão correto |
| `entitlement_grants`, `subscriptions`, `checkout_sessions`, `vouchers`, `voucher_campaigns`, `voucher_reservations`, `referrals`, `referral_profiles`, `license_keys`, `license_activations` | apenas `SELECT` própria linha + founder `for all` | — | — | nenhum | Sem insert/update self-service em nenhuma — escrita via RPC `security definer` gated ou webhook assinado do Stripe |

## Edge Functions

Nenhuma função em `supabase/functions/` (`checkout-create-session`, `stripe-webhook`,
`voucher-redeem`, `voucher-preview`, `rewards-spin`, `referral-track`, `account-delete`,
`admin-email-otp`) foi encontrada confiando em valor enviado pelo cliente para uma decisão de
segurança/dinheiro sem recalcular/validar no servidor.

## O que não foi confirmado

- `entitlement_grants.expires_at`, `subscriptions.current_period_end`,
  `checkout_sessions.expires_at`, `voucher_reservations.expires_at` — **NÃO CONFIRMADO** nenhum
  caminho de escrita self-service equivalente ao bug de trial (todas parecem founder-only ou RPC),
  mas não foi feita uma segunda passada exaustiva focada só nessas quatro colunas.

## Próximo passo sugerido

1. Replicar a policy corrigida de `profiles` e o grant de `credit_reward_points()` em
   `supabase/schema.sql` (fix mecânico, baixo risco — pendente de autorização).
2. Considerar um teste automatizado que compare, campo a campo, as policies de `schema.sql` contra
   o estado esperado pelas migrations mais recentes, para este tipo de drift não depender de revisão
   manual.
