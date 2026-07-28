# Checklist de release — QA Toolbar Sandbox

> Para o mecanismo específico de publicação na Chrome Web Store (OAuth, API, atualização
> automática de instalações existentes), veja `docs/DEPLOY_CHROME_WEBSTORE.md`. Este documento é
> o checklist geral — o que revisar antes de qualquer release, não só da extensão.

## 1. Antes de abrir a PR (regra de `AGENTS.md`, não opcional)

Toda mudança que altera comportamento, UI, regra de negócio, plano, flag ou fluxo precisa
revisar e atualizar, quando afetado:

- [ ] testes unitários, integração e smoke;
- [ ] tutorial, tour contextual e FAQ (`tutorial-data.js`/`faq-data.js` na extensão);
- [ ] textos PT-BR, EN e ES nas três aplicações;
- [ ] screenshots e vídeos (`npm run tutorial:capture`), sem mídia antiga esquecida;
- [ ] documentação de features, planos, flags e regras de negócio (este `docs/`);
- [ ] versão da extensão e notas de release;
- [ ] consistência entre Landing, Admin, extensão e backend;
- [ ] mobile, tema claro/escuro, acessibilidade, impressão, console/worker sem erro.

## 2. Validação obrigatória antes de PR, merge ou subida

```bash
npm run test:all:clean
```

Isso executa, nesta ordem: `automation:clean` → `typecheck` → `test` (unitários, workspace,
release environments, update experience, reward program, GIF encoder) → `backend:check` (Deno) →
`security:repo` → `security:extension` → `smoke:lp-admin` → `test:chrome:test-package` (smoke
completo em Chrome real, pacote de teste isolado do backend de produção).

Depois de rodar, liste explicitamente (não basta dizer "passou"):

- [ ] bugs, erros, defeitos e regressões encontrados;
- [ ] regras de negócio ainda divergentes;
- [ ] testes ausentes ou incapazes de provar o critério;
- [ ] evidências produzidas e artefatos atualizados;
- [ ] qualquer validação não executada e o motivo.

## 3. Migrations pendentes

- [ ] Existe alguma migration em `supabase/migrations/` ainda não aplicada em produção? Rode
  `npm run backend:apply-pending` (dry-run por padrão) para conferir antes de assumir que está
  tudo aplicado — nenhuma migration deste projeto se aplica sozinha.
- [ ] `supabase/schema.sql` reflete o estado final pós-migrations (é o bootstrap de projeto
  novo — se ficar desalinhado do que as migrations realmente fazem, um projeto novo do zero
  quebra). Ver `docs/migration-strategy.md`.

## 4. Extensão especificamente

- [ ] `manifest.json` — versão nova? (`npm run bump:extension`)
- [ ] `docs/permissions.md` e a Central de Confiança (`/permissoes`) ainda batem com o
  `manifest.json` real, se alguma permissão mudou.
- [ ] Tamanho do bundle não voltou a crescer sem necessidade — `npm run security:extension`
  reporta o tamanho total; vídeos novos de tutorial devem passar pela compressão automática
  (`scripts/capture-tutorial-media.mjs` já recomprime, mas confira o resultado).
- [ ] `releaseNotesCopy()` (`toolbar.js`) e `showPendingReleaseNotes()` (`options.js`) descrevem
  a versão real que está saindo.

## 5. Publicação

```bash
npm run release:chrome:update   # security:repo + security:extension + test:chrome + empacota
npm run release:chrome:upload   # + envia para a Chrome Web Store (draft)
npm run release:chrome:publish  # + solicita publicação
```

Nenhum desses passos deve ser executado sem autorização explícita do founder no momento —
`AGENTS.md`: "Nenhum deploy, publicação na Chrome Web Store, merge, Stripe ou Supabase produtivo
é autorizado apenas porque os testes passaram."

Landing e Admin são publicados via GitHub Pages a partir do build (`npm run build:landing` /
`npm run build:admin`) — confirme que o deploy do Pages realmente pegou o build novo antes de
comunicar a mudança como "no ar".

## 6. Depois de publicar

- [ ] Confirmar visualmente a versão pública (Chrome Web Store, Landing, Admin) bate com o que
  foi testado — nunca assumir que "os testes passaram" implica "está no ar".
- [ ] Se a mudança afeta preço/plano, `stripe_prices` e a comunicação a assinantes existentes
  estão sincronizados (ver `docs/plans.md`).
- [ ] Atualizar `docs/PENDENCIAS_USUARIO.md` se algo ficou dependendo de uma ação manual do
  founder (deploy de Edge Function, aplicar migration, verificar domínio de e-mail, etc.).
