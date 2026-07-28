# Segurança — QA Toolbar Sandbox

> Para reportar uma vulnerabilidade, use **Security → Report a vulnerability** no GitHub — ver
> `SECURITY.md` na raiz. Este documento é a referência técnica de como cada camada é protegida;
> `docs/permissions.md` cobre especificamente as permissões da extensão.

## Superfícies e como cada uma é tratada

### Extensão (cliente distribuído publicamente)

Qualquer coisa dentro do pacote `.zip` pode ser extraída por qualquer pessoa — isso molda todo o
resto:

- **Nenhum secret no pacote.** Login e renovação de sessão passam pelas Edge Functions
  `auth-sign-in`/`auth-refresh`; a extensão nunca carrega `service_role` nem chave privada
  (ADR 0001, `docs/adr/0001-extension-auth-session-and-url-scope.md`).
- **Sem CSP customizado** no `manifest.json` — usa o padrão do Manifest V3, que já bloqueia
  `eval`, código remoto e inline script sem exceção configurável nas páginas da extensão.
- **Sem execução de código colado.** Macro Studio tem um modo "Coder" que só **exporta** um
  script Playwright para revisão/cópia — a extensão nunca executa o texto colado por um usuário.
- **Redação de dados sensíveis em captura estruturada**: `SENSITIVE_HINT` (regex em
  `lib/storage.js`) filtra `password`/`senha`/`secret`/`token`/`authorization`/`api key`/número
  de cartão/CVV antes de gravar um passo de macro ou de step recorder — o valor nunca é
  persistido, nem localmente.
- **Mascaramento de contas/pagamentos de teste**: exibidos mascarados por padrão na barra,
  revelados só sob ação explícita.
- **Escopo de host controlável**: ver `docs/permissions.md` — `<all_urls>` é o teto técnico, o
  registro real de content script é recalculado a cada mudança de workspace/escopo.

### Landing e Admin

- Autenticação via Supabase Auth; Admin exige senha + OTP por e-mail (MFA), sem self-signup.
- Reautenticação com janela curta (60 min) para ações administrativas sensíveis
  (`verify_admin_reauthentication_otp`).
- Nenhuma chamada direta a chave privada do lado do cliente — tudo que precisa de
  `service_role` roda em Edge Function ou RPC `security definer` no Postgres.

### Backend (Supabase)

- **RLS deny-by-default** em toda tabela nova — política explícita é obrigatória, não opcional.
- **`is_founder()`** é o guarda central para qualquer coisa administrativa; escrita direta via
  PostgREST numa tabela administrativa é auditada por `trg_audit_founder_mutation`
  automaticamente (a lista de tabelas cobertas está em `schema.sql`; se uma tabela nova for
  editada diretamente pelo founder, ela precisa entrar nessa lista — foi exatamente o bug
  encontrado e corrigido nesta sessão para `reward_programs`/`reward_prizes`).
- **Nenhum dado sensível em log/auditoria em texto puro.** `audit_logs` grava ator, ação,
  entidade e metadados seguros — nunca token, senha ou corpo de requisição.
- **Webhooks do Stripe são verificados por assinatura** antes de qualquer processamento
  (`stripe-webhook`).

## O que NÃO fazer (regras já estabelecidas no projeto)

- Não usar mensagens como "ignore este aviso", "não existe risco" ou "100% seguro" em texto
  público sobre permissões/segurança — ver `docs/permissions.md` e a Central de Confiança.
- Não alterar schema (banco, workspace, planos, feature flags) sem migration, validação e
  documentação — ver `docs/migration-strategy.md`.
- Não usar dados falsos/inflados em produção (contagem de usuários, avaliações, integrações
  "prontas" que ainda dependem de mock).
- Não commitar segredo algum — `npm run security:repo` escaneia todo arquivo rastreado/staged
  por padrões de segredo antes do commit (hook de pre-commit via `npm run prepare`).

## Scans automatizados

```bash
npm run security:repo       # scan de segredos + caminhos proibidos no repositório inteiro
npm run security:extension  # confirma que o pacote da extensão só contém os arquivos permitidos
```

Ambos rodam no CI e são obrigatórios antes de qualquer release (`release:chrome:*` já os inclui).

## Se um segredo vazar

Remover do arquivo **não é suficiente** — o histórico do Git continua com ele. Revogue/rotacione
a credencial imediatamente, verifique logs de uso da chave exposta, e só depois disso limpe o
histórico se necessário. (Repetido de `SECURITY.md` porque é a única regra deste documento que
vale a pena errar por excesso de repetição.)
