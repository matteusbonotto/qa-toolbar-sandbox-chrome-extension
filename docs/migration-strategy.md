# Estratégia de migration — QA Toolbar Sandbox

Duas migrations completamente diferentes coexistem neste projeto — não confundir as duas.

## 1. Workspace da extensão (`chrome.storage.local`, no navegador do usuário)

Cada workspace salvo tem um `schemaVersion` (hoje **15**). Não existe "banco" aqui — é
JSON local, um por instalação, migrado silenciosamente na leitura, nunca destrutivamente.

### Como adicionar uma ferramenta nova ao schema (passo a passo real, feito 3× nesta sessão)

1. Registre em **`FEATURE_REGISTRY`**, nos **dois arquivos** (`apps/extension/src/lib/storage.js`
   *e* `storage-content.js` — são gêmeos porque content scripts clássicos não suportam `import`;
   um script (`scripts/test-extension-workspace.mjs`) compara os dois por regex e falha se
   divergirem):
   ```js
   ["novaFerramenta","Nome Público","novaFerramentaMenuItem","iconeExistente",""]
   ```
   O último campo é a `planFeature` (`"chave.enabled"`) se for gated por plano, ou `""` se
   disponível em todo plano.
2. Adicione `const SCHEMA_N_TOOLS = ["novaFerramenta"];` (N = versão nova) nos dois arquivos.
3. No corpo de `normalizeWorkspace`, adicione o bloco de migração nos dois arquivos:
   ```js
   if (Number(source.schemaVersion || 0) < N) {
     for (const tool of SCHEMA_N_TOOLS) if (!normalizedEnabledTools.includes(tool)) normalizedEnabledTools.push(tool);
   }
   ```
4. Bump `schemaVersion: N` em **dois lugares por arquivo**: `createEmptyWorkspace()` e o objeto
   de retorno de `normalizeWorkspace()` — quatro ocorrências no total entre os dois arquivos.
5. Atualize `scripts/test-extension-workspace.mjs`: o `assert.equal(workspace.schemaVersion, N)`
   e qualquer `enabledTools` esperado em teste de migração de versão antiga — a ferramenta nova
   precisa aparecer na lista esperada.
6. Verifique se algum outro script tem uma asserção própria contra o `schemaVersion` antigo
   (aconteceu nesta sessão: `scripts/test-update-experience.mjs` tinha um `assert.match(storage,
   /schemaVersion:\s*13/)` isolado, que ninguém lembrou de atualizar até o `test:all:clean`
   falhar). `grep -rn "schemaVersion.*[0-9]" scripts/` antes de considerar terminado.

### Garantias que este padrão preserva

- **Nunca apaga dado do usuário.** Migração só *adiciona* (ferramenta habilitada, campo com
  default), nunca remove uma entidade existente.
- **Idempotente.** Rodar a normalização duas vezes no mesmo workspace já migrado não duplica
  nem altera nada (`if (!normalizedEnabledTools.includes(tool))`).
- **Retrocompatível por padrão.** Um workspace de uma versão muito antiga (schemaVersion baixo
  ou ausente) acumula todos os blocos `< N` na ordem, chegando ao estado atual completo.

## 2. Banco de dados (Supabase/Postgres, produção)

Diferente do workspace local, **nenhuma migration de banco se aplica sozinha** — não há CI que
rode `supabase db push` automaticamente. Isso é proposital (aplicar schema em produção é uma
ação que exige decisão humana), mas significa que "a migration está no repositório" e "a
migration está em produção" são coisas diferentes até alguém rodar o passo manual.

### Fluxo

1. Escreva o arquivo em `supabase/migrations/YYYYMMDDHHMMSS_descricao.sql` — sempre idempotente
   (`create table if not exists`, `drop trigger if exists` antes de recriar, etc.), porque o
   mesmo arquivo pode ser reexecutado ao restaurar um projeto do zero via `schema.sql`.
2. Se a migration adiciona algo que `schema.sql` (o bootstrap consolidado de projeto novo)
   também deveria ter desde o início, **replique a mudança em `schema.sql` também** — os dois
   precisam concordar, senão um projeto novo criado do zero fica com um estado diferente do que
   está em produção. (Foi exatamente o tipo de bug encontrado e corrigido nesta sessão: um
   artefato de merge quebrado em `schema.sql` que travava qualquer bootstrap novo.)
3. Aplique com `npm run backend:apply-pending` (dry-run por padrão; `--apply` para escrever de
   verdade — ver `scripts/apply-pending-backend-actions.mjs`). Esse script lê
   `SUPABASE_ACCESS_TOKEN` do `.env` e `SUPABASE_PROJECT_REF` do `.env.edge.local`, mas a
   escrita em produção **sempre exige aprovação humana explícita no momento** — nem um agente de
   IA nem o próprio script contornam isso.
4. Atualize `docs/PENDENCIAS_USUARIO.md` até a migration ser confirmada aplicada (dry-run
   mostrando `"upToDate":true`).

### Rollback

Não existe rollback automático de migration de banco neste projeto — cada arquivo é
"para frente" (idempotente, aditivo). Se uma migration precisar ser desfeita, escreva uma nova
migration que reverte a anterior (nunca edite/apague o arquivo já aplicado — ele já está no
histórico do `supabase_migrations.schema_migrations` de quem já rodou).
