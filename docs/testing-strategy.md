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
- Sem teste de **carga/performance** do backend — o volume atual não justificou ainda.

## Scripts de smoke "ao vivo" (fora do `test:all:clean`)

`backend:test:live`, `backend:test:commerce`, `backend:test:admin`, `verify:cineluna` exigem
credenciais/serviços reais isolados (ambiente de teste do Supabase/Stripe, não produção) e não
rodam automaticamente — precisam do ambiente correto configurado por quem for rodar. Nunca use
dado ou segredo produtivo para fabricar uma aprovação (regra explícita de `AGENTS.md`).
