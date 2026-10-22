# Guia de backup do Supabase (reutilizável em qualquer projeto)

Guia para configurar, testar e restaurar backups de um banco Supabase. Foi escrito para este
projeto, mas não depende dele: copie este arquivo e o workflow
`.github/workflows/supabase-backup.yml` para outro repositório e siga os passos.

## 1. Qual opção usar

| Plano do Supabase | Backup automático do próprio Supabase | O que fazer |
|---|---|---|
| Free | Não existe | Use o workflow do GitHub Actions deste guia (seção 2). |
| Pro ou acima | Diário, guardado por 7 dias (Pro) ou mais (planos maiores) | Já vem ligado. Opcional: PITR (restauração para qualquer minuto) é um add-on pago. Mesmo assim, vale manter o workflow como cópia fora do Supabase. |

Como descobrir o plano: painel do Supabase, Organization > Billing. Pela API:
`GET https://api.supabase.com/v1/organizations/<org_id>` devolve `"plan"`.

Regra de ouro: backup que nunca foi restaurado não é backup. Faça o teste da seção 5 pelo menos
uma vez por mês.

## 2. Backup diário gratuito com GitHub Actions

O workflow roda todo dia às 03:00 (horário de Brasília), gera três arquivos (roles, schema e
dados, o formato que o guia oficial de restauração do Supabase usa), compacta, **criptografa com
AES-256** e guarda como artefato do GitHub por 30 dias.

Por que criptografar: em repositório **público**, qualquer pessoa logada no GitHub consegue baixar
os artefatos dos workflows. Sem criptografia, o banco inteiro (inclusive dados de usuários) ficaria
exposto. Em repositório privado a criptografia continua recomendada.

### Passo a passo

1. Copie `.github/workflows/supabase-backup.yml` para o mesmo caminho no outro repositório.
2. Pegue a connection string do banco: painel do Supabase > botão **Connect** > aba
   **Session pooler** > copie a URI e troque `[YOUR-PASSWORD]` pela senha do banco. (Se não sabe a
   senha: Project Settings > Database > Reset database password. Isso derruba conexões abertas que
   usam a senha antiga.)
3. Gere uma frase-senha longa (24 caracteres ou mais), por exemplo no gerenciador de senhas
   (KeePassXC: "Gerar senha", 32 caracteres). **Guarde no gerenciador de senhas**: sem ela, nenhum
   backup pode ser aberto.
4. Cadastre os dois secrets no repositório (Settings > Secrets and variables > Actions >
   New repository secret), ou pelo terminal, colando o valor quando o comando pedir:
   ```
   gh secret set SUPABASE_DB_URL
   gh secret set BACKUP_PASSPHRASE
   ```
5. Rode uma vez na mão para conferir: aba **Actions** > "Supabase backup" > **Run workflow**, ou
   `gh workflow run "Supabase backup"`. Ao terminar, o artefato
   `supabase-backup-<data>` aparece na página da execução.

Se faltar um secret, o workflow falha com uma mensagem dizendo qual falta.

## 3. Backup manual na hora (antes de uma migration arriscada)

Com o Supabase CLI e Docker instalados:

```
npx supabase db dump --db-url "<connection string>" -f roles.sql --role-only
npx supabase db dump --db-url "<connection string>" -f schema.sql
npx supabase db dump --db-url "<connection string>" -f data.sql --use-copy --data-only
```

Sem Docker, rode o workflow da seção 2 na mão (`gh workflow run "Supabase backup"`) e espere ele
terminar antes de aplicar a migration. Guarde os arquivos fora do repositório (pasta ignorada pelo
git ou gerenciador de arquivos criptografado).

## 4. Restaurar

1. Baixe o artefato desejado (página da execução no GitHub > Artifacts) e extraia o `.zip`.
2. Descriptografe e confira a integridade:
   ```
   gpg --batch --pinentry-mode loopback --passphrase "<frase-senha>" -d supabase-backup-<data>.tar.gz.gpg > backup.tar.gz
   sha256sum backup.tar.gz   # deve bater com o conteúdo do arquivo .sha256
   mkdir backup && tar -xzf backup.tar.gz -C backup
   ```
   (No Windows, use o Git Bash; o gpg vem junto com o Git for Windows.)
3. Restaure num banco de destino (de preferência um projeto novo ou um Supabase local, nunca direto
   por cima de produção sem antes ter outro backup):
   ```
   psql --single-transaction --variable ON_ERROR_STOP=1 \
     --file backup/roles.sql --file backup/schema.sql \
     --command 'SET session_replication_role = replica' \
     --file backup/data.sql \
     --dbname "<connection string do destino>"
   ```
   `session_replication_role = replica` desliga triggers durante a carga dos dados, evitando que
   eles rodem de novo sobre dados que já são o resultado deles.
4. Confira: contagem de linhas das tabelas principais, login de um usuário de teste, as Edge
   Functions apontando para o projeto certo.

O que o dump **não** leva: arquivos do Storage (objetos), Edge Functions (estão no git), secrets
das funções e configurações do painel (Auth providers, URLs, Realtime). Anote essas configurações
num documento do projeto.

## 5. Teste mensal de restauração (10 minutos)

1. `npx supabase start` (Supabase local, precisa de Docker).
2. Restaure o backup mais recente no banco local (seção 4, passo 3, usando a URL local
   `postgresql://postgres:postgres@127.0.0.1:54322/postgres`).
3. Confira que as tabelas principais têm dados e que as policies de RLS existem.
4. `npx supabase stop`.

## 6. Checklist para um projeto novo

- [ ] Plano verificado (seção 1).
- [ ] Workflow copiado e os dois secrets cadastrados.
- [ ] Frase-senha guardada no gerenciador de senhas.
- [ ] Primeira execução manual com sucesso e artefato baixável.
- [ ] Restauração testada uma vez (seção 5).
- [ ] Configurações do painel anotadas (o dump não leva).
- [ ] Antes de toda migration em produção: backup manual (seção 3) ou execução manual do workflow.
