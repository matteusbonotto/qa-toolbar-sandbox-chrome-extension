# Estratégia de testes — QA Toolbar Sandbox

## Princípio central (regra de `AGENTS.md`)

> Um teste que apenas encontra código, abre uma aba ou confirma ausência de exceção não comprova
> a regra visual/funcional. Valide o resultado real no DOM/estilo/estado e, quando relevante,
> salve evidência.

Isso já aconteceu nesta sessão: uma feature nova (Report Builder) só foi considerada pronta
depois que o smoke assertava o **valor real** pré-preenchido no campo (`inputValue()`), não só
que o drawer abriu sem lançar exceção.

## Camadas, da mais rápida à mais lenta

| Comando | O que cobre | Quando rodar |
|---|---|---|
| `node --check <arquivo>` | Sintaxe (a extensão não tem bundler/TS — é a única rede de segurança sintática) | A cada edição em `.js`/`.mjs` |
| `npm run typecheck` | TypeScript de `apps/landing` e `apps/admin` | A cada edição em `.ts`/`.tsx` |
| `node scripts/test-extension-workspace.mjs` | Normalização de workspace, migração de schema, `FEATURE_REGISTRY` (paridade ESM/clássico) | Depois de mexer em `storage.js`/`storage-content.js` |
| `npm test` | Todos os unitários (`test:*` de cada workspace npm + os scripts `test-*.mjs` da raiz) | Antes de qualquer commit relevante |
| `npm run backend:check` | Testes Deno das Edge Functions + `deno check` de tipos | Depois de mexer em `supabase/functions/` |
| `npm run test:security:local` / `test:load:local` | Suíte de segurança (entradas hostis, autorização) e de carga contra o mock local, com autoteste de mutação | Depois de mexer em `supabase/functions/`, em `supabase/schema.sql` ou nas próprias suítes (ver seção "Segurança e carga do backend") |
| `npm run security:repo` / `security:extension` | Segredo vazado, arquivo fora da whitelist do pacote | Sempre antes de commit/release (hook de pre-commit já roda `security:repo`) |
| `npm run smoke:lp-admin` (= `test:pages`) | Landing e Admin buildam e renderizam sem erro | Depois de mexer em `apps/landing`/`apps/admin` |
| `npm run test:chrome` | Smoke completo em **Chrome real** (não headless), extensão carregada de verdade | Depois de qualquer mudança na extensão — obrigatório, não opcional |
| `npm run test:all:clean` | Tudo acima, em sequência, a partir de `automation:clean` | Antes de PR/merge/release — ver `docs/release-checklist.md` |

Este projeto **não usa** suíte de testes headless para a extensão (Playwright com Chromium real,
sim; simulação de DOM tipo jsdom, não) — Manifest V3 + Shadow DOM + content scripts têm
comportamento real de browser demais para confiar em um DOM simulado.

## Antes de rodar qualquer automação da extensão

```bash
npm run automation:clean
```

Obrigatório (regra de `AGENTS.md`). Remove profile de Chrome, build e pacote gerados
anteriormente — sem isso, um teste "passa" contra um bundle antigo que não reflete o código
atual, ou trava com `EBUSY` num perfil de Chrome de teste que ficou aberto de uma run anterior
(aconteceu nesta sessão: dois processos de Chrome de teste ficaram vivos depois de uma falha,
travando o profile até serem encerrados manualmente por PID — nunca com um `taskkill` genérico,
que mataria o Chrome pessoal de quem está rodando).

## O que rastrear em cada mudança de comportamento

Testes cobrem comportamento; não cobrem sozinhos o resto que `AGENTS.md` também exige revisado a
cada PR (tutorial/FAQ, textos PT-BR/EN/ES, mídia, documentação — ver
`docs/release-checklist.md` seção 1). Um `test:all:clean` verde não significa que a mudança está
completa nesse sentido mais amplo.

## Testes ausentes conhecidos (gaps, não "esquecidos")

- Sem cobertura automatizada para **integrações externas** (porque nenhuma existe ainda — ver
  `docs/integrations.md`).
- Sem teste de **acessibilidade automatizado** (WCAG) em nenhuma das três aplicações — auditoria
  visual manual até este ponto.
- Carga/performance e segurança do backend: a suíte existe (seção "Segurança e carga do backend"
  abaixo), mas até 2026-10-22 só rodou contra o mock local. Não há projeto Supabase de teste
  separado nem Docker nesta máquina, então nenhum número de latência ou resultado de segurança do
  backend REAL foi medido ainda.

## Scripts de smoke "ao vivo" (fora do `test:all:clean`)

`backend:test:live`, `backend:test:commerce`, `backend:test:admin`, `verify:cineluna` exigem
credenciais/serviços reais isolados (ambiente de teste do Supabase/Stripe, não produção) e não
rodam automaticamente — precisam do ambiente correto configurado por quem for rodar. Nunca use
dado ou segredo produtivo para fabricar uma aprovação (regra explícita de `AGENTS.md`).

## Segurança e carga do backend (Fase 3)

Dois conjuntos sem dependência nova (Node 24: `fetch`, `node:test`, `node:http`), em
`scripts/backend-security/` e `scripts/backend-load/`.

| Comando | Alvo | O que prova |
|---|---|---|
| `npm run test:security:local` | Mock local (`mock-edge-server.mjs`) | A suíte funciona: cerca de 1400 casos verdes contra o mock e, em seguida, um autoteste de mutação em que a mesma suíte precisa FALHAR contra 7 mocks com vulnerabilidades injetadas de propósito (sem checagem de host, stack trace no corpo, CORS refletindo qualquer Origin, corpo `null` virando 500, membro removido recebendo o canal, sem limite de tamanho, SQL injection virando 500) |
| `npm run test:load:local` | Mock local | Os 3 cenários passam nos limiares e o autoteste confirma que os limiares reprovam um alvo lento (300 ms) e um limitador desligado |
| `npm run test:vouchers:db` (também dentro de `npm test`) | Postgres real em processo (PGlite) montado por `schema.sql` e por todas as migrations | As regras de voucher executando o SQL de verdade: restrição por domínio de e-mail (`voucher_domain_not_allowed`), e-mail não confirmado recusado, domínios parecidos recusados, lista vazia aceita qualquer e-mail, CHECK de `allowed_email_domains` e privilégios das funções |
| `npm run test:security:rls` (também dentro de `npm test`) | `supabase/schema.sql` | Toda tabela `public` com RLS, nenhuma policy `using (true)` fora do catálogo público (`features`, `plan_features`, `app_versions`, `store_listing_status`, `legal_registration`, `feature_flags`), toda função `security definer` com `set search_path` e sem `EXECUTE` padrão para `PUBLIC` (exceções justificadas no script) |
| `npm run test:security` / `npm run test:load` | Supabase local ou projeto de TESTE separado | O comportamento real das Edge Functions |

**O mock não é o backend.** Ele emula os contratos lidos do código de cada função (ordem de
validação, status e códigos de erro, cabeçalhos de `_shared/http.ts`, limites de taxa, regras da
sala do Multi Testador). Verde no mock prova que a suíte pega o que diz pegar; não prova que a
produção se comporta igual. Para isso é preciso rodar contra um alvo real.

### O que a suíte de segurança cobre

Para cada função em `supabase/functions/*/index.ts` (um teste falha se aparecer função nova sem
especificação): preflight e POST com Origin não permitida (403, sem `Access-Control-Allow-Origin`),
métodos diferentes de POST (405), Bearer ausente, forjado, `alg: none`, expirado e lixo (401),
segredo do keep-alive e assinatura do Stripe forjados, content type errado (415), corpo acima do
limite de cada função em bytes, inclusive multibyte (413) e exatamente no limite (não 413), JSON
malformado (400), raiz JSON que não é objeto, chaves `__proto__`/`constructor`, e valores hostis
(SQL injection, filtro PostgREST, traversal, markup, unicode e caracteres de controle, tipos
errados) em todo campo string. O status esperado de cada caso vem do código
(`scripts/backend-security/contracts.mjs` cita arquivo:linha). Invariantes em todas as respostas:
nunca 5xx, nunca stack trace, erro SQL ou segredo no corpo, erro sempre no formato
`{"error": "codigo"}` com os cabeçalhos de segurança.

Autorização: sala do Multi Testador de ponta a ponta (não host aprovando, removendo, rejeitando ou
encerrando; pedido pendente sem lista, canal ou código; código visível só para o host; limite de 4;
removido e rejeitado sem canal e sem poder pedir de novo; troca de época do canal ao remover; chat
de quem não é membro, de pendente e de removido; `roomId` de outra sala; texto acima de 500
caracteres e só com caracteres de controle; sala encerrada com código morto), `account-delete`
recusando chave para apagar outra conta, `admin-email-otp` negado a usuário comum.

### Bloqueio de produção (regra do fundador)

`scripts/backend-security/target-guard.mjs` roda antes de qualquer requisição nos dois conjuntos e
falha fechado (código de saída 2, "No request was sent"):

- `127.0.0.1`, `localhost` e `::1` são sempre permitidos;
- um alvo remoto só passa se for exatamente `https://<ref>.supabase.co` com o ref declarado em
  `QTS_TEST_SUPABASE_PROJECT_REF`, a URL igual a `QTS_TEST_SUPABASE_URL` e a flag
  `--i-own-this-test-target`;
- o projeto de produção (`xhusvkylbouwtpcevgri`, e qualquer ref embutido na extensão publicada) é
  recusado mesmo com a flag, inclusive escondido em caminho, query, maiúsculas ou percent-encoding;
- qualquer outro host é recusado; as requisições usam `redirect: "manual"`, então um
  redirecionamento não leva o tráfego para fora do alvo aprovado;
- carga remota tem teto de 200 VUs e 10 minutos.

Esses casos têm teste próprio em `scripts/backend-security/test-backend-security-tools.mjs`
(dentro de `npm test`).

### Rodar contra um projeto Supabase de TESTE separado (quando existir)

Nunca use produção nem segredo produtivo. Num projeto de teste com as migrations e as Edge
Functions publicadas e usuários de teste criados (`supabase/seed-test-users.mjs`):

```bash
export QTS_TEST_SUPABASE_URL=https://<ref-de-teste>.supabase.co
export QTS_TEST_SUPABASE_PROJECT_REF=<ref-de-teste>
export QTS_TEST_IDENTITIES_FILE=/caminho/fora-do-repo/identities.json   # segurança
export QTS_TEST_LOAD_USERS_FILE=/caminho/fora-do-repo/load-users.json   # carga
export QTS_TEST_ALLOWED_ORIGIN=https://<origem-permitida>               # opcional, CORS positivo
export QTS_TEST_SUPABASE_ANON_KEY=<chave publica do projeto de teste>   # opcional, header apikey
npm run test:security -- --i-own-this-test-target
npm run test:load -- --i-own-this-test-target --scenario=all
```

- `identities.json`: `{"plain": {"email", "password"}, "host": ..., "guests": [4 contas],
  "outsider": ..., "noPlan": ..., "founder"?: ..., "expiredToken"?: "<jwt antigo>"}`. `host`,
  `guests` e `outsider` precisam do plano Release Manager; `noPlan` sem plano. Cada entrada aceita
  `{accessToken, userId}` no lugar de e-mail e senha. Papel ausente: os casos dele aparecem como
  **skipped** (nunca como aprovados).
- `load-users.json`: lista de contas Release Manager (`--rooms=R` precisa de 4R contas).
- `--allow-destructive` libera `cancel-access` com token real (revoga o plano do usuário de teste).
  Sem ela, esse caso é pulado no alvo remoto.
- Com Docker: `npm run backend:test:start` e `--target=http://127.0.0.1:54321` (sem flag).
- Limite de taxa real: as funções autenticadas aplicam a cota ANTES de validar o corpo (por exemplo
  `account-delete` 5 por hora por usuário). Contra alvo real, os casos que bateram em 429 contam
  como "masked by rate limit" no fim da execução: só provam que o limitador respondeu. O mock da
  suíte de segurança roda com cotas multiplicadas por 1000 para exercitar a validação; a suíte de
  carga local usa as cotas reais.

### Como ler os relatórios

- Segurança: saída do `node:test` (spec). Cada falha mostra função, caso, status esperado e
  recebido e o começo do corpo. A linha `# masked by rate limit` lista quantos casos por função só
  viram 429.
- Carga: por cenário, uma tabela com `count`, `rps`, `p50/p95/p99/max` em ms, `err%` e o
  histograma de status, mais as checagens funcionais (por exemplo "429 a partir da 11a tentativa
  por e-mail" e "todo membro continuou ativo numa sala aberta de 4"). `RESULT ...: FAIL` lista o
  limiar ou a checagem que reprovou e o processo sai com 1. O JSON completo fica em
  `artifacts/load-reports/` (ignorado pelo Git). Limiares padrão: `p95<800`, `p99<1500`,
  `error_rate<0.01`; troque com `--threshold="p95<500"` (repetível, aceita prefixo de métrica como
  `multi-tester.state:p95<500`). Outras opções: `--vus`, `--duration=20s`, `--ramp-up=5s`,
  `--think-ms`, `--rooms`, `--scenario`, `--report=caminho.json`.
