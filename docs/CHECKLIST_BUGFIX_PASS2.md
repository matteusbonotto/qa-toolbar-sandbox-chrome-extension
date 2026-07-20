# Checklist — rodada 2 de correções (2026-07-20)

> Atualizado em tempo real conforme cada item é implementado E verificado ao vivo (Playwright,
> não só leitura de código). Plano completo em `docs/adr` não se aplica aqui — o plano de
> trabalho desta rodada fica em memória de sessão; este arquivo é o rastreamento público.

## Entregáveis rápidos (fora do plano de bugs)

- [x] `bankeiro-example.json` salvo em Downloads (Cliente Bankeiro / Projeto Bullla / Produto IBK / ambiente Stage)
- [ ] Export Figma (screenshots/SVG de cada tela) — escopo separado, depois desta rodada

## Fase 1 — Ferramentas de anotação + contraste de cores

- [x] 1. Ícone no botão de redimensionar + reposicionar à esquerda do X (verificado ao vivo)
- [x] 2. Travar proporção 1:1 ao redimensionar marcadores — para de virar oval (verificado ao vivo)
- [x] 3. Editor de estilo da forma: inputs não arrastam mais a forma (verificado ao vivo, slider funcional)
- [x] 4. Notas de texto: mesma correção de ícone do item 1 (sem trabalho extra)
- [x] 4b. **Bug mais profundo achado durante a investigação**: `all:revert` também zerava a geometria
      (`fill`/`d`/`width`/`height`) e a cor de qualquer ícone SVG em elementos no light DOM — não
      só o botão de redimensionar, mas TODO ícone no modal de Test Status, marcadores, formas,
      notas e tooltip do Click Spy estava invisível ou preto. Corrigido na raiz (`toolbar.css`),
      verificado com screenshot real antes/depois.
- [x] 5. **Corrigido de verdade** — portei a lógica comprovada do `tampermonkey.js`
      (`offsetSiteFixedElements`/`keepSiteFixedElementsBelowWindowsill`): agora também detecta
      headers `position:sticky` (não só `fixed`), empurra via `top` em vez de `margin-top`
      (que não fazia nada em headers que já declaram `top` próprio), reduz o `z-index` de headers
      que tentam competir com o nosso, e — a diferença mais importante — fica monitorando
      continuamente (scroll/resize/MutationObserver/intervalo de 1s), não só quando a barra
      renderiza. Testado ao vivo com um header imediato E um que aparece 2s depois (simulando
      banner de cookie fechando): os dois ficaram corretamente abaixo da nossa barra, sem
      sobreposição. (Achei e corrigi um loop infinito real no caminho — o monitor observava as
      mesmas mudanças de estilo que ele próprio aplicava.)
- [ ] 6. Auditoria de contraste (dropdowns nativos, editores no light DOM)

## Fase 2 — Input Lab, Breakpoint Viewer, busca/filtros, largura dos sidebars

- [x] 7. Input Lab: clicar num wrapper/label agora resolve pro input real dentro dele; dica de
      Esc fica visível o tempo todo (não só no primeiro toast). Verificado ao vivo clicando fora
      do input literal.
- [x] 8. Breakpoint Viewer: slider de zoom + botões −/+ (50%-200%), aplicado igual nos dois
      painéis. Verificado ao vivo: 200% dobrou a largura renderizada exatamente.
- [x] 9. Botão de recolher busca agora só esconde os filtros — campo de busca nunca mais some.
      Verificado ao vivo nos 4 drawers que usam o padrão (Inspectors/Error Monitor/Contas/Recursos).
- [x] 10. Sidebars: praticamente já estava certo — só as chamadas sem `wide` explícito (Contas de
      teste, Meios de pagamento, Recursos, Key View, Contador, Multiclick, Input Lab, Faker Fill)
      precisavam do default mudar; Inspectors/Error Monitor/JSON Studio/Macro Studio já tinham
      `wide:true` explícito desde antes.

**Fase 2: smoke completo em Chrome real rodou limpo, 0 erros.**

## Fase 3 — Meios de pagamento, imagem de contas, Inspectors, breadcrumb

- [ ] 11. Meios de pagamento: validade/CVV/titular, botão de copiar, busca e filtro
- [ ] 12. Imagem do tipo de conta de teste aparecer também na lista de configurações
- [ ] 13. Upload de imagem genérico para meios de pagamento e recursos
- [ ] 14. Inspectors: aviso quando os padrões configurados não batem com nada capturado
- [ ] 15. Clicar no cliente/projeto/produto/ambiente do breadcrumb navega até a URL
- [ ] 16. Checkboxes em Aparência para mostrar/ocultar cada nível do breadcrumb

## Itens novos, achados/pedidos durante a sessão (fora da Fase 1-6 original)

- [x] **Checkboxes gigantes viraram switches de verdade** — o `input,select,textarea{width:100%}`
      global estava esticando os checkboxes de "Ferramentas no menu"/"Atalhos fixados" pro tamanho
      da célula do grid, sem estilo nenhum. Agora são switches (trilho + bolinha deslizante),
      tamanho fixo, cor do tema. Verificado com screenshot.
- [x] **Mobile: breadcrumb sumia inteiro e botão de configurações ficava fora da tela** — medido
      ao vivo em 379px: os botões fixos (`#right`) somavam 407px, mais largos que a barra inteira,
      espremendo o breadcrumb pra largura zero. Agora esses botões (Pass/Fail/Nota/Forma/
      Screenshot/Gravação) somem em telas estreitas e viram itens no menu Tools, sempre
      acessíveis. Confirmado ao vivo: breadcrumb voltou a aparecer, configurações ficou visível,
      e clicar em "Pass" pelo menu realmente ativa o modo de marcação.
- [ ] **Efeitos sonoros — não consegui reproduzir**: testei ao vivo (clicar em Pass) e o arquivo
      `test-pass.mp3` carrega com 200 OK, sem erro nenhum no console, `web_accessible_resources`
      configurado certo no manifest. Se ainda estiver mudo depois de testar: confira
      Configurações → Barra e aparência → "Efeitos sonoros" (checkbox/switch) e o volume da aba
      no Chrome (o Chrome lembra site mutado por aba/origem).
- [ ] Reordenar cliente/projeto/produto (drag-and-drop e/ou setas) — Fase 6
- [ ] Modo compacto por entidade (cliente/projeto/produto independentes) — Fase 6
- [ ] Editor de imagem (zoom/recorte/ajuste/centralizar) pros logos — Fase 6

## Fase 4 — Landing page: versão atual + aviso de revisão pendente

- [ ] Mostrar versão do pacote/zip na LP
- [ ] Mostrar (e comparar) a versão realmente publicada na Chrome Web Store
- [ ] Aviso "em análise do Google" quando a Store estiver defasada

## Fase 5 — Nova ferramenta "Capturar Elementos"

- [ ] Exportar CSV com elementos da tela (seletor CSS, XPath, tipo, nome, texto) para o time de automação
- [ ] Feature flag nova no banco (`elementCapture.enabled`) + aplicar de verdade em produção
- [ ] Atualizar tabela de planos na LP e em `docs/GUIA_FERRAMENTAS_QA.md`

## Fase 6 — Redesign visual/UX da tela de configurações (options.html)

- [ ] Passar tudo que fizer sentido para o padrão de badge/pill
- [ ] Itens "fáceis de adicionar" (URL patterns, campos de tag) viram chips removíveis com X
- [ ] Micro-animações e organização visual, sem poluir a tela
- [ ] Alinhamento consistente em toda a página, seguindo boas práticas de UX/UI
- [ ] Se inspirar na organização visual do painel de configurações do `tampermonkey.js` —
      distribuição dos itens e, principalmente, accordions pra recolher seções que não estão
      sendo editadas no momento (não quer tudo expandido de uma vez)
- [ ] Reordenar clientes/projetos/produtos (drag-and-drop e/ou setas ↑↓)

## O que já está confirmado certo antes desta rodada

Ver `docs/PENDENCIAS_USUARIO.md` para o estado da infraestrutura (banco, deploy, login admin) — todos
os itens de lá já resolvidos ou com ação clara registrada, não repetidos aqui.
