# Política de segurança

Relate vulnerabilidades exclusivamente pelo recurso **Security → Report a vulnerability** do GitHub. Não abra issue pública e não inclua credenciais, payloads capturados, dados pessoais, screenshots privadas ou exports da extensão.

## Baseline

- permissões de host opcionais e com menor privilégio;
- nenhum código executável remoto, `eval` ou permissão de depuração;
- dados operacionais local-first e redaction antes de export/log;
- autorização server-side, RLS deny-by-default e secrets somente nas Edge Functions;
- CI com scan do repositório, testes, auditoria de dependências e inspeção do bundle final;
- releases reproduzíveis a partir de commit revisado, com checksum SHA-256.

Se um segredo for exposto, removê-lo do arquivo não basta: revogue/rotacione imediatamente, verifique logs de uso e só depois limpe o histórico Git.
