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
- **Override de user-agent restrito ao Breakpoint Viewer** (`declarativeNetRequestWithHostAccess`,
  ver `docs/permissions.md`): a emulação de celular usa só regras de **sessão**
  (`updateSessionRules`), nunca regras dinâmicas ou estáticas. Cada regra é limitada a
  `tabIds: [aba do viewer]` + `resourceTypes: ["sub_frame"]` + `urlFilter: "__qtsbpua=1^"`, então
  só o iframe phone marcado recebe os headers `user-agent`/`sec-ch-ua-mobile`/`sec-ch-ua-platform`
  de Android; nunca o `main_frame`, outras abas, a página real embaixo do viewer ou a navegação
  normal. A regra é removida ao fechar o viewer, Esc, desligar o toggle, trocar de device,
  navegar para outra URL ou fechar a aba, no logout ou mudança de escopo (o `disable` não exige sessão ativa), e numa varredura em `onStartup`/`onInstalled`. Session rules
  vivem em memória do navegador e somem no shutdown e no update da extensão: nada é persistido em
  disco. `declarativeNetRequestFeedback` não é solicitada, então a extensão não observa quais
  requisições casaram. O content script `src/pagebridge/mobile-emulation.js` roda no MAIN world
  (`document_start`, `allFrames`), mas fica inerte em qualquer frame cuja URL não tenha o marcador
  `__qtsbpua=1`; só no iframe phone ele sobrescreve `navigator.userAgent`/`platform`/
  `maxTouchPoints`, `screen.*` e `matchMedia` de `pointer`/`hover`. A alternativa `debugger`
  (CDP) foi rejeitada por exibir banner de depuração e pelo risco na revisão da Chrome Web Store.

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
- **Multi Testador: única conexão direta extensão para Supabase** (ADR 0003, decisão D3). O service
  worker abre o WebSocket do Supabase Realtime com a chave pública `anon` (feita para ir no cliente;
  não dá acesso a nada sozinha) e o JWT do próprio usuário, sempre em canal **privado** `mt:<sala>`.
  As policies em `realtime.messages` só liberam broadcast/presence para membro ativo de sala aberta,
  não expirada e não ociosa (`public.mt_can_use_channel`). `mt_rooms`/`mt_members` têm RLS sem
  nenhuma policy e sem grant para `anon`/`authenticated`: só a Edge Function `multi-tester` (service
  role) escreve, e é ela que aplica plano Release Manager (mesmo `resolveAccess` do
  `access-status`, revalidado a cada 5 min durante a sessão), limite de 4 (atômico, em
  `mt_set_member_status` com a sala travada), aprovação só pelo host, expiração por
  duração/inatividade e troca do código ao encerrar. O Realtime autoriza o socket no `phx_join` e
  guarda a decisão durante a conexão; por isso o tópico é `mt:<sala>:<época>` e a época é trocada a
  cada remoção, saída e encerramento: quem saiu fica num tópico morto na hora, sem esperar o JWT
  expirar. **Chat e os votos do consenso** (`vote-request`, `vote`, `vote-result`, Fase MT2) só são
  publicados pela Edge Function, com o remetente vindo do JWT verificado e o papel conferido em
  `mt_members` (só o host pede e anuncia o resultado; só convidado ativo vota). A policy de insert
  recusa esses quatro eventos vindos de cliente (migration
  `20261023120000_multi_tester_votes_policy.sql`, replicada em `schema.sql`), então ninguém aprova
  em nome de outro testador. **Risco aceito e documentado no ADR 0003:** cursor, clique, presence e
  as propostas do convidado (`proposal`/`proposal-done`) são enviados pelos próprios clientes; um
  membro ativo com um cliente próprio consegue declarar outro `from` nesses eventos (mover o
  "cursor" de outro membro, criar uma proposta em nome de outro). Não dá acesso a nada, não sai da
  sala, não executa nada (o host sempre age por conta própria) e não afeta chat nem votos. O código da sala só
  aparece para o host e sozinho não dá acesso (gera pedido pendente); quem não é membro ativo recebe
  só o próprio status, sem lista de membros nem canal. Nenhum e-mail é trocado entre usuários: só o
  apelido. Recomendado em produção: desligar "Allow public access" do Realtime para que só canais
  privados existam.

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
