# Planos e catálogo de recursos — QA Toolbar Sandbox

## Fonte única de verdade

Não existe um catálogo separado por aplicação. As três pontas leem a mesma origem:

- **`plans`** (Postgres) — os 4 planos, chave técnica + nome público.
- **`features`** + **`plan_features`** — cada ferramenta com feature flag, e o valor por plano.
- **`stripe_prices`** — preço mensal/anual real, sincronizado com o Stripe (a Landing nunca
  hardcoda preço; corrigido nesta sessão o único ponto que ainda calculava desconto anual fora
  dessa fonte, ver `CHECKLIST_BUGFIX_PASS2.md`).
- **`apps/extension/src/lib/storage.js`** (`FEATURE_REGISTRY`) — cada ferramenta pinnable da
  barra, com a `planFeature` correspondente (ou `null` se não é gated).

Mudar disponibilidade de uma ferramenta é feito em **um lugar** — Admin → Feature flags — e
propaga para a extensão via `access-status` (cache local de até ~30s).

## Os 4 planos (chave técnica → nome público)

| Chave | Nome público | Papel |
|---|---|---|
| `smoke-test` | Smoke Test | Grátis — avaliação inicial, novos usuários |
| `regression-runner` | Regression Runner | Entrada paga |
| `root-cause-analyst` | Root Cause Analyst | Recomendado (marcado como tal na Landing) |
| `release-manager` | Release Manager | Topo — todas as ferramentas |

## Matriz de ferramentas gated por plano

(Fonte: `plan_features` via `FEATURE_REGISTRY`/`SCHEMA_N_TOOLS`. A maioria das ferramentas da
barra **não** é gated — está disponível em todo plano; só as listadas abaixo variam.)

| Ferramenta | Smoke Test | Regression Runner | Root Cause Analyst | Release Manager |
|---|---|---|---|---|
| Contador de caracteres | ✓ | ✓ | ✓ | ✓ |
| Multiclick | ✓ | ✓ | ✓ | ✓ |
| Validador de campos | — | ✓ | ✓ | ✓ |
| Auto preenchimento | — | ✓ | ✓ | ✓ |
| Macro Studio | — | — | ✓ | ✓ |
| Gravador de Passos | — | — | ✓ | ✓ |
| Key View | — | — | — | ✓ |
| Capturar Elementos | — | — | ✓ | ✓ |

Sessão de Teste e Report Builder (adicionados nesta sessão) **não são gated** — disponíveis em
todos os planos, incluindo o gratuito, por decisão consciente: são fluxo de trabalho, não
diferencial comercial pontual.

## Sobre os nomes dos planos (recomendação, não aplicada)

Os nomes (`Smoke Test`, `Regression Runner`, `Root Cause Analyst`, `Release Manager`) soam como
**papéis/personas técnicas de QA**, não como uma progressão comercial óbvia (tipo
Free/Pro/Team/Enterprise). Isso pode:

- confundir quem só quer saber "qual é o mais barato que resolve meu problema";
- funcionar muito bem, por outro lado, como diferenciação de marca para o público QA específico
  (são nomes que fazem sentido pra quem já testa software, e reforçam o posicionamento do
  produto como "workspace de QA", não uma ferramenta genérica).

**Não renomeei nada** — é uma decisão de produto/marketing, não um bug, e nomes de plano afetam
assinantes existentes (checkout, faturas, comunicação já enviada). Se decidir revisar, o caminho
seguro é manter a `chave` técnica (`smoke-test` etc.) estável no banco e só trocar `plans.name`
(o texto exibido), preservando qualquer assinatura ativa.

## Regras já em vigor (não usar dark patterns)

- Não cobrar para excluir dados (fluxo LGPD já implementado, `account-delete`).
- Não bloquear exportação do próprio usuário.
- Não anunciar "ilimitado" com limite oculto.
- Mudança de plano nunca quebra assinante existente sem grace period e comunicação — ver
  `docs/PENDENCIAS_USUARIO.md` para o histórico de mudanças já comunicadas.
