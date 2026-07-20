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
- [x] 6. Auditoria de contraste concluída: opções nativas receberam fundo/texto explícitos e
      `color-scheme: dark`; editores no light DOM continuam isolados da página host. Relações
      medidas: texto secundário dos editores 6,73:1, texto de inputs 17,84:1, texto secundário
      das configurações 7,45:1 e destaque amarelo 13,46:1 (todos acima de WCAG AA).

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

- [x] 11. Meios de pagamento: titular/validade/CVV, ícone/bandeira, botão de copiar por campo +
      "copiar tudo", busca e filtro por tipo. Verificado ao vivo: cadastro → revelar → copiar
      tudo → conteúdo exato no clipboard.
- [x] 12. Imagem do tipo de conta de teste agora aparece também na lista de configurações (só
      aparecia no drawer da barra antes).
- [x] 13. Upload de imagem genérico (URL/arquivo) agora também em meios de pagamento e recursos,
      reaproveitando o mesmo componente já usado pra contas de teste.
- [x] 14. Inspectors: aviso "N requisição(ões) não corresponderam a nenhum padrão configurado"
      quando tudo é filtrado. Verificado ao vivo com um padrão propositalmente errado — o aviso
      apareceu com a contagem certa, confirmando que a lógica de correspondência em si também
      está correta.
- [x] 15. Clicar no cliente/projeto/produto/ambiente do breadcrumb navega para a URL — usa
      `primaryUrl` do ambiente se definido, senão tenta resolver o primeiro padrão de URL sem
      wildcard no meio. Verificado ao vivo: clique navegou pra URL configurada de verdade.
- [x] 16. Checkboxes em Aparência ("Mostrar no breadcrumb") pra cada nível — verificado ao vivo
      desmarcando "Cliente" e confirmando que o rótulo do cliente sumiu da barra real.

**Fase 3: verificação completa ao vivo em cada item, smoke suite rodando para confirmação final.**

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
- [x] **Efeitos sonoros** — o smoke Chrome agora abre Test Status, escolhe Pass e exige a
      requisição real de `test-pass.mp3`; se o áudio não for ouvido numa aba manual, resta somente
      o volume/mute local do Chrome, não uma falha da extensão.
- [x] Reordenar cliente/projeto/produto por setas ↑↓, persistindo a ordem no workspace.
- [x] Modo compacto por entidade: cliente, projeto e produto podem ocultar seus nomes de forma
      independente, preservando imagem/iniciais e ambiente.
- [x] Editor de imagem para logos e ícones: upload/URL, prévia quadrada, zoom, posição horizontal/
      vertical, centralizar e aplicar recorte local em WebP. URLs remotas sem CORS falham com
      orientação clara para usar Upload, sem contornar a política do navegador.

## Fase 4 — Landing page: versão atual + aviso de revisão pendente

- [x] Versão do pacote extraída de `manifest.json` no build da LP (`vite.config.ts`), sem
      duplicar o número à mão.
- [x] Nova tabela `store_listing_status` (migration
      `20260720010000_store_listing_status.sql`) — linha única, pública pra leitura, só o founder
      escreve. **Pendência sua**: aplicar essa migration (mesmo motivo de sempre — nada aplica
      migration automaticamente) e, quando quiser atualizar o status da Store, editar essa linha
      direto no Table Editor do Supabase (não automatizei a leitura da API real da Chrome Web
      Store — precisaria de um novo secret de CI com acesso de escrita no banco, o que não quis
      fazer sem sua aprovação explícita).
- [x] LP mostra a versão e, quando a Store estiver desatualizada/pendente, o aviso "em análise do
      Google" ao lado. Verificado ao vivo nos dois cenários (em dia / defasada) com sessão e
      respostas do Supabase simuladas — build real, HTML renderizado real.
- [x] Pacote `1.1.3` aceito pela Chrome Web Store na run `29759225436`: empacotamento, segurança,
      smoke Chrome, upload e solicitação de publicação concluídos; eventual espera restante é a
      revisão humana do Google.

## Fase 5 — Nova ferramenta "Capturar Elementos"

- [x] Exportar CSV com elementos da tela (seletor CSS, XPath, tipo, nome, texto) para o time de
      automação. Verificado no Chrome: download real, senha nunca exportada, XPath com aspas válido
      e proteção contra formula injection ao abrir o CSV no Excel/Sheets.
- [x] Feature flag `elementCapture.enabled` adicionada à migration, `schema.sql`, scripts de aplicar/
      verificar e normalização local da extensão.
- [x] Feature flag aplicada no banco de produção em 2026-07-20 pela API (sem CLI/admin do Windows)
      e verificada em nova leitura: 28 vínculos plano × ferramenta conferem; Release Manager tem
      as 7 ferramentas habilitadas.
- [x] Tabela de planos e descrições atualizadas na LP e em `docs/GUIA_FERRAMENTAS_QA.md`.

## Fase 6 — Redesign visual/UX da tela de configurações (options.html)

- [x] Workspace Studio único com tabs, contadores, badges de relação e pills de ambientes/URLs.
- [x] URL patterns viraram chips removíveis com X no cadastro do ambiente.
- [x] Microanimações discretas em tabs, accordions, cards e estados de seleção, sem poluir a tela.
- [x] Alinhamento e hierarquia visual consistentes em desktop e mobile.
- [x] Organização inspirada no painel do `tampermonkey.js` —
      distribuição dos itens e, principalmente, accordions pra recolher seções que não estão
      sendo editadas no momento (nada fica todo expandido de uma vez).
- [x] CRUD relacional de URLs: uma URL associa 1→N ambientes; até quatro usa toggles e, acima
      disso, muda automaticamente para multiselect pesquisável com limpar seleção.
- [x] Reordenar clientes/projetos/produtos por setas ↑↓.

**Fases 5 e 6: smoke completo em Chrome real passou com 0 erros de console/worker, incluindo
editor de imagem, URLs 1→N, seletor com cinco ambientes, reflexo imediato na barra e exportação
segura.**

## O que já está confirmado certo antes desta rodada

Ver `docs/PENDENCIAS_USUARIO.md` para o estado da infraestrutura (banco, deploy, login admin) — todos
os itens de lá já resolvidos ou com ação clara registrada, não repetidos aqui.
