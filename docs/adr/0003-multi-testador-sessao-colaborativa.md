# ADR 0003: Multi Testador (sessão colaborativa de teste em tempo real)

- Status: aceito (decisões do fundador em 2026-10-22); MT1 em v1.4.42, MT2 (consenso) em v1.4.44
- Data: 2026-10-21

## Contexto

O fundador pediu uma ferramenta chamada "Multi Testador": uma sessão onde até quatro usuários
testam a mesma tela ao mesmo tempo, veem os cursores uns dos outros com nome e cor (estilo Figma ou
Miro), conversam por um chat, e onde cliques e submits de risco só executam depois da confirmação de
todos os participantes. O host cria a sala por convite, controla quem entra e pode remover, e só o
host convida. Cada sessão tem um código único que muda ao encerrar, a sala fecha por inatividade, e
o host define o tempo de sessão. As gravações passam a registrar os dois mouses e os relatórios
listam os envolvidos.

Levantamento do código atual (ver relatório de arquitetura da task que originou este ADR):

1. Não existe nenhuma camada de realtime no projeto. Nenhum uso de Supabase Realtime, WebSocket,
   Broadcast ou Presence. Seria construído do zero.
2. "Release manager" e um PLANO pago (`supabase/schema.sql`, tabela `plans`; `docs/plans.md`), nao
   um papel (`roles`/`user_roles` existem so para founder/admin). Hoje nenhum usuario enxerga outro
   usuario: nao ha descoberta de usuarios nem exposicao de identidade usuario a usuario. Expor nome
   e cursor de um release manager para outro e uma superficie de dado pessoal nova, sem precedente.
3. A extensao nunca fala direto com o Postgres. Tudo passa por Edge Functions com Bearer token, e o
   gating de acesso e validado por token assinado em ECDSA (`background/auth.js`). Qualquer regra de
   "so release manager" ou "maximo quatro pessoas" tem que ser reforcada no servidor, nunca so no
   cliente.
4. A extensao nao usa bundler e o Manifest V3 bloqueia codigo remoto. Qualquer cliente de realtime
   precisa ser vendorizado localmente no pacote e passar no allowlist de `npm run security:extension`.
5. O service worker morre entre eventos e a toolbar morre a cada navegacao ou reload da aba. Uma
   conexao de realtime tem que viver onde a UI vive e tolerar reconexao e re-join de sala.

## Problema

Como oferecer presenca, chat e consenso de acoes em tempo real entre ate quatro usuarios, mantendo o
modelo de seguranca atual (nunca confiar no cliente, extensao so fala com Edge Functions, nenhum
dado pessoal de terceiro exposto sem decisao explicita) e sem introduzir dependencia runtime nova no
backend?

## Opcoes consideradas

### Canal de tempo real

- Opcao A: Supabase Realtime nativo (Broadcast + Presence) com Realtime Authorization por RLS.
  Presence cobre cursores e lista de participantes; Broadcast cobre chat e propostas de acao.
  Autentica com o JWT do proprio usuario e autoriza o canal por RLS. Menos codigo proprio porque
  Presence e Broadcast sao exatamente as primitivas de cursor e chat. Custo: vendorizar o cliente
  realtime como script classico no pacote e romper o invariante "extensao so fala com Edge
  Functions", o que precisa ser decisao consciente documentada aqui e em `docs/security.md`.
- Opcao B: relay WebSocket em Edge Function propria (`Deno.upgradeWebSocket`). Mantem o invariante
  (extensao so fala com nossas Edge Functions) e poe sala, consenso e autorizacao cem por cento sob
  nosso controle. Custo: passamos a manter o relay, e Edge Functions tem limites de wall-clock e
  escala para conexoes longas que precisam ser validados antes.

### Modelo de consenso (confirmar antes de executar)

- Opcao C: interceptar o clique ou submit no DOM, segurar na fase de captura e re-despachar depois
  do consenso. Limite tecnico duro: o evento re-despachado e `isTrusted:false`, e o navegador ignora
  evento sintetico para acoes que dependem de ativacao genuina do usuario (abrir janela, input de
  arquivo, clipboard, alguns submits). E a mesma limitacao que ja restringe o replay do Macro
  Studio. Nao existe replay fiel de um clique confiavel.
- Opcao D: fazer o consenso na camada de intencao e rede, nao no DOM. O `pagebridge` roda no MAIN
  world e e o unico lugar que enxerga `window.fetch` e `XMLHttpRequest` reais da pagina (ver
  `docs/architecture.md`). Da para segurar a chamada de rede ou o submit do form ate o consenso
  chegar e entao liberar. Funciona de verdade para acoes que disparam rede, que sao a maioria dos
  cliques perigosos de QA (salvar, deletar, enviar). O que e puramente client-side (abrir um
  dropdown) fica fora do consenso, documentado como limite de escopo.

## Decisao (proposta, pendente de aprovacao do fundador)

Recomendacao tecnica, condicionada as decisoes em aberto abaixo:

1. Canal: Opcao A (Supabase Realtime nativo) como caminho de menor codigo proprio, condicionada a
   (i) este ADR aprovar explicitamente o canal direto extensao para Supabase, (ii) a vendorizacao do
   cliente passar no allowlist de seguranca, e (iii) o gating de plano e o limite de quatro serem
   reforcados por RLS no canal, nunca so no cliente. Se o canal direto for recusado por quebrar o
   invariante de seguranca, cair para a Opcao B.
2. Consenso: Opcao D (camada de rede e submit no `pagebridge`), com o clique no DOM servindo apenas
   de gatilho visual da proposta, nao como algo a ser re-executado. O criterio de aceite tem que
   refletir que acoes puramente client-side ficam fora do consenso.
3. Dados efemeros (cursor, digitando) via Broadcast e Presence, sem banco. Dados duraveis (codigo da
   sala, host, membros, config de timeout, auditoria de consenso) em tabelas novas com RLS. O codigo
   da sala e gerado no servidor por RPC `security definer`, no mesmo padrao dos vouchers, e rotaciona
   ao encerrar a sessao. Timeout de inatividade com `chrome.alarms` (permissao ja existente) mais TTL
   no servidor.

## Decisoes do fundador (2026-10-22)

- D1: aparece o APELIDO, nunca o e-mail. O usuario define o apelido em Configuracoes; sem apelido,
  usa um nome de animal gerado automaticamente. O relatorio lista os participantes por apelido.
- D2: SIM, exclusivo do plano release-manager, reforcado por RLS no servidor (o cliente so esconde a
  UI).
- D3: o fundador delegou a escolha pedindo "seguro, rapido e efetivo, o menos custoso e mais
  eficiente". Escolhida a Opcao A (Supabase Realtime nativo, canais privados com Realtime
  Authorization por RLS em `realtime.messages`). Motivo: Presence e Broadcast ja sao as primitivas
  de cursor e chat (menos codigo proprio), a escala e a reconexao ficam com o Supabase, e a Opcao B
  esbarra no limite de wall-clock das Edge Functions para conexoes longas, alem de exigir manter um
  relay. O invariante "extensao so fala com Edge Functions" passa a ter UMA excecao documentada: o
  WebSocket de Realtime, autenticado com o JWT do proprio usuario, em canal privado cuja policy
  exige membro ativo da sala (o plano e revalidado pela Edge Function a cada 5 min e um membro sem
  plano e removido). Criacao de sala, convite, remocao, rotacao de codigo e o CHAT continuam em
  Edge Function/RPC `security definer`.
  Ajustes da revisao de seguranca (antes do merge): topico `mt:<sala>:<epoca>` com epoca trocada a
  cada remocao/saida/encerramento (o Realtime guarda a autorizacao durante a conexao); limite de 4
  atomico em `mt_set_member_status`; chat publicado so pelo servidor com remetente do JWT.
  Risco aceito: cursor, clique e presence sao peer-to-peer e um membro ativo com cliente proprio
  pode declarar outro remetente nesses eventos; nao concede acesso nem afeta chat ou decisoes.
- D4: o fundador autorizou o agente a escrever no Supabase de producao, com a condicao de criar
  backup antes de cada escrita para permitir rollback.

## Plano de implementacao (2026-10-22)

Entrada na sala: o host cria a sala e recebe um codigo de 8 caracteres gerado no servidor. O
convidado digita o codigo, o que gera um PEDIDO de entrada; so o host aprova, recusa ou remove. O
codigo sozinho nao da acesso, entao repassar o codigo nao equivale a convidar (so o host convida).
Nenhum e-mail e trocado entre usuarios.

Fase MT1 (este PR):
1. Banco (migration + schema.sql): `mt_rooms` (host, codigo unico, status open/ended, duracao e
   timeout de inatividade escolhidos pelo host, expires_at, last_activity_at) e `mt_members` (sala,
   usuario, apelido, cor, papel host/guest, status pending/active/removed/left/rejected). RLS:
   membro ativo le a propria sala e os membros dela; nenhuma escrita direta (so service role via
   Edge Function). Feature `multiTester.enabled` = true apenas no plano release-manager.
2. Realtime Authorization: policies em `realtime.messages` liberando select/insert somente quando
   `realtime.topic()` = `mt:<room_id>` de uma sala open, nao expirada, em que `auth.uid()` e membro
   ativo. Canal privado (`private: true`).
3. Edge Function `multi-tester` (acoes create, request, state, approve, reject, remove, leave, end,
   touch): autentica o JWT, confere o plano pelo mesmo `selectBestEntitlement` do access-status, aplica
   rate limit, limite de 4 membros ativos, expiracao por duracao e por inatividade, e rotaciona o
   codigo ao encerrar (sala encerrada nunca reabre; nova sala, novo codigo).
4. Extensao: cliente Realtime (protocolo Phoenix via WebSocket nativo, sem dependencia nova) no
   service worker, com heartbeat de 25s (mantem o SW vivo, Chrome 116+) e reconexao; relay para a
   aba por mensagens. Drawer "Multi Testador": criar sala, codigo, pedidos pendentes, membros,
   remover, encerrar, chat. Cursores remotos com `renderPointerFigure` e o apelido; so aparecem
   quando os dois estao na mesma URL. Apelido em Configuracoes, com fallback de nome de animal.
   Gravacao captura os cursores (estao no DOM). Relatorio lista os participantes por apelido.

Fase MT2 (PR seguinte): consenso. Clique de convidado bloqueado e transformado em proposta para o
host; submit/requisicao de rede do host segurada no `pagebridge` ate todos aprovarem (Opcao D).

## Fase MT2 implementada (2026-10-23, v1.4.44)

Regras do fundador: "convidado nunca executa acao sem o host" e "confirmacao de todos os testadores
antes de cliques/submits".

Convidado (toolbar, mundo isolado): enquanto esta numa sala ativa como convidado, cliques,
`pointerdown`/`mousedown`/`mouseup`, Enter/Espaco e `submit` reais (`isTrusted`) em alvos acionaveis
sao cancelados na fase de captura do `window` (`preventDefault` + `stopImmediatePropagation`) e viram
um evento `proposal` (seletor CSS do `uniqueSelector`, XPath do `buildXPath`, ponto normalizado,
`origin+pathname` e o rotulo visivel truncado, nunca o valor de campo). Clique em qualquer outro
ponto da pagina tambem e cancelado, mas so vira proposta o que parece acionavel (seletor de
controles ou `cursor:pointer`). Digitar em campo de texto continua livre (Enter nao). O convidado ve
"Aguardando o host" num painel flutuante e uma marcacao em volta do elemento. Nada e re-despachado:
o host executa clicando ele mesmo (a proposta fecha sozinha como executada) ou descarta. Como
segunda barreira, o `pagebridge` em modo "guest" recusa POST/PUT/PATCH/DELETE disparados por gesto
do usuario.

Host: com "Exigir confirmacao de todos" ligado (padrao) e pelo menos um convidado ativo:
- submit nativo de formulario disparado por gesto (`navigator.userActivation.isActive`) e segurado na
  captura e, depois do consenso, re-enviado com `form.requestSubmit(submitter)` com uma "concessao"
  sincrona ao `pagebridge`, para a requisicao que o handler de submit da pagina dispara na hora nao
  pedir um segundo voto;
- `fetch`/`XMLHttpRequest` POST/PUT/PATCH/DELETE feitos enquanto a pagina tem ativacao transitoria do
  usuario (o clique ou Enter dos ultimos segundos, janela do proprio Chrome) sao segurados no
  `pagebridge` (MAIN world) por uma promise resolvida pelo evento DOM `qts:mt-hold-decision` vindo
  do mundo isolado. Rejeitado: `fetch` rejeita com `TypeError` e o XHR dispara `error`, como falha
  de rede. Varias requisicoes do mesmo clique entram no mesmo voto.
- o voto (`vote-request` com id e descricao, `vote` de cada convidado, `vote-result` do host) passa
  pela Edge Function `multi-tester`, que carimba o remetente do JWT e confere o papel; a policy de
  insert do canal passou a recusar `vote`, `vote-request` e `vote-result` de cliente (migration nova
  `20261023120000_multi_tester_votes_policy.sql`, replicada em `schema.sql`). Resolve quando todos
  os membros ativos convidados de `view.members` aprovaram; qualquer recusa, o tempo
  `MT_VOTE_TIMEOUT_MS` (60s), o host cancelar, desligar a chave ou a sessao terminar cancelam.

Limites conhecidos (escopo, nao bug):
- `isTrusted`: o re-envio do formulario e do navegador, nao um gesto novo; um handler que exige
  ativacao do usuario (abrir janela, clipboard) depois de uma espera longa pode recusar.
  `form.submit()` chamado pelo codigo da pagina nao dispara evento `submit` e fica fora.
- Requisicao sem gesto do usuario (polling, GraphQL de leitura via POST no carregamento) passa: nao
  e uma acao do testador. Se a pagina disparar outro POST depois de esperar a resposta, ainda dentro
  da janela de ativacao, pede um segundo voto.
- XHR sincrono de risco nao pode esperar voto sem travar a pagina: e recusado (falha fechada).
- Acao puramente client-side do host (abrir dropdown, trocar aba) nao passa por consenso.
- Listener da propria pagina registrado no `window` em captura antes da toolbar carregar roda antes
  do bloqueio do convidado; o gate de rede do `pagebridge` cobre o efeito de rede nesse caso.
  Entre o reload da pagina e a toolbar reidratar a sala (alguns centenas de ms) nada e bloqueado.
- Teclado: setas em select/radio/tab e Enter/Espaco em controles sao bloqueados; outras
  combinacoes de teclado exoticas nao sao cobertas.
- Um script da pagina compartilha o MAIN world com o `pagebridge` e pode disparar os eventos DOM de
  decisao, mas so afeta as proprias requisicoes (que ele poderia enviar sem o patch). Um pedido de
  voto forjado pela pagina sem ativacao do usuario e recusado no mundo isolado.
- Membro ausente (aba fechada) mas ainda ativo no servidor bloqueia o consenso ate o tempo
  esgotar; o host pode remove-lo ou desligar a chave.
- Risco aceito: `proposal`/`proposal-done` sao peer-to-peer como cursores (um cliente proprio pode
  declarar outro remetente). So informam; o host sempre age por conta propria.

Evidencia: `npm run test:chrome` cobre proposta do convidado chegando ao host (drawer e marcacao em
volta do elemento, fechada quando o host clica nele), submit nativo segurado sem nenhum POST no
servidor ate o voto de aprovacao, `fetch` POST cancelado por voto de recusa (zero POST), XHR POST
liberado so depois da aprovacao (exatamente um POST), votos nunca enviados direto pelo canal, e no
cenario de convidado: clique bloqueado (contador da pagina e servidor inalterados) virando proposta
com "Aguardando o host", pedido de voto respondido pela Edge Function.

Escrita no Supabase de producao: autorizada pelo fundador com backup antes (D4). Procedimento:
`supabase db dump` do schema public e das tabelas afetadas para `artifacts/backups/` (fora do git),
depois `npm run backend:apply-pending -- --apply`.

## Decisoes em aberto (historico, respondidas acima)

- D1. Exposicao de identidade usuario a usuario (nome e cursor). E a primeira vez que um usuario
  veria dado de outro. Que nome aparece (apelido escolhido na sala, nao e-mail) e o que fica
  registrado no relatorio.
- D2. Gating por plano. Multi Testador e exclusivo do plano release-manager? O reforco sera por RLS
  no servidor de qualquer forma.
- D3. Aprovacao do canal direto extensao para Supabase (quebra do invariante atual). Aceitar a Opcao
  A ou exigir a Opcao B.
- D4. Qualquer escrita no Supabase de producao (tabelas, RLS, RPC novas) exige aprovacao humana
  explicita no momento (`docs/PENDENCIAS_USUARIO.md`). Nem agente nem script contornam.

## Controles de seguranca (planejados)

- Limite de quatro participantes e gating de plano reforcados por RLS no canal e nas tabelas, nunca
  so no cliente.
- Codigo de sala gerado no servidor (RPC `security definer`), nunca gerado ou confiado no cliente, e
  rotacionado ao encerrar.
- Nome e mensagem de outro usuario sao conteudo de terceiro: renderizar sempre com `escapeHtml`
  (risco de XSS).
- Cliente de realtime vendorizado localmente, sem codigo remoto, passando no allowlist de
  `security:extension`.
- Convite controlado so pelo host; remocao de participante encerra a sessao daquele membro no
  servidor, nao so some o cursor no cliente.

## Consequencias

A feature e classificada HIGH RISK pelo `AGENTS.md`: toca autorizacao e identidade, exige RLS e RPC
`security definer` novos, mexe pesado em `toolbar.js` (overlay de cursores, chat, e o gate de
consenso transversal a eventos) e introduz um padrao arquitetural novo. Exige migrations replicadas
em `schema.sql` na mesma PR (`backend:check-schema-sync` verde), entrada em `FEATURE_REGISTRY` nos
dois gemeos mais `SCHEMA_19` e bump de `schemaVersion`, atualizacao de `docs/permissions.md` e
`docs/security.md` se tocar permissao ou identidade, e `npm run test:all:clean` completo na
validacao. O criterio de aceite do consenso reflete o limite de `isTrusted`: o produto nao promete
confirmar qualquer clique, e sim segurar acoes que disparam rede ou submit.

## Evidencia

A definir na implementacao. Minimo: testes de workspace cobrindo geracao e rotacao de codigo de
sala, limite de quatro e gating por RLS; smoke no Chrome real cobrindo presenca de cursores, chat,
proposta e consenso de uma acao de rede, reconexao apos navegacao, e zero erros de console e worker.
