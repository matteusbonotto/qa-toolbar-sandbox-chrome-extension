# Auditoria transversal de produto e UX

## Regras do fundador

- Usar superfícies e botões sólidos. Gradientes decorativos não solicitados foram removidos.
- Cliente é o card pai. Projeto é filho do cliente. Produto é filho do projeto.
- Toda entidade comunica seu tipo por tag, imagem cadastrada ou iniciais com cor estável.
- Ambientes e URLs formam uma única área. O ambiente é accordion e cria URLs no próprio contexto.
- Contas, pagamentos e dispositivos usam filtros e agrupamentos relacionais reutilizáveis.
- Cliente, projeto, produto e ambiente fixos de demonstração permanecem no armazenamento para o
  tour, mas ficam ocultos da administração cotidiana.
- Projeto, produto e URLs podem ser movidos por drag and drop para pais compatíveis.
- Menus de toolbar e sidebar posicionados embaixo abrem para cima.
- Desktop e mobile possuem prévias equivalentes e lado a lado.
- Tutorial em vídeo só será recapturado depois da validação visual do fundador.

## Implementação atual

- `options.html`: seis destinos do Workspace, hierarquia real, Ambientes e URLs unificados, filtros
  de contas, pagamentos e dispositivos, previews desktop e mobile.
- `options.js`: árvore de entidades, ocultação de itens fixos, agrupamento relacional reutilizável,
  criação contextual, drag and drop e correção do Tour das Configurações.
- `options.css`: botões sólidos, miniatura de ambiente com largura fixa, pills sem overflow,
  hierarquia, estados de drop e layout responsivo.
- `toolbar.js`: menus e dropdowns abrem para cima nas posições inferiores.
- Assets: Windows 11 flat, Tux e Android flat em PNG.
- FAQ, tutorial textual e traduções PT-BR, espanhol e inglês atualizados. A mídia não foi alterada.
- Manifesto preparado como `1.4.20`.

## Validação

- Normalização do workspace e segurança do bundle aprovadas após a reaplicação.
- Smoke Chrome com fingerprint
  `7aa2c29b450d18ae07357ab6c8b28cf8efe05a73ba7b562fa57e3f465c3280c8` validou os fluxos até o
  Tour das Configurações e encontrou duas etapas legadas de Projeto e Produto. Os seletores foram
  corrigidos para o novo fluxo hierárquico.
- A captura visual do Workspace foi revisada. O alinhamento de avatar e nome e o estado vazio
  desnecessário do produto foram corrigidos depois dessa revisão.
- Nenhum merge, deploy, upload na Chrome Web Store ou alteração produtiva foi executado.

