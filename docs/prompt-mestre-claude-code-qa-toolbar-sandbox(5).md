# PROMPT MESTRE — QA TOOLBAR SANDBOX

Você está trabalhando no repositório local:

`C:\Users\matheus.bonotto\Documents\github\qa-toolbar-sandbox-chrome-extension`

Atue como engenheiro principal responsável pela extensão Chrome, Landing Page, Admin, backend/Supabase, Stripe, feature flags, testes, documentação, tutoriais e processo de release.

## 1. Objetivo geral

Revisar, planejar e implementar de forma segura todas as solicitações abaixo para a **QA Toolbar Sandbox**, considerando a ordem cronológica em que foram registradas, agrupando demandas relacionadas e preservando tudo o que já estiver correto.

O produto deve oferecer ferramentas de QA manuais com experiência visual moderna, consistente, responsiva, acessível, fácil de ativar/desativar e preparada para desktop e mobile.

## 2. Regras obrigatórias de execução

1. **Leia todo este documento antes de alterar código.**
2. Faça primeiro uma auditoria do estado atual do repositório e compare cada solicitação com a implementação existente.
3. Não reimplemente cegamente algo que já esteja pronto.
4. Não remova funcionalidades existentes sem justificativa.
5. Corrija primeiro bugs críticos e regressões.
6. Mantenha um checklist de progresso atualizado no início e após cada etapa relevante.
7. Agrupe mudanças por domínio para evitar retrabalho.
8. Componentize elementos repetidos: botões, headers, sidebars/drawers, balloons, menus de contexto, toasts, cards, estados vazios e controles de ação rápida.
9. Preserve suporte a PT-BR, inglês e espanhol.
10. Todas as funcionalidades devem respeitar planos e feature flags tanto no frontend quanto no backend.
11. Não faça deploy, publicação na Chrome Web Store, alteração de produção, Stripe ou Supabase produtivo sem confirmação explícita do usuário.
12. Antes de qualquer release, rode os testes apenas quando a implementação estiver consolidada, evitando repetir suites completas desnecessariamente.
13. A última etapa antes da subida deve ser a validação completa: lint/syntax, typecheck, testes unitários, segurança, build e smoke test real no Chrome.
14. Não declare sucesso sem evidência.
15. Caso exista conflito entre uma solicitação antiga e outra posterior, prevalece a solicitação posterior.
16. Corrija também erros simples encontrados durante a auditoria, mas registre-os no checklist.
17. Garanta ausência de erros de console e worker.
18. Não vincule o projeto QA Toolbar Sandbox à conta `cnk.aut.mblabs@gmail.com` nem a qualquer identidade da Cinemark/MB Labs.

---

# 3. Referências visuais enviadas no chat

As imagens devem ser tratadas como requisitos visuais. Elas aparecem no chat original na ordem abaixo. Ao levar este prompt ao Claude Code, anexe as imagens com nomes equivalentes para que possam ser abertas e analisadas.

## Lote visual A — onboarding, workspace e recompensas

- **IMG-01 — 1354×476:** estado da extensão/toolbar para usuário não autenticado ou primeiro acesso.
- **IMG-02 — 661×752:** configuração do workspace demonstrando Cliente, Projeto, Produto, Ambiente e vínculo de URL; mostra que parte estava travada, mas ambiente e URL podiam desaparecer após importação.
- **IMG-03 — 451×299:** tela da Chrome Web Store/painel mostrando que a análise pendente foi interrompida para permitir novo envio.

Requisitos extraídos:
- Usuário deslogado deve receber orientação clara e botão para entrar.
- Entidades padrão do site demonstrativo precisam permanecer após importações.
- A roleta deve ficar oculta até o usuário clicar em “Tentar a sorte”.
- Pontos e métricas de recompensas devem ser minimalistas.

## Lote visual B — auditoria da Landing Page e interfaces

Imagens na sequência original:
- **IMG-04 — 826×713**
- **IMG-05 — 419×51**
- **IMG-06 — 561×39**
- **IMG-07 — 399×361**
- **IMG-08 — 1900×871**
- **IMG-09 — 1836×849**
- **IMG-10 — 1900×835**
- **IMG-11 — 1863×837**
- **IMG-12 — 1893×593**
- **IMG-13 — 1920×1523**

Essas imagens devem ser usadas para comparar:
- navegação e CTAs;
- autenticação;
- planos e checkout;
- recompensas;
- apresentação de features;
- responsividade;
- consistência visual da LP/admin/extensão;
- problemas apontados na auditoria descrita neste documento.

## Lote visual C — comparação com Tampermonkey e problemas da extensão

- **IMG-14 — GIF:** comportamento/visual de referência da versão Tampermonkey.
- **IMG-15 a IMG-24 — PNGs:** toolbar, drawers, recursos, ícones, feature flags, admin, vouchers, inspectores, Pixel Perfect, gravadores e elementos flutuantes.

A versão Tampermonkey deve ser usada apenas como referência de clareza visual e diferenciação dos ícones. Não copie arquitetura antiga se ela for pior.

## Lote visual D — mobile, marcadores, inspectores e dados

- **IMG-25 — 366×74**
- **IMG-26 — 373×888**
- **IMG-27 — 384×468**
- **IMG-28 — 400×388**
- **IMG-29 — 370×904**

Requisitos extraídos:
- toolbar mobile não pode quebrar;
- drawers/sidebars mobile devem se comportar como bottom sheets quando fizer sentido;
- criar marcadores Warning e Question;
- melhorar visualização de JSON/dados;
- chave acima do valor quando o conteúdo ocupar mais de duas linhas;
- mostrar ações apenas quando aplicáveis.

> Ao implementar, crie um arquivo `docs/requirements/visual-references.md` contendo este índice e, se as imagens estiverem disponíveis localmente, copie-as para `docs/requirements/screenshots/` com os nomes `IMG-01`, `IMG-02` etc. Registre em cada item o requisito visual confirmado.

---

# 4. Contexto do trabalho já realizado antes das novas solicitações

Antes das mensagens mais recentes, já houve uma rodada de implementação com:

- correção da linha de medição do Pixel Perfect;
- modo “Inspecionar elemento” com hover, scroll por pais/filhos e clique para fixar;
- menu de contexto “Inspecionar com Pixel Perfect”;
- melhoria do color picker;
- reescrita do Gravador de Passos com frases explícitas e Gherkin multi-idioma;
- correção do submenu “Desenhar forma”;
- ordenação dos recursos do menu Tools;
- site demonstrativo próprio;
- entidades padrão do workspace travadas;
- atualização de tutorial e smoke tests;
- suite real-Chrome passando com zero erros;
- alterações commitadas em branch e mergeadas em momento posterior;
- LP/admin publicados;
- tentativa de envio à Chrome Web Store inicialmente bloqueada por versão pendente.

**Não presuma que tudo continua correto. Audite primeiro.**

---

# 5. Solicitações cronológicas consolidadas

## Fase 1 — Primeiro acesso, autenticação e workspace demonstrativo

### 5.1 Usuário não autenticado

Quando a extensão for instalada ou carregada e o usuário não estiver autenticado:

- a QA Toolbar deve continuar aparecendo;
- ocultar todos os recursos que exigem autenticação;
- mostrar estado “Deslogado” ou equivalente;
- exibir uma orientação clara;
- fornecer botão “Entrar novamente”;
- levar diretamente para `Configurações > Minha conta`;
- no primeiro acesso, exibir pop-up/modal informando que é necessário entrar;
- não deixar o usuário sem feedback com a impressão de que a extensão não funciona.

O estado deslogado deve ser seguro, minimalista e consistente com os temas.

### 5.2 Workspace do site demonstrativo

O workspace padrão do tutorial/site demonstrativo deve ter entidades fixas e protegidas:

- Cliente: `Toolbar`
- Projeto: `Sandbox`
- Produto: `STAGE`
- Ambiente demonstrativo correspondente
- vínculo da URL do site demonstrativo, incluindo `sandbox/index.html`

Requisitos:

- essas entidades não podem ser removidas manualmente;
- não podem ser sobrescritas ou eliminadas por importações antigas;
- devem ser recriadas pela normalização se estiverem ausentes;
- devem continuar vinculadas corretamente;
- o ambiente e a URL também precisam ser protegidos, não apenas Cliente/Projeto/Produto;
- a importação de workspace deve preservar dados do usuário e também restaurar os itens protegidos;
- mostrar cadeado/estado visual de item protegido;
- ações de editar/excluir indisponíveis ou claramente bloqueadas;
- adicionar testes de normalização, importação e persistência.

### 5.3 Site demonstrativo próprio

- usar site próprio da QA Toolbar Sandbox;
- não depender de `demoqa.com` ou `saucedemo.com`;
- manter HTML/CSS/JS estável para tutoriais e smoke tests;
- incluir elementos suficientes para testar forms, inputs, botões, IDs, roles, data-test-id, JSON, ações e recursos visuais;
- manter seletores estáveis;
- atualizar scripts de captura de tutorial e smoke tests.

---

## Fase 2 — Recompensas e roleta

### 5.4 Roleta

A roleta atual foi considerada incorreta. O comportamento esperado é semelhante ao conceito de `spinthewheel.io`, sem copiar código ou identidade visual.

- ocultar a roleta por padrão;
- mostrar apenas quando o usuário clicar em “Tentar a sorte”;
- abrir em modal/drawer apropriado;
- exibir segmentos rotulados;
- listar claramente os possíveis prêmios;
- animação realista e legível;
- resultado inequívoco;
- considerar som e confete com respeito à configuração de redução de movimento/som;
- impedir abuso e múltiplos giros indevidos;
- deixar claro quando poderá tentar novamente;
- não criar incentivos enganosos para avaliação/review.

### 5.5 Pontos e benefícios

- o número de pontos estava grande demais;
- tornar a visualização minimalista;
- corrigir classes de botão inconsistentes;
- garantir estado disabled;
- revisar responsividade;
- garantir contraste em claro/escuro;
- não mostrar componentes de recompensa sem contexto.

---

## Fase 3 — Auditoria e correções da Landing Page

Implemente ou valide todos os itens abaixo.

### 5.6 Acessibilidade do modal de autenticação

- implementar focus trap;
- impedir foco em elementos atrás do modal;
- salvar o elemento que abriu;
- restaurar o foco ao fechar;
- fechar por Escape;
- manter aria apropriada;
- considerar `<dialog>` nativo apenas se compatível com a arquitetura;
- testar teclado completo.

### 5.7 Validação de autenticação

Substituir mensagens genéricas de checkout por erros específicos:

- e-mail obrigatório/inválido;
- senha mínima;
- termos obrigatórios;
- feedback por campo;
- `aria-describedby`;
- foco no primeiro erro;
- não reutilizar `checkoutFailed` para validação local.

### 5.8 CTA de instalação

O botão “Instalar” não deve criar expectativa falsa.

- visitante não autenticado: texto semelhante a “Criar conta e instalar”;
- autenticado: “Instalar extensão”;
- explicar por que a conta é necessária;
- manter fluxo transparente;
- revisar CTAs da navegação e hero.

### 5.9 Caminhos de instalação

Existiam dois caminhos confusos.

- unificar o fluxo principal;
- evitar botões com mesmo texto e comportamentos diferentes;
- explicar instalação, autenticação e disponibilidade;
- impedir dead ends.

### 5.10 Navegação e idiomas

- revisar mistura de idiomas;
- manter PT-BR, EN e ES completos;
- não exibir strings sem tradução;
- testar troca de idioma;
- revisar idioma de metadados e atributos acessíveis.

### 5.11 Abas acessíveis

- implementar semântica completa de tabs;
- `role=tablist`, `role=tab`, `role=tabpanel`;
- `aria-selected`, `aria-controls`, roving tabindex;
- setas do teclado;
- foco visível.

### 5.12 Voucher

- label acessível, não depender de placeholder;
- erro específico para código inválido, expirado, revogado ou já usado;
- loading;
- sucesso;
- permitir editar/excluir conforme regras administrativas;
- revisar vouchers de licença;
- nunca retornar `[object Object]`;
- não bloquear gerenciamento só porque foi revogado, salvo regra de auditoria; nesse caso, disponibilizar ação compatível e histórico.

### 5.13 Toggle mensal/anual

- nome acessível;
- estado selecionado;
- operação por teclado;
- preço atualizado sem ambiguidade;
- avisar diferença de cobrança.

### 5.14 Marca/navegação

- logo/marca deve levar ao início;
- usar link semântico;
- foco visível;
- preservar idioma e estado quando aplicável.

### 5.15 Consulta da Chrome Web Store

- não ocultar silenciosamente falhas;
- diferenciar indisponível, erro e carregando;
- mostrar fallback confiável;
- registrar telemetria segura;
- não exibir dados obsoletos como atuais.

### 5.16 Carregamento de preços

- skeleton/loading explícito;
- evitar layout shift;
- não mostrar preço incorreto antes da resposta;
- fallback seguro;
- tratar erro.

### 5.17 Plano anual selecionado

- revisar se anual por padrão é a escolha correta;
- deixar cobrança explícita;
- evitar padrão enganoso;
- destacar economia sem esconder total.

### 5.18 Rotas desconhecidas

- criar 404 apropriado ou redirecionamento consciente;
- não renderizar página inicial silenciosamente para qualquer rota;
- fornecer retorno para home.

### 5.19 Ordem do simulador

- apresentar contexto antes do simulador;
- reduzir confusão;
- garantir que o visitante entenda a proposta antes de interagir.

### 5.20 Sincronização longa

- revisar processos que podem durar até cinco minutos;
- mostrar progresso;
- permitir retry;
- evitar polling excessivo;
- cancelar quando componente desmontar;
- não travar interface.

### 5.21 Fluxos mínimos de teste da LP

Testar:
- cadastro;
- login;
- logout;
- recuperação;
- usuário já existente;
- senha inválida;
- foco/teclado;
- voucher válido, inválido, expirado, revogado e usado;
- checkout mensal/anual;
- sucesso/cancelamento/erro;
- mobile;
- zoom 200%;
- navegação por teclado;
- leitor de tela básico;
- português, espanhol e inglês.

---

## Fase 4 — Inventário de funcionalidades e feature flags

### 5.22 Todas as funcionalidades devem estar listadas

Foi identificado que “Capturar Elementos” existia, mas não aparecia no menu.

- criar inventário canônico de recursos;
- comparar código, menu Tools, atalhos, context menu, planos, admin e backend;
- nenhuma feature ativa pode ficar invisível por esquecimento;
- nenhuma feature bloqueada pode ficar acessível pelo menu de contexto;
- usar uma única fonte de verdade quando possível;
- adicionar teste que falha se um recurso registrado não estiver mapeado na UI, planos e feature flags.

### 5.23 Feature flags

- admin deve mostrar todas as features;
- frontend e backend devem concordar;
- respeitar plano do usuário;
- corrigir caso em que o menu de contexto mostra recurso que a toolbar esconde e depois informa que não está habilitado;
- apresentar motivo do bloqueio com CTA apropriado;
- documentar key, tipo, descrição, default e planos;
- considerar migrations idempotentes.

### 5.24 Admin

- em acessos, exibir e-mail do usuário;
- exibir roles;
- melhorar CSS da área de registro de software;
- revisar `[object Object]`;
- permitir gerenciamento adequado de vouchers/licenças;
- manter auditoria para ações críticas.

---

## Fase 5 — Toolbar, menus, ícones e ativação/desativação

### 5.25 Cancelamento de ferramentas ativas

Problema: ao ativar Pass, Fail, Forms, Notes etc., não havia forma intuitiva de cancelar.

Requisitos:

- clicar novamente no item ativo deve desativar;
- item fixado ativo deve desativar ao novo clique;
- ação rápida deve alternar play/stop ou play/X;
- fornecer comando global “Desativar ferramentas ativas”;
- Escape deve cancelar modo de seleção quando seguro;
- indicar visualmente quais modos estão ativos;
- impedir múltiplos modos incompatíveis ao mesmo tempo;
- preservar modos que possam funcionar em paralelo apenas quando intencional.

### 5.26 Menu Tools e ações rápidas

#### Limite de altura e barra de rolagem

Como o menu Tools passou a concentrar muitas funcionalidades, ele pode ultrapassar a altura disponível da janela, especialmente em telas menores, notebooks, zoom elevado ou resoluções reduzidas.

Requisitos obrigatórios:

- limitar a altura máxima do menu de acordo com a área visível da viewport;
- adicionar rolagem vertical interna quando o conteúdo não couber na tela;
- manter cabeçalho, busca, filtros ou controles essenciais visíveis, caso existam;
- impedir que o menu ultrapasse os limites superior e inferior da viewport;
- recalcular a altura disponível ao redimensionar a janela, alterar zoom ou mudar orientação;
- preservar o acesso a todos os itens, inclusive os últimos da lista;
- garantir rolagem por mouse, touchpad, toque e teclado;
- exibir uma barra de rolagem discreta, mas perceptível e compatível com os temas claro e escuro;
- não bloquear a rolagem da página de forma permanente após fechar o menu;
- evitar que submenus, tooltips, flyouts ou menus de contexto sejam cortados pelo contêiner com rolagem;
- reposicionar submenus para dentro da viewport quando não houver espaço suficiente;
- manter itens fixados e ações rápidas totalmente clicáveis durante a rolagem;
- validar o comportamento em alturas reduzidas e com grande quantidade de funcionalidades.

Critérios mínimos de aceite:

1. nenhum item do menu Tools fica inacessível por estar fora da tela;
2. o menu nunca ultrapassa visualmente a viewport;
3. a rolagem aparece somente quando necessária;
4. abrir e fechar submenus não altera indevidamente a posição de rolagem;
5. o item ativo ou selecionado continua visível após ações que atualizem a lista;
6. o comportamento funciona nos temas claro e escuro e em desktop/mobile quando aplicável.

Para ferramentas com drawer/sidebar:

- clique no corpo/nome do item abre o drawer;
- botão de ação rápida à direita ativa/desativa sem abrir;
- ativo: card destacado e ícone vira X/stop;
- inativo: ícone play;
- tooltip/balloon acessível;
- funcionar com teclado;
- não permitir ação rápida se o recurso exige configuração ainda inexistente; nesse caso, abrir configuração ou explicar.

### 5.26.1 Salvar a URL da aba atual em um ambiente de testes

Ao clicar no ícone da extensão enquanto estiver navegando em qualquer página compatível, o popup deve oferecer uma ação clara para salvar a URL atual no workspace como URL de um ambiente de testes.

Requisitos obrigatórios:

- disponibilizar no popup da extensão uma ação como **“Salvar URL neste ambiente”** ou **“Adicionar URL ao workspace”**;
- capturar automaticamente a URL completa da aba ativa, sem exigir que o usuário copie e cole;
- permitir selecionar o workspace, Cliente, Projeto, Produto e Ambiente relacionados, respeitando a estrutura de dados atual;
- quando o workspace já puder ser identificado pelo domínio ou por uma URL vinculada, pré-selecionar as entidades correspondentes;
- quando houver apenas um Cliente, Projeto, Produto ou Ambiente válido, pré-selecioná-lo automaticamente;
- permitir salvar em um ou mais ambientes somente se o modelo atual realmente suportar múltiplos ambientes para o mesmo vínculo; caso contrário, deixar a limitação explícita na interface;
- permitir informar um nome ou descrição opcional para facilitar a identificação da URL;
- normalizar a URL conforme as regras existentes do projeto, preservando caminho quando necessário;
- permitir escolher entre salvar:
  - apenas a URL exata;
  - o domínio inteiro;
  - um padrão com wildcard compatível com o sistema;
- permitir ao usuário escolher como a URL será **exibida na interface**, sem alterar o valor real usado internamente:
  - **URL completa**, por exemplo `https://google.com/teste`;
  - **caminho após a URL base**, por exemplo `/teste`;
- disponibilizar essa preferência no cadastro/edição da URL e, quando fizer sentido, também como configuração geral do workspace ou da extensão;
- considerar como URL base a origem válida do endereço (`protocolo + domínio + porta`, quando houver), preservando no modo relativo o pathname e, somente quando permitido pelo usuário, query string e hash;
- no modo relativo, exibir `/` para a página raiz e manter subcaminhos completos, por exemplo `/checkout/payment`;
- não confundir o modo de exibição relativo com wildcard: `/teste` é um caminho visível, enquanto `*` continua sendo exclusivamente uma regra de correspondência;
- ações de copiar, abrir, navegar, validar e reconhecer ambiente devem continuar usando a URL absoluta correta, mesmo quando a interface estiver mostrando apenas o caminho relativo;
- quando não existir uma URL base concreta ou o valor for apenas um padrão global `*`, desabilitar o modo relativo ou apresentar uma mensagem clara explicando que não há base disponível para calcular o caminho;
- mostrar uma prévia do padrão que será salvo e de como ele será exibido antes da confirmação;
- interpretar o caractere `*` como **curinga universal**: cada `*` representa qualquer sequência de caracteres no trecho em que foi informado; quando o padrão inteiro for somente `*`, ele significa **todas as URLs** dentro do escopo selecionado;
- aplicar o curinga de forma previsível, documentada e compatível com a normalização atual, sem tratar `*` como texto literal;
- o `*` pertence exclusivamente à regra de correspondência da URL e não deve substituir, contaminar ou aparecer como valor de Cliente, Projeto ou Produto;
- ao selecionar/clicar em um Cliente, Projeto ou Produto na interface, exibir a **URL concreta correta** associada àquela entidade e ao ambiente selecionado; nunca mostrar apenas `*` quando existir uma URL real correspondente;
- quando o vínculo armazenado usar wildcard, resolver a URL concreta usando a aba ativa, a `primaryUrl` ou a URL específica cadastrada para aquela combinação de Cliente/Projeto/Produto/Ambiente;
- se não houver URL concreta capaz de ser resolvida, exibir um estado explícito como **“Padrão global — nenhuma URL específica cadastrada”**, em vez de apresentar `*` como se fosse uma URL navegável;
- impedir duplicidade silenciosa: quando a URL ou padrão já existir, informar onde está cadastrado e oferecer atualizar, adicionar outro ambiente ou cancelar;
- validar protocolos permitidos e bloquear páginas internas ou inseguras que não possam ser associadas, como `chrome://`, `edge://`, `about:`, páginas da própria loja e outras URLs restritas;
- não salvar query strings, hashes, tokens ou informações sensíveis sem aviso explícito;
- quando a URL possuir parâmetros potencialmente sensíveis, oferecer remover query/hash antes de salvar;
- após salvar, atualizar imediatamente storage, popup, Options/Workspace Studio e toolbar, sem exigir reinicialização da extensão;
- exibir feedback claro de sucesso ou erro;
- respeitar entidades fixas/travadas e permissões do plano;
- manter compatibilidade com importação/exportação e normalização de workspaces já existentes;
- funcionar corretamente em navegação SPA e após mudança de URL na aba;
- adicionar internacionalização em PT-BR, ES e EN;
- adicionar testes unitários e smoke test real-Chrome para o fluxo completo.

Fluxo esperado:

1. o usuário abre uma página de DEV, QA, BETA, STAGE ou outro ambiente de testes;
2. clica no ícone da QA Toolbar Sandbox;
3. escolhe **Salvar URL no ambiente**;
4. a extensão preenche a URL atual;
5. o usuário seleciona ou confirma workspace, produto e ambiente;
6. visualiza o padrão que será salvo;
7. confirma;
8. a URL passa a ser reconhecida imediatamente pela toolbar naquele ambiente.

Critérios mínimos de aceite:

1. a URL da aba ativa é preenchida automaticamente e corresponde à aba em que o popup foi aberto;
2. o cadastro é persistido na estrutura oficial de vínculos de URL, sem criar formato paralelo;
3. URLs duplicadas ou conflitantes são tratadas de maneira explícita;
4. parâmetros sensíveis não são persistidos silenciosamente;
5. a toolbar reconhece o novo vínculo imediatamente ou após um refresh controlado e explicado;
6. o fluxo funciona em temas claro e escuro e com navegação por teclado;
7. os testes garantem que o recurso não sobrescreva workspaces, ambientes ou URLs existentes indevidamente;
8. `*` funciona como curinga universal, inclusive quando utilizado sozinho para representar tudo no escopo selecionado;
9. Cliente, Projeto e Produto nunca recebem `*` como valor ou rótulo de URL; ao selecioná-los, a interface apresenta a URL concreta correta;
10. quando existe apenas um padrão global e nenhuma URL concreta, a interface informa isso claramente e não tenta navegar para `*`;
11. o usuário consegue alternar entre URL completa e caminho relativo, por exemplo `https://google.com/teste` e `/teste`, sem modificar o vínculo salvo;
12. copiar, abrir ou navegar sempre utiliza a URL absoluta válida, mesmo quando o modo de exibição selecionado é relativo;
13. o modo relativo não é oferecido quando não existe uma URL base concreta capaz de gerar o caminho.

### 5.27 Itens fixados

Diferenciar visualmente:

- fixados padrão;
- fixados customizados;
- fixados manualmente pelo usuário.

Sugestão:
- pin discreto no canto superior direito;
- tooltip explicando origem;
- permitir ordenar;
- respeitar atalhos;
- manter responsivo.

### 5.28 Ícones

- destacar melhor;
- usar ícones diferentes e reconhecíveis;
- manter consistência de stroke/tamanho;
- não depender apenas de cor;
- usar versão Tampermonkey como referência de legibilidade;
- revisar contraste e estados disabled/active/hover/focus.

### 5.29 Botões fechar/minimizar

- alinhar;
- padronizar em todos os drawers/sidebars;
- targets adequados para toque;
- labels acessíveis;
- minimizar sem perder estado;
- restaurar corretamente.

---

## Fase 6 — Marcadores, cliques, formas e elementos flutuantes

### 5.30 Tipos de marcadores

Criar quatro estados principais:

- Pass
- Fail
- Warning
- Question (`?`)

Evitar poluir a toolbar:
- manter um único acesso principal;
- abrir menu contextual com os quatro estados;
- depois escolher o modo:
  - clique temporário;
  - marcador fixo;
- menus encadeados devem ser claros e navegáveis.

### 5.31 Modo clique

- substitui o ponteiro/mostra indicador visual por aproximadamente dois segundos;
- esmaece e desaparece;
- disponível para Pass, Fail, Warning, Question e Forms;
- para formas, manter linha e seta onde necessário;
- tamanho padrão menor;
- não obrigar usuário a redimensionar toda vez;
- respeitar zoom e DPR.

### 5.31.1 Visualização em tempo real de cliques e teclas repetidas

Melhorar os indicadores visuais de **Mouse View** e **Key View** para que cada interação seja perceptível individualmente, inclusive quando o usuário repete rapidamente o mesmo clique ou a mesma tecla.

#### Mouse — cliques únicos e repetidos

Problema atual:
- um clique isolado é perceptível;
- vários cliques rápidos no mesmo botão parecem um único clique prolongado;
- o usuário não consegue distinguir visualmente quantos cliques foram executados nem acompanhar cada acionamento em tempo real.

Comportamento esperado:
- cada `mousedown`/`pointerdown` deve gerar um novo pulso visual imediatamente, mesmo que o clique anterior ainda esteja animando;
- não reutilizar apenas um estado visual contínuo que pareça botão segurado;
- permitir animações sobrepostas ou reiniciadas de forma claramente segmentada, sem travar a interface;
- diferenciar, quando aplicável, botão esquerdo, direito, central e botões adicionais do mouse;
- mostrar estado de botão realmente mantido pressionado somente enquanto o evento de pressão continuar ativo;
- ao soltar, remover o preenchimento de pressão e concluir a animação do clique;
- para cliques repetidos no mesmo botão dentro de uma janela curta, exibir um badge/pill com contador, por exemplo `×2`, `×3`, `×4`;
- atualizar o contador a cada novo clique, sem esperar a animação anterior terminar;
- após um intervalo sem novos cliques, ocultar o contador de maneira discreta e reiniciar a contagem no próximo grupo;
- não confundir clique duplo real com botão mantido pressionado;
- preservar boa performance mesmo durante muitos cliques consecutivos.

#### Teclado — repetição, pressão e contador

Problema atual:
- ao pressionar a mesma tecla várias vezes, a interface pode parecer estática;
- não fica claro se ocorreram novos acionamentos;
- o estado visual não representa com clareza quando a tecla está fisicamente pressionada.

Comportamento esperado:
- em cada novo `keydown` válido, produzir uma resposta visual imediata;
- enquanto a tecla estiver pressionada, aplicar um preenchimento/destaque no keycap, simulando uma tecla física sendo pressionada;
- no `keyup`, remover o estado pressionado com uma transição curta;
- caso a mesma tecla seja acionada repetidamente, mostrar badge/pill com quantidade, por exemplo `A ×3`, `Enter ×2` ou um badge `×3` anexado ao keycap;
- o contador deve atualizar em tempo real a cada novo acionamento;
- eventos automáticos de repetição do sistema (`event.repeat`) devem ter tratamento explícito e configurável:
  - por padrão, podem incrementar o contador para representar caracteres/ações realmente enviados;
  - não devem fazer a tecla parecer permanentemente travada;
- combinações como `Ctrl + C`, `Shift + Tab` e `Ctrl + Shift + P` devem continuar agrupadas e legíveis;
- ao repetir a mesma combinação, incrementar o contador da combinação inteira;
- ao trocar de tecla ou combinação, criar uma nova entrada/estado conforme o comportamento já definido pelo Key View;
- teclas modificadoras devem permanecer destacadas somente enquanto estiverem pressionadas;
- evitar contagens duplicadas causadas por listeners em mais de uma fase ou por eventos sintetizados.

#### Aparência e temas

- o estado normal, hover, pressionado, repetido e liberado deve ser visualmente distinto;
- o preenchimento de tecla/botão pressionado deve ter contraste suficiente nos temas claro e escuro;
- badges/pills de contagem devem combinar com o design system existente;
- usar bordas, sombras e cores sem depender somente da cor para transmitir estado;
- garantir legibilidade em zoom do navegador, diferentes DPRs e telas pequenas;
- respeitar `prefers-reduced-motion`, reduzindo pulsos sem eliminar a confirmação visual;
- evitar animações excessivas ou piscadas agressivas.

#### Configurações recomendadas

Disponibilizar, quando fizer sentido no painel de configurações:
- ativar/desativar contador de repetições;
- intervalo usado para agrupar interações repetidas;
- duração da animação de clique/tecla;
- contar ou ignorar `event.repeat`;
- tamanho do badge/pill;
- nível de animação compatível com reduced motion.

#### Critérios de aceite

1. Cinco cliques rápidos no botão esquerdo aparecem como cinco respostas visuais, e não como um único botão segurado.
2. O contador do mouse progride em tempo real até `×5`.
3. Manter o botão pressionado apresenta um estado contínuo diferente de vários cliques rápidos.
4. Pressionar a mesma tecla três vezes apresenta três respostas visuais e contador `×3`.
5. Enquanto uma tecla está fisicamente pressionada, seu keycap possui preenchimento/destaque ativo; ao soltar, o estado é removido.
6. Combinações repetidas, como `Ctrl + C` três vezes, apresentam contador da combinação sem duplicar eventos.
7. Mouse View e Key View continuam funcionais nos temas claro e escuro.
8. O recurso não intercepta, atrasa ou modifica o clique e a digitação reais da página.
9. Os listeners são removidos corretamente ao desativar a ferramenta, sem vazamentos ou contagens duplicadas ao reativá-la.
10. Adicionar testes automatizados e smoke test real no Chrome cobrindo clique rápido, clique mantido, tecla repetida, `event.repeat`, combinação e alternância de tema.

### 5.32 Marcador fixo

- permanece na página;
- pode ser movido;
- menu de contexto;
- editar;
- redimensionar;
- duplicar;
- fechar;
- confirmar/cancelar alterações;
- estado inicial limpo com botão hamburger discreto.

### 5.33 Menu hamburger em todo elemento flutuante

Aplicar a tudo que for flutuante:
- Pass;
- Fail;
- Warning;
- Question;
- Forms;
- linha;
- seta;
- notas;
- shapes;
- outros overlays.

Menu:
- editar;
- redimensionar;
- duplicar;
- excluir/fechar;
- quando estiver editando, mostrar confirmar e cancelar;
- ao concluir, voltar ao estado compacto;
- não sobrepor handle de resize;
- adaptar quando o elemento ficar muito pequeno;
- garantir touch/mobile.

### 5.34 Limpar elementos

- restaurar ação “Limpar todos”;
- permitir limpeza por tipo;
- confirmação quando houver risco;
- desfazer quando viável;
- não obrigar fechar um por um.

---

## Fase 7 — Toasts, balloons e componentes compartilhados

### 5.35 Toasts

Substituir mensagens centralizadas no rodapé por toasts modernos:

- animação discreta;
- sucesso, informação, aviso e erro;
- título opcional;
- descrição;
- ação opcional;
- fechamento;
- tempo adequado;
- pausa no hover;
- região `aria-live`;
- empilhamento;
- não cobrir controles importantes;
- mobile;
- tema;
- reduced motion.

### 5.36 Balloons e menus contextuais

- substituir tag/pill simples do clique direito por balloon moderno próximo ao cursor;
- manter dentro da viewport;
- seta/âncora;
- foco por teclado;
- fechar ao clicar fora/Escape;
- não conflitar com menu nativo quando o recurso não estiver ativo.

### 5.37 Design system/componentização

Criar/reutilizar componentes ou módulos compartilhados para:
- Button;
- IconButton;
- Toast;
- Balloon/Popover;
- ContextMenu;
- Header;
- Sidebar/Drawer;
- BottomSheet;
- Card;
- EmptyState;
- Tooltip;
- ConfirmDialog;
- Loading/Skeleton;
- ErrorState;
- QuickAction;
- FloatingElementMenu.

Não fazer refatoração massiva sem testes. Migrar gradualmente, mantendo comportamento.

---

## Fase 8 — Sidebars, drawers e responsividade

### 5.38 Redimensionamento e posição

Todos os sidebars compatíveis devem:
- redimensionar horizontalmente arrastando a borda;
- respeitar largura mínima/máxima;
- poder abrir à esquerda;
- poder abrir à direita;
- opcionalmente abrir em janela separada quando tecnicamente seguro;
- persistir preferência;
- não quebrar a página hospedeira.

### 5.39 Navegação interna

- adicionar botão voltar;
- exemplo: Inspectores > detalhe deve voltar à lista sem fechar tudo;
- usar breadcrumb ou stack de navegação;
- preservar filtros e scroll;
- não exigir fechar/reabrir.

### 5.40 Mobile

- toolbar não pode quebrar em múltiplas linhas desorganizadas;
- permitir posição por dispositivo:
  - desktop: cima/baixo/esquerda/direita;
  - mobile: configuração independente;
- sidebars mobile devem virar bottom sheets quando apropriado;
- abrir de baixo para cima;
- drag handle;
- altura responsiva;
- respeitar safe areas;
- teclado virtual;
- foco;
- rolagem;
- plano de contingência para tour funcionar no mobile;
- não usar hover como única interação.

---

## Fase 9 — Temas e personalização visual

### 5.41 Tokens de tema

Além de claro/escuro, permitir personalização dos tokens:

- primary;
- secondary;
- highlight-primary;
- highlight-secondary;
- success;
- warning;
- danger/alert;
- info;
- light;
- dark;
- muted;
- surfaces;
- borders;
- focus ring.

### 5.42 Temas prontos

Criar 24 temas:
- 12 claros;
- 12 escuros.

Explorar famílias como:
- branco;
- preto;
- cinza;
- vermelho;
- dourado;
- azul;
- ciano;
- rosa;
- verde;
- laranja;
- bege;
- marrom.

Requisitos:
- combinações acessíveis;
- contraste WCAG onde possível;
- não criar artefatos;
- aplicar à toolbar, drawers, toasts, buttons, Key View e mouse;
- preview;
- reset;
- export/import de preferência;
- impedir escolha ilegível ou alertar.

### 5.43 Atalhos customizáveis

Criar tela de configuração:
- listar funcionalidades;
- clicar e pressionar combinação;
- detectar conflitos;
- impedir combinações reservadas;
- reset por item e global;
- importar/exportar;
- indicar atalho no menu;
- funcionar em PT/EN/ES;
- respeitar limitações do Chrome Extension Commands API quando aplicável.

---

## Fase 10 — Captura de elementos, Click Spy e automação

### 5.44 Click Spy

Adicionar ao resultado:
- `id`;
- `data-test-id`;
- `data-testid` se existir;
- `role`;
- tag;
- tipo;
- name;
- texto acessível;
- CSS selector;
- XPath;
- endpoint/ação relacionada quando identificável com segurança.

### 5.45 Capturar Elementos

Garantir que:
- apareça no menu;
- lista todos os elementos interativos;
- cards em vez de tabela quando melhorar a UX;
- filtro por tipo/propriedade;
- hover no card destaca elemento;
- botão localizar só aparece quando o elemento está renderizado;
- clicar localizar rola até ele;
- exportação CSV com colunas corretas;
- proteção contra CSV injection;
- data-test-id ausente destacado com warning discreto;
- incluir id, data-test-id/data-testid, role, tag, type, name, texto, selector e XPath.

### 5.46 Modo “Ver elementos” em tempo real

- opção ativável;
- selecionar 1..N propriedades:
  - `#id`;
  - `data-test-id`;
  - `role`;
  - XPath;
- desenhar labels em tempo real na página;
- filtros;
- atualização em SPA;
- MutationObserver com cuidado de performance;
- desligar facilmente;
- permanecer ativo com sidebar fechado se o toggle estiver ativo.

### 5.47 Gerador de QR Code

Criar função simples para:
- gerar QR Code das URLs salvas;
- gerar QR Code da URL da aba atual;
- copiar;
- baixar imagem;
- abrir em modal;
- validar protocolos;
- não incluir credenciais/tokens sem aviso;
- funcionar offline se possível.

---

## Fase 11 — Gravador de passos e Macro Recorder

### 5.48 Preservar funcionalidades críticas

Foi relatado que uma versão apresentada não tinha:
- gravação de macro;
- captura de elementos.

Esses recursos são críticos e não podem desaparecer de builds/releases.

Criar testes de presença e funcionamento.

### 5.49 Gravação GIF

- corrigir GIFs corrompidos;
- validar arquivo gerado;
- duração e FPS coerentes;
- feedback de processamento;
- fallback se browser não suportar;
- teste que abre/decodifica a saída.

### 5.50 Gravador de passos — identificação de elemento

Evitar frases vagas como:
- “Clique em div”.

Deve:
- encontrar o nome acessível mais útil;
- usar texto, label, aria-label, title, placeholder, name, id, data-test-id, role e contexto;
- recomendar a melhor descrição;
- permitir combobox com alternativas;
- usuário pode escolher outra propriedade;
- persistir escolha;
- evitar dados sensíveis.

### 5.51 Resultado esperado

- não deixar vazio;
- observar o que aconteceu após o clique;
- comportamento semelhante ao Click Spy;
- detectar mudança de URL, modal, toast, request, alteração de texto/estado, inclusão/remoção de elemento;
- sugerir resultado esperado editável;
- não inventar sucesso quando não houver sinal.

### 5.52 Gherkin

- Given/And/When/Then real;
- frases naturais;
- PT/EN/ES;
- sem “div” genérico;
- fase controlada mesmo quando gravação não estiver ativa;
- null guards;
- export seguro.

### 5.53 Macro Recorder

- recurso visível conforme plano;
- gravar, pausar, retomar e concluir;
- listar macros;
- reproduzir;
- importar/exportar;
- pin;
- retomada após navegação;
- proteção contra ações perigosas;
- testes end-to-end.

---

## Fase 12 — Pixel Perfect

### 5.54 Corrigir modos quebrados

Foi reportado:
- crosshair funcionava;
- inspeção de objetos funcionava;
- linhas horizontal e vertical não funcionavam.

Validar e corrigir:
- crosshair;
- linha horizontal;
- linha vertical;
- régua/medição;
- bounds/inspeção;
- scroll;
- pin;
- saída;
- temas;
- zoom;
- SPA.

### 5.55 Scroll e desligamento

- scroll deve continuar funcionando nos modos;
- scroll pode navegar hierarquia no modo bounds;
- clicar novamente na opção ativa desativa;
- item fixado também alterna;
- Escape deve sair;
- não bloquear página indevidamente.

### 5.56 Context menu

- “Inspecionar com Pixel Perfect”;
- pin imediato no elemento;
- sem ativar o elemento clicado;
- não aparecer quando não aplicável.

---

## Fase 13 — Inspectores, endpoints, Data e JSON

### 5.57 Título de inspector

Em “Meus Inspectores”:
- título criado pelo usuário deve ser o título principal;
- resultado resumido abaixo, por exemplo `GET 200`;
- exemplo:
  - `in-app-notifications`
  - `GET 200`

Nos inspectores automáticos:
- título deve ser endpoint/nome útil;
- status minimalista;
- endpoint completo em detalhes.

### 5.58 Ações de endpoint

Disponibilizar:
- copiar endpoint;
- copiar como cURL;
- copiar request;
- exportar;
- mascarar authorization, cookies e segredos;
- opção de incluir headers sensíveis somente com aviso explícito.

### 5.59 Dados estruturados

Quando retorno contiver objetos:
- preferir cards;
- destacar `order`, `id`, `name` ou `title`;
- informações secundárias discretas;
- pin/unpin por campo;
- destacar chave e valor fixados;
- botão Locate apenas se houver correspondência renderizada;
- quando valor tiver mais de duas linhas, chave em cima e valor abaixo;
- layout responsivo.

### 5.60 JSON Viewer

- objetos e arrays recolhíveis;
- expandir/recolher tudo;
- copiar JSON;
- exportar;
- copiar cURL quando houver request;
- busca/filtros funcionais;
- syntax highlighting legível no tema claro;
- corrigir filtros;
- revisar botão “-” que atualmente não agrega valor;
- virtualização para payload grande;
- mascarar segredos.

---

## Fase 14 — Validador de textos por arquivo de idioma

Criar nova funcionalidade similar ao i18n inspector:

### 5.61 Importação

- importar JSON com textos esperados;
- validar formato;
- apresentar preview;
- permitir mapear chave para texto;
- não executar conteúdo.

### 5.62 Execução na página

- comparar textos visíveis do HTML com o esperado;
- navegar pelo site mantendo ferramenta ativa;
- marcar:
  - check para igual;
  - warning para diferente;
- opcionalmente estado ausente;
- balloon no hover com:
  - chave;
  - esperado;
  - encontrado;
  - diferença;
- relatório no sidebar.

### 5.63 Ciclo de vida

- toggle pode ativar/desativar no menu Tools;
- sidebar pode fechar e análise continuar;
- ação rápida play/X;
- funciona em SPA;
- opção parar;
- limpar highlights;
- exportar relatório;
- filtros por igual, divergente, ausente e extra;
- performance segura.

---

## Fase 15 — Impressão

A QA Toolbar Sandbox nunca deve aparecer em:
- impressão de documento;
- “Salvar como PDF”;
- print preview.

Implementar:
- `@media print { ... display:none !important; }`;
- remover overlays, drawers, toasts e highlights;
- testar impressão;
- não alterar conteúdo da página hospedeira.

---

## Fase 16 — Tutoriais, tour e mídia

### 5.64 Refazer conteúdo afetado

Após as mudanças:
- atualizar tour;
- atualizar FAQ;
- atualizar tutorial-data;
- atualizar traduções;
- regenerar imagens/vídeos;
- não deixar tutorial ensinando fluxo antigo.

### 5.65 Velocidade das gravações

As gravações automáticas estavam rápidas demais.

- adicionar pausa aproximada de 2 segundos entre ações importantes;
- manter vídeo didático;
- destacar cursor/elemento;
- não criar pausas excessivas em ações pequenas;
- revisar manualmente o resultado.

### 5.66 Mobile

- tour deve ter fallback mobile;
- reposicionar spotlight;
- evitar elementos fora da viewport;
- suportar bottom sheets;
- pular etapa incompatível com explicação clara.

---

# 6. Arquitetura proposta

Antes de implementar, apresente uma proposta curta baseada no código existente. Preferir evolução incremental.

Sugestão de módulos compartilhados:

- `featureRegistry`: fonte canônica de recursos, planos, flags, labels, ícones e ações;
- `toolActivationManager`: ativa/desativa modos e resolve conflitos;
- `overlayManager`: gerencia elementos flutuantes;
- `floatingElementController`: editar, resize, duplicar, fechar;
- `notificationService`: toasts;
- `popoverService`: balloons/context menus;
- `themeTokens`: tokens e presets;
- `responsiveLayout`: posição da toolbar, sidebar e mobile bottom sheet;
- `elementLocator`: encontra e destaca elementos;
- `accessibleNameResolver`: descrição útil para gravador/spy;
- `safeExport`: CSV/JSON/cURL com sanitização;
- `tutorialScenarioRegistry`: cenários estáveis do site demo.

Não crie abstrações artificiais. Reutilize o que já existir.

---

# 7. Critérios de aceite globais

Uma demanda só pode ser marcada como concluída quando:

1. O comportamento foi implementado.
2. Existe feedback visual e acessível.
3. Funciona em tema claro e escuro.
4. Funciona em desktop e foi validado em largura mobile.
5. Pode ser desativado facilmente.
6. Não gera erro no console.
7. Respeita planos e feature flags.
8. Possui teste adequado.
9. Tutorial/FAQ foi atualizado quando necessário.
10. Não regrediu funcionalidades críticas.
11. Não aparece na impressão.
12. Não expõe segredos ou dados sensíveis.

---

# 8. Plano recomendado de implementação

## Etapa 0 — Auditoria

- branch limpa;
- status git;
- inventário de features;
- mapear arquitetura;
- comparar solicitações com código;
- registrar itens já prontos, parciais, ausentes e regressões;
- associar imagens aos componentes.

## Etapa 1 — Bugs críticos

- estado deslogado;
- workspace protegido;
- features ausentes;
- Macro Recorder;
- Capturar Elementos;
- GIF corrompido;
- Pixel Perfect quebrado;
- vouchers/admin;
- `[object Object]`;
- consistência feature flags;
- impressão.

## Etapa 2 — Ativação e UX transversal

- activation manager;
- clique para desativar;
- ação rápida;
- comando global;
- toasts;
- balloons;
- botões;
- sidebars;
- navegação voltar.

## Etapa 3 — Ferramentas QA

- capturar/ver elementos;
- Click Spy;
- gravador de passos;
- macros;
- inspectores;
- JSON/Data;
- validador de idiomas;
- QR Code.

## Etapa 4 — Overlays e marcadores

- Pass/Fail/Warning/Question;
- clique temporário;
- marcador fixo;
- menu hamburger;
- limpar todos;
- responsividade.

## Etapa 5 — Personalização e mobile

- toolbar por posição/dispositivo;
- sidebar resize/posição;
- bottom sheets;
- temas;
- atalhos;
- Key View/mouse.

## Etapa 6 — LP/Admin

- auditoria completa;
- acessibilidade;
- autenticação;
- voucher;
- pricing;
- estados de carregamento;
- admin;
- roles;
- e-mails;
- registro de software.

## Etapa 7 — Documentação e mídia

- tour;
- FAQ;
- tutoriais;
- vídeos com pausas;
- screenshots;
- documentação de features/flags.

## Etapa 8 — Validação final

Executar apenas após consolidar alterações:

- `node --check` nos JS editados;
- `npm run typecheck`;
- `npm run test`;
- `npm run security:repo`;
- `npm run security:extension`;
- builds landing/admin;
- smoke do site;
- `npm run test:chrome`;
- garantir `consoleErrors: 0`;
- revisar git diff;
- commit organizado;
- push e PR.

Não publicar sem autorização.

---

# 9. Formato de atualização durante o trabalho

Mantenha no início da resposta um checklist semelhante:

- [ ] Auditoria do estado atual
- [ ] Bugs críticos
- [ ] Feature registry/flags
- [ ] Ativação/desativação
- [ ] Toolbar e mobile
- [ ] Sidebars e componentes
- [ ] Captura/Spy
- [ ] Steps/Macros/GIF
- [ ] Pixel Perfect
- [ ] Inspectores/JSON/Data
- [ ] Marcadores e overlays
- [ ] Temas e atalhos
- [ ] LP/Admin
- [ ] Tutoriais
- [ ] Testes finais
- [ ] PR
- [ ] Deploy — bloqueado até autorização

A cada atualização:
- informe o que foi encontrado;
- quais arquivos foram alterados;
- testes específicos executados;
- riscos ou decisões;
- próximo bloco.

---

# 10. Primeira ação solicitada

Comece agora com:

1. leitura completa do repositório relevante;
2. `git status` e branch atual;
3. inventário de funcionalidades existentes;
4. comparação com este documento;
5. criação de um plano/checklist detalhado;
6. identificação de quais imagens correspondem a quais componentes;
7. correção dos bugs críticos em blocos pequenos;
8. testes direcionados durante desenvolvimento;
9. suite completa somente no final;
10. nenhuma publicação sem autorização.

Não pare apenas no planejamento: após auditar, prossiga com a implementação segura dos itens prioritários.
