# Auditoria visual - 28/07/2026

> Escopo: varredura exploratória da extensão via screenshots reais (Playwright + Chrome real,
> mesma técnica do smoke test), cobrindo a toolbar nas 4 posições (topo/base/esquerda/direita) em
> desktop (1400x900) e mobile (390x844), o menu Tools aberto em cada posição, e as telas de
> Configurações (Barra e aparência, Workspace, composers de Cliente e Conta de teste) em desktop e
> mobile. Feito em resposta ao pedido de revisão visual completa nesta sessão.

## O que foi verificado e está correto

- **Modo vertical (esquerda/direita), desktop e mobile**: botão minimizar no topo da coluna,
  botão Ferramentas com um único ícone (☷), menu Tools abre ao lado da barra sem sobrepor,
  sem overlap ou corte de ícones. Confirmado via inspeção do DOM real (contagem de `<svg>`
  visíveis por botão), não só visualmente.
- **Item de demonstração travado (`locked: true`)**: confirmado via HTML real que a linha
  "Toolbar" no Workspace mostra somente o badge "🔒 Fixo", sem nenhum botão de CRUD - o fix desta
  sessão está funcionando.
- **Accordion "Barra e aparência"**: renderiza corretamente com "Tema" expandido e as demais
  seções fechadas, ordem correta.

## Bugs visuais encontrados e corrigidos

1. **Badge do filtro "Ambientes" cortava o próprio nome do campo.** No composer de Conta de
   teste/Meio de pagamento, o texto do placeholder obrigatório ("Selecione ao menos um ambiente")
   era longo demais para o badge de ~110px, e o corte por `text-overflow:ellipsis` afetava até o
   rótulo do campo ("Ambi…" em vez de "Ambientes"). Corrigido: o rótulo do estado
   obrigatório-vazio agora é uma palavra curta ("Obrigatório"), a borda vermelha já comunica
   "atenção necessária" sem precisar da frase inteira.
   Arquivos: `apps/extension/src/options/options.js`, `options-i18n.js`.
2. **Placeholder "Ícone do tipo (opcional)" cortado sem elipse visível**, lendo como texto
   quebrado no meio da palavra. Encurtado para "Ícone (opcional)".
   Arquivo: `apps/extension/src/options/options.html`.
3. **Input de URL do logo/imagem (`imageInputGroup`) espremido**, cortando "URL do logo" para
   "URL do lo…" em qualquer composer com esse campo (Cliente, Projeto, Produto). O grupo
   compartilhava só 220px com os botões de alternância URL/Upload; aumentado para 280px e o
   próprio input ganhou `flex-basis` dedicado.
   Arquivo: `apps/extension/src/options/options.css`.

## Observado, não corrigido nesta rodada (pré-existente, não é regressão desta sessão)

- **Linhas do Workspace Studio (Clientes/Projetos/Produtos) com scroll horizontal.** Um item não
  travado mostra até 6 ações (↑ ↓ Editar Duplicar Pausar Excluir) dentro de um card de ~300px
  (grid de 3 colunas) - não cabe, e a linha rola lateralmente para revelar "Excluir". Funciona,
  não está quebrado, mas não é elegante. Consertar direito significa redesenhar o componente de
  ações da linha (ex.: menu "⋮" para as ações secundárias em telas estreitas) - fora do escopo
  desta rodada de correções pontuais.

## Pendente desta sessão (fora do escopo do que foi entregue)

O pedido de reconstrução visual completa do wizard de configuração do Workspace e dos formulários
CRUD (novo fluxo passo a passo, componentização, benchmarking com produtos de mercado) **não foi
feito nesta rodada** - é um projeto de redesenho de UI substancialmente maior que os itens acima
(que são todos correções pontuais e verificadas). Entregar isso com a qualidade pedida
("impressionante", "profissional") exige uma sessão dedicada, com o mesmo nível de teste real
aplicado aqui.

## Resumo executivo

- 4 posições de toolbar x 2 viewports + menu Tools = todas verificadas via screenshot real e
  inspeção de DOM; nenhuma regressão encontrada nos fixes desta sessão (double-icon, push mode,
  posição do botão minimizar).
- 3 bugs visuais reais de truncamento de texto encontrados e corrigidos (facet obrigatório,
  placeholder de ícone, input de URL do logo).
- 1 rough edge de UX identificado e documentado (scroll horizontal nas linhas do Workspace),
  deliberadamente não corrigido agora por exigir um componente novo, não um ajuste pontual.
- Suite completa (`npm test` + `npm run test:chrome` com Chrome real, 0 erros de console/worker)
  e scans de segurança (`security:repo`, `security:extension`) passando após todas as mudanças.
