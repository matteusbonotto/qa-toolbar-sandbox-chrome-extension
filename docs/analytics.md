# Analytics — QA Toolbar Sandbox

## Estado real: métricas de negócio existem, analytics de produto não

Verificado por leitura de código nesta sessão (não suposição):

### O que já existe

`apps/admin/src/pages/DashboardPage.tsx` (`getDashboardMetrics`) mostra, derivado direto das
tabelas do Postgres:

- MRR estimado, assinaturas ativas, em trial;
- vouchers resgatados/disponíveis, licenças ativas;
- indicações qualificadas, usuários cadastrados.

São **métricas de negócio** (o que já está gravado numa tabela transacional), não telemetria de
comportamento. `audit_logs` registra ação administrativa (quem mudou o quê), não uso de produto.

### O que não existe

Nenhum evento de funil de produto é emitido em lugar nenhum do código — confirmado por busca
(`extension_opened`, `workspace_created`, `session_started`, `report_created`, `view_pricing`
etc., como listados na visão original deste ciclo de trabalho, não aparecem em
`apps/landing/src`, `apps/admin/src` nem `apps/extension/src`). Isso significa que hoje **não é
possível responder**, com dado real:

- taxa de ativação (instalou → usou de verdade);
- retenção em 1/7/30 dias;
- quais ferramentas são mais usadas (Sessão de Teste e Report Builder incluídos — não têm
  telemetria própria, só o histórico local do próprio usuário em `chrome.storage.local`, que o
  founder não vê);
- abandono de onboarding;
- conversão por plano além do que já é visível via assinaturas criadas no Stripe.

## Por que isso não foi implementado nesta sessão

Instrumentar analytics de produto do zero, feito às pressas, é exatamente onde as regras deste
projeto pedem mais cuidado, não menos:

- **Privacidade**: a lista de eventos "seguros" do PDF-fonte proíbe explicitamente enviar senha,
  token, cartão, conteúdo de request/response, conteúdo de página, dados de workspace,
  evidências e credenciais — ou seja, quase tudo que a extensão manipula. Errar essa fronteira
  uma vez é o tipo de vazamento que não dá para desfazer depois.
- **LGPD**: o produto já tem um fluxo de exclusão de conta (`account-delete`) desenhado
  especificamente para cumprir obrigação legal. Adicionar uma nova categoria de dado coletado
  sem revisar esse fluxo (o que precisa ser apagado/anonimizado junto) seria inconsistente com o
  próprio trabalho já feito.
- **Decisão de produto**: first-party (gravar evento direto no Supabase, sem terceiro) versus um
  provedor externo (GA, PostHog, Mixpanel) muda contrato de dados, custo e o que aparece na
  política de privacidade pública — não é uma escolha técnica isolada.

## Caminho recomendado, quando for priorizado

1. Tabela própria no Supabase (`product_events` ou similar) — first-party, consistente com o
   posicionamento "local-first" já comunicado na Central de Confiança (`/permissoes`).
2. Lista fechada de eventos permitidos (a do PDF-fonte é um bom ponto de partida), cada um sem
   nenhum campo de conteúdo livre — só chave/valor estruturado, nunca texto digitado pelo
   usuário.
3. ID pseudonimizado, não e-mail em texto puro.
4. Opção de desativar analytics não essenciais, exposta nas Configurações da extensão.
5. Atualizar `docs/security.md` e a política de privacidade **antes** do primeiro evento ir para
   produção, não depois.

Até essa priorização acontecer, este documento existe para deixar claro que a ausência de
funil/retenção é um gap conhecido, não um esquecimento não documentado.
