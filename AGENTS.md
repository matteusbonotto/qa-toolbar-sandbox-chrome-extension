# Instruções obrigatórias para agentes de IA

## Mapa de documentação operacional

Não duplique conteúdo já documentado em outro lugar — atualize a fonte certa em vez de escrever uma
segunda versão aqui. Este arquivo é sobre **como um agente deve se comportar** neste repositório;
o "o quê"/"onde" de cada parte já tem dono:

| Pergunta | Onde está a resposta |
|---|---|
| Como rodo/testo/empacoto/publico cada coisa? | `COMMANDS.md` |
| Como o ecossistema (Extensão/Landing/Admin/Backend) se conecta, e quais são os riscos abertos? | `docs/ecosystem-audit.md` |
| Stack, pastas, como rodar cada app localmente? | `docs/architecture.md` |
| Como cada camada de teste funciona e quando rodar cada uma? | `docs/testing-strategy.md` |
| Por que cada permissão da extensão existe? | `docs/permissions.md` |
| Como as superfícies são protegidas (extensão/backend/RLS)? | `docs/security.md` |
| Como migrar `chrome.storage` do workspace ou o banco Supabase? | `docs/migration-strategy.md` |
| Planos, feature flags, matriz de ferramentas por plano? | `docs/plans.md` |
| Decisões arquiteturais com contexto/trade-offs (ADR)? | `docs/adr/` — não crie uma pasta paralela (`docs/decisions/` etc.); um ADR novo entra aqui, numerado em sequência. |
| Auditorias já feitas (segurança, UX, sistêmica) e seus achados? | `docs/` (arquivos com data no nome, ex. `docs/UX_VISUAL_AUDIT_2026-07-28.md`) — verifique a data e se não foi superado por um doc mais novo antes de confiar nele. |

## Autoridade de produto

As afirmações do fundador/usuário sobre comportamento, regra ou critério de aceite são a fonte
prioritária das regras de negócio. Registre-as no checklist/requisito correspondente. Não substitua
uma regra afirmada pelo usuário por preferência técnica, comportamento histórico ou teste antigo.
Se um teste contradisser a regra afirmada, o teste está desatualizado até que o comportamento seja
validado de novo.

## Antes de automatizar

1. Execute `npm run automation:clean`.
2. Recrie builds e pacotes a partir do worktree atual.
3. Use perfil Chrome descartável; não reutilize perfil manual.
4. Registre no log versão e fingerprint do código carregado.
5. Falhe se o perfil/build não puder ser apagado. Nunca continue usando cache anterior.
6. Um teste que apenas encontra código, abre uma aba ou confirma ausência de exceção não comprova
   a regra visual. Valide o resultado real no DOM/estilo/estado e, quando relevante, salve evidência.

## Mudanças de produto

Não use travessão em nenhum texto, tradução, título, placeholder, documentação ou comentário da
Landing Page, Admin e extensão. Prefira ponto, vírgula, dois-pontos, parênteses ou hífen conforme o
contexto. A verificação de repositório deve falhar se esse caractere reaparecer nesses aplicativos.

Toda PR que alterar comportamento, UI, regra, plano, flag ou fluxo deve revisar e atualizar, quando
afetados:

- testes unitários, integração e smoke;
- tutorial, tour contextual e FAQ;
- textos PT-BR, EN e ES;
- screenshots e vídeos, recriados com pausas legíveis e sem mídia antiga;
- documentação de features, planos, flags e regras de negócio;
- versão da extensão e notas de release;
- Landing Page, Admin, extensão e backend para consistência transversal;
- critérios mobile, tema claro/escuro, acessibilidade, impressão e console/worker sem erros.

Não incremente versão nem regenere mídia sem mudança correspondente, mas nunca deixe artefatos
desatualizados quando a mudança os afetar.

## Validação e relato

Antes de PR, merge ou subida, execute `npm run test:all:clean`. Além do resultado das suites,
liste explicitamente:

- bugs, erros, defeitos e regressões encontrados;
- regras de negócio ainda divergentes;
- testes ausentes ou incapazes de provar o critério;
- evidências produzidas e artefatos atualizados;
- qualquer validação não executada e o motivo.

Smoke de LP/Admin é obrigatório via `npm run smoke:lp-admin`; smoke da extensão é obrigatório via
`npm run test:chrome`. Testes live que exigem credenciais/serviços isolados devem rodar no ambiente
de teste apropriado. Nunca use dados ou segredos produtivos para fabricar uma aprovação.

Nenhum deploy, publicação na Chrome Web Store, merge, Stripe ou Supabase produtivo é autorizado
apenas porque os testes passaram. Essas ações exigem autorização explícita do usuário.

## Regras do agente

1. Nunca altere arquitetura sem antes mapear o impacto (quem consome, o que quebra).
2. Nunca remova código sem verificar seus consumidores (grep pelo símbolo, não só pelo arquivo).
3. Nunca adicione dependência nova sem justificar por escrito (por que essa lib, por que não código
   nativo, tamanho, manutenção).
4. Nunca aumente permissão/host_permission da extensão sem revisão de segurança e atualização de
   `docs/permissions.md` na mesma mudança.
5. Nunca altere schema (banco, workspace, planos, feature flags) sem migration correspondente.
6. Toda migration nova em `supabase/migrations/` que deveria valer para "projeto novo do zero"
   precisa ser replicada em `supabase/schema.sql` **na mesma PR** — os dois já divergiram de verdade
   antes (uma policy de RLS corrigida em produção via migration, nunca replicada em `schema.sql`,
   reintroduzindo a mesma vulnerabilidade em qualquer bootstrap novo). Ver `docs/migration-strategy.md`.
7. Nunca altere um contrato de API/Edge Function sem verificar todos os consumidores (extensão,
   Landing, Admin, Stripe webhook).
8. Nunca considere um bug resolvido sem teste de regressão cobrindo o cenário exato que falhava.
9. Nunca ignore console errors/erros de service worker, mesmo que a funcionalidade "pareça"
   funcionar.
10. Nunca use timeout como solução para race condition sem investigar e documentar a causa real —
    todo `setTimeout`/`setInterval` com número mágico precisa de um comentário explicando por que
    aquele valor existe.
11. Nunca corrija apenas o sintoma quando a causa raiz for corrigível no mesmo esforço.
12. Sempre execute os testes relevantes (ver `COMMANDS.md`/`docs/testing-strategy.md`) antes de
    concluir uma tarefa.
13. Sempre atualize a documentação afetada quando uma decisão arquitetural mudar (ver **Deriva de
    documentação** abaixo).
14. Nunca presuma que o service worker da extensão fica sempre vivo entre eventos.
15. Nunca presuma que o DOM da página host é estático (SPA, re-render, remoção de nó).
16. Nunca presuma que o usuário tem uma única aba/janela aberta.
17. Nunca presuma que a extensão instalada está na última versão (workspace pode vir de
    `schemaVersion` antigo).
18. Nunca presuma que o usuário está online (backend pode estar indisponível, timeout, resposta
    inválida).

## Workflow do agente

Nenhuma tarefa não trivial começa editando arquivo direto. Siga, nesta ordem:

```
READ → UNDERSTAND → INSPECT → PLAN → IMPLEMENT → TEST → REVIEW → DOCUMENT
```

- **READ/UNDERSTAND**: leia o pedido e a documentação relevante (tabela acima) antes do código.
- **INSPECT**: leia o código real — a documentação pode estar desatualizada (ver **Deriva de
  documentação**).
- **PLAN**: para mudança MODERATE ou HIGH RISK (ver classificação abaixo), alinhe o plano antes de
  implementar.
- **IMPLEMENT → TEST → REVIEW → DOCUMENT**: implemente, rode os testes relevantes, revise o próprio
  diff, e só então atualize a documentação afetada.

### Workflow de bug

```
REPRODUCE → ISOLATE → ROOT CAUSE → FIX → REGRESSION TEST → VERIFY
```

Um bug encontrado durante a investigação de outra coisa entra no inventário/relatório da tarefa —
não interrompa o trabalho em andamento para corrigi-lo imediatamente, **exceto** quando houver razão
de segurança ou risco grave (dado real de usuário exposto, escalonamento de privilégio, perda de
dinheiro/dado). Nesse caso, sinalize explicitamente antes de agir.

### Workflow de feature

```
UNDERSTAND REQUIREMENT → CHECK EXISTING ARCHITECTURE → CHECK IMPACT → DESIGN → IMPLEMENT → TEST → REVIEW
```

## Classificação de risco da mudança

Classifique toda mudança não trivial antes de implementar:

- **SAFE** — local, sem impacto arquitetural (texto, estilo isolado, correção de um bug sem tocar
  contrato/schema/permissão).
- **MODERATE** — afeta múltiplos componentes (ex.: campo novo em `FEATURE_REGISTRY`, nova página no
  Admin, novo endpoint interno de Edge Function sem mudar autenticação).
- **HIGH RISK** — qualquer mudança em: `apps/extension/manifest.json` (permissions/host_permissions),
  policy de RLS ou função `security definer` no Postgres, `schemaVersion` do workspace,
  contrato de uma Edge Function já consumida por outra ponta, processo de release/publicação na
  Chrome Web Store, ou qualquer coisa que toque autenticação/autorização/dinheiro (Stripe, vouchers,
  reward points, licenças).

Mudança HIGH RISK exige plano revisado antes da implementação e, na validação, execução completa de
`npm run test:all:clean` — nunca só a suíte mais rápida.

## Deriva de documentação

O código é a fonte de verdade; a documentação é a explicação de por que o código é como é. Quando
os dois divergirem:

1. Confirme qual está certo lendo o código real (nunca assuma que a doc está correta só porque
   parece razoável).
2. Se o código estiver certo e a doc errada, atualize a doc na mesma mudança que você já está
   fazendo — não deixe para depois.
3. Se a doc revelar um comportamento pretendido que o código não implementa, isso é um bug — trate
   pelo workflow de bug acima, não silenciosamente "corrija a doc para bater com o código errado".
4. Nunca deixe duas fontes afirmando coisas contraditórias sobre a mesma regra depois da sua PR.

## Memória do projeto e decisões arquiteturais

Decisões arquiteturais com contexto/trade-offs vão para `docs/adr/NNNN-titulo.md` (formato: contexto,
problema, opções consideradas, decisão, motivo, trade-offs, consequências, data) — siga o padrão de
`docs/adr/0001-extension-auth-session-and-url-scope.md`. Não crie uma estrutura paralela.

Documentação de arquitetura/auditoria deve explicar não só **o que** o sistema faz, mas **por que**
é assim — principalmente quando a resposta é "por causa de uma limitação técnica específica" (ex.:
por que a extensão não usa bundler, por que `toolbar.js` é um arquivo único). Um agente novo que só
lê "o que" tende a "corrigir" uma decisão deliberada achando que é acidente.

## Checklist final antes de considerar uma fase de trabalho concluída

```
[ ] Código implementado e funcionando (verificado ao vivo, não só ausência de exceção)
[ ] Testes relevantes rodando e verdes (COMMANDS.md indica quais)
[ ] Nenhum console error/erro de service worker novo
[ ] Documentação afetada atualizada (tabela do topo deste arquivo indica onde)
[ ] Migration de banco replicada em schema.sql, se aplicável
[ ] Textos PT-BR/EN/ES revisados, se a mudança afetou UI
[ ] Bugs/regras divergentes encontrados durante o trabalho, listados no relato (não corrigidos
    silenciosamente, exceto risco grave de segurança)
[ ] Nenhuma ação de deploy/publicação/produção tomada sem autorização explícita
```
