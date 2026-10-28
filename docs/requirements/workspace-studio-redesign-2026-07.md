# Redesenho do Workspace Studio

## Regra de produto registrada

O Workspace deve ser claro, objetivo, completo, organizado, minimalista e moderno. A criação de um
novo workspace acontece por um wizard. As listagens devem ser separadas e agrupadas por contexto.
Formulários relacionais precisam comunicar e suportar relações N:N. Contas, Pagamentos,
Dispositivos e Inspectors são oferecidos como próximos passos opcionais na tela de conclusão do
wizard, com opções visíveis e acionáveis (revisão de 2026-10-28, abaixo).

### Revisão do wizard (fundador, 2026-10-28, após apresentação ao vivo)

"O processo de criação de workspace ficou muito confuso." O wizard precisa ensinar, com explicação
e exemplo em cada passo, quem não tem nenhum contexto. Regras:

- Passo 1, Cliente: a empresa testada (ex.: Bankeiro). Pode escolher uma já cadastrada.
- Passo 2, Produto: um app, sistema ou site dessa empresa (ex.: Uzzipay). Pode escolher um já
  cadastrado.
- "Projeto" não é perguntado no wizard: o produto fica sob um projeto com o nome do cliente,
  reaproveitado se já existir (sem mudança de schema). Projetos continuam nas telas completas.
- Passo 3, Onde a barra aparece: "Em todos os sites" (ativa o escopo de todos os sites e encerra,
  sem exigir ambiente) ou "Só em sites específicos (por ambiente)".
- Passo 4 (só para sites específicos), Ambientes: cada ambiente com nome e cor e, dentro dele, as
  URLs onde a barra daquele ambiente aparece. Ex.: STG azul em https://stg.uzzipay.com.br/*.
- Passo final: resumo em uma frase ("Cliente Bankeiro, produto Uzzipay, ambiente STG (azul) em
  https://...") e Concluir. Nada é salvo antes de Concluir.
- Sem o diálogo "cadastrado com sucesso, cadastrar outro/continuar" no meio do fluxo.
Na organização principal, a pessoa pode alternar a visualização entre cliente, projeto e produto.
Cada visão mantém o contexto dos relacionamentos sem duplicar ou ocultar os dados cadastrados.

O Workspace também deve apresentar, fora do wizard, listagem e CRUD completos para os catálogos
reutilizáveis de tipos de conta, tipos de pagamento, sistemas operacionais e navegadores. Deve
apresentar ainda o CRUD de dispositivos, com relação N:N entre cada dispositivo e seus sistemas e
navegadores. Esses cadastros não podem ficar ocultos nem existir apenas como uma etapa guiada.

## Checklist de aceite

- [x] CTA inequívoco para criar workspace por configuração guiada.
- [x] Resumo operacional com atalhos para Estrutura, Ambientes, URLs e Dados de teste.
- [x] Navegação separada entre Organização e Operação.
- [x] A etapa se chama Clientes e produtos, evitando o nome genérico Estrutura.
- [x] Clientes, projetos e produtos aparecem em uma árvore única. Cliente é o contêiner pai,
  projeto é seu filho e produto é filho do projeto selecionado.
- [x] Cada nível da árvore é um accordion independente, inicialmente aberto, que pode ser
  minimizado e expandido sem perder seleção ou contexto.
- [x] Filtros de visualização permitem navegar por cliente, projeto ou produto. As visões de
  projeto e produto exibem o contexto do nível pai sem exigir uma seleção anterior.
- [x] Painéis paralelos e agrupamentos que competiam visualmente foram removidos.
- [x] Formulários em modal não repetem a divisória entre cabeçalho e campos.
- [x] Wizard com cinco etapas (quatro em "Todos os sites") e orientação persistente em desktop
  (revisão de 2026-10-28; antes eram nove etapas).
- [x] Wizard responsivo com progresso compacto em telas pequenas.
- [x] Contas, Pagamentos, Dispositivos e Inspectors aparecem como próximos passos opcionais na
  conclusão do wizard, com as ações disponíveis antes da abertura do formulário.
- [x] Contas e Pagamentos herdam o produto e os ambientes criados no wizard.
- [x] Entrada individual e importação CSV permanecem disponíveis quando aplicáveis.
- [x] Credenciais e pagamentos continuam marcados como dados exclusivamente sandbox.
- [x] Tema claro e escuro usam os mesmos tokens semânticos.
- [x] Tipos de conta possuem listagem, criação, edição, exclusão e vínculo reutilizável com contas.
- [x] Tipos de pagamento possuem listagem, criação, edição, exclusão e vínculo reutilizável com pagamentos.
- [x] Sistemas operacionais e navegadores possuem catálogos independentes e reutilizáveis.
- [x] Dispositivos possuem CRUD e seleção N:N de sistemas operacionais e navegadores.
- [x] Formulários dos catálogos e dispositivos reutilizam o mesmo sistema de diálogos, campos e ações.
- [x] A navegação do Workspace usa dois grupos responsivos, sem scrollbar horizontal.
- [x] Inspectors possuem área principal própria, padrões visíveis na listagem, exemplos rápidos no
  formulário e separação clara de APIs e recursos de apoio.
- [x] Evidência visual desktop recriada no Chrome descartável.
- [x] Evidência visual mobile adicionada ao smoke com viewport 390 por 844, prova de ausência de
  overflow e preservação dos três níveis hierárquicos.
- [x] Tutorial e mídia do Workspace recapturados seletivamente depois da validação funcional.

## Testes que provam a regra

O smoke da extensão percorre as oito etapas, cria a estrutura e uma URL, importa uma conta por CSV
e confirma a persistência no armazenamento. A cobertura também exige o trilho de navegação,
as três explicações da etapa Contas e a ação explícita de abertura do formulário.
