# Redesenho do Workspace Studio

## Regra de produto registrada

O Workspace deve ser claro, objetivo, completo, organizado, minimalista e moderno. A criação de um
novo workspace acontece por um wizard. As listagens devem ser separadas e agrupadas por contexto.
Formulários relacionais precisam comunicar e suportar relações N:N. As etapas de Contas,
Pagamentos e Inspectors fazem parte do wizard com opções visíveis e acionáveis.
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
- [x] Wizard com oito etapas e orientação persistente em desktop.
- [x] Wizard responsivo com progresso compacto em telas pequenas.
- [x] Contas, Pagamentos e Inspectors exibem campos, relações e ações disponíveis antes da abertura
  do formulário.
- [x] Contas e Pagamentos herdam ambientes e produtos escolhidos anteriormente no wizard.
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
- [ ] Evidência visual mobile recriada após aprovação da arquitetura desktop.
- [ ] Tutorial e mídia do Workspace recriados após aprovação visual final.

## Testes que provam a regra

O smoke da extensão percorre as oito etapas, cria a estrutura e uma URL, importa uma conta por CSV
e confirma a persistência no armazenamento. A cobertura também exige o trilho de navegação,
as três explicações da etapa Contas e a ação explícita de abertura do formulário.
