# Configuração manual no Supabase Web

Use [`complete_web_setup.sql`](./complete_web_setup.sql) quando a CLI não tiver permissão de gerenciamento no projeto. O arquivo agora é idempotente e aceita o cenário em que `public.profiles` já existe, sem apagar os registros atuais.

1. Abra **Supabase Dashboard → SQL Editor → New query**.
2. Cole novamente o arquivo completo atualizado e clique em **Run**. Ele pode ser reexecutado com segurança pelos objetos conhecidos deste projeto.
3. Confirme que as consultas finais listam as tabelas com `rowsecurity` e `forcerowsecurity` habilitados, as tabelas de indicação e os recursos dos planos `free`, `pro` e `scale`.
4. Se ocorrer qualquer erro, a transação faz rollback. Copie a mensagem antes de tentar novamente.

A verificação de `FORCE ROW LEVEL SECURITY` consulta `pg_catalog.pg_class.relforcerowsecurity`. `pg_tables` não possui uma coluna chamada `forcerowsecurity`. As validações obrigatórias agora executam antes do `commit`, de modo que uma instalação incompleta não é confirmada.

O SQL configura schema, papéis, triggers, funções SQL, RLS, grants e catálogo. Ele não usa `DROP TABLE`, `TRUNCATE` ou `CASCADE`. Se uma tabela existente tiver estrutura incompatível, a transação falha e faz rollback com os dados preservados.

Ele **não consegue** publicar Edge Functions, gravar Edge secrets, criar webhook Stripe nem configurar GitHub Actions. Isso exige acesso do proprietário ou um `SUPABASE_ACCESS_TOKEN` pessoal. Nunca exponha esse token ou qualquer secret.
