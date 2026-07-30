# Guia rápido: ferramentas de QA e Macros

As ferramentas aparecem em **Tools** na barra e podem ser ativadas ou ocultadas em **Configurações → Barra e aparência**.

## Disponibilidade por plano

Todas as ferramentas desta página são liberadas por plano (não é mais tudo-ou-nada): o item some do
menu **Tools** quando o plano ativo não inclui aquela ferramenta.

| Ferramenta | Smoke Test | Regression Runner | Root Cause Analyst | Release Manager |
|---|---|---|---|---|
| Contador de caracteres | ✓ | ✓ | ✓ | ✓ |
| Multiclick | ✓ | ✓ | ✓ | ✓ |
| Validador de campos | Não | ✓ | ✓ | ✓ |
| Auto preenchimento | Não | ✓ | ✓ | ✓ |
| Macros | Não | Não | ✓ | ✓ |
| Key View | Não | Não | Não | ✓ |
| Capturar Elementos | Não | Não | ✓ | ✓ |

A distribuição é configurável pelo founder em `/admin/` → aba **Feature flags**, sem precisar de
deploy. A tabela acima reflete a configuração padrão de fábrica
(`supabase/migrations/20260717080000_new_qa_tools_feature_flags.sql` e
`supabase/migrations/20260720020000_element_capture_feature_flag.sql`).

## Ferramentas rápidas

- **Contador de caracteres**: mede com/sem espaços, palavras, linhas e bytes UTF-8. Pode começar com o texto selecionado na página.
- **Multiclick**: escolha visualmente um elemento, defina de 2 a 100 cliques e o intervalo.
- **Validador de campos**: selecione um input para ler suas regras e testar vazio, texto, número, caracteres especiais, Unicode e excesso de caracteres. O formulário não é enviado e o valor original volta ao final.
- **Auto preenchimento**: preenche a página ou um formulário escolhido com dados sintéticos. Campos sensíveis são ignorados.

## Key View

Abra **Tools → Key View** para ativar e personalizar o visualizador usado em demonstrações e gravações.

- Atalhos como `Ctrl + V` aparecem em teclas SVG com efeito 3D e desaparecem após 3 segundos.
- Escolha entre tecla preta com texto branco ou tecla branca com texto preto.
- A posição pode ser qualquer ponto de uma grade 3 × 3: esquerda, centro e direita nas faixas superior, central e inferior.
- **Modo Typing** mantém o texto digitado na tela até clicar em **Limpar**. O buffer tem no máximo 2.000 caracteres e existe somente na memória da página.
- **Visualizar mouse** desenha o mouse próximo ao ponteiro e destaca clique esquerdo, direito, meio e scroll para cima/baixo sem bloquear a interação original.
- **Tamanhos independentes** permitem exibir teclas e mouse em Pequeno, Médio ou Grande; instalações existentes continuam em Médio.

As mesmas preferências ficam disponíveis em **Configurações → Barra e aparência → Key View**.

## Macros

1. Abra **Tools → Macros → Gravar macro**.
2. As macros salvas ficam listadas no submenu de Macros para execução rápida.
3. Clique, escreva, selecione opções ou marque checkboxes na página.
4. Clique no indicador vermelho **Macro · parar** na barra.
5. Revise o fluxo no modo **Vibe Code**, dê um nome e salve.
6. Use **Coder** para copiar o teste Playwright equivalente.

Na lista de macros é possível executar, editar, fixar/desafixar no menu, exportar e excluir. **Importar** aceita o JSON gerado pelo próprio Studio; conteúdo executável ou ação desconhecida é descartado.

### Blocos disponíveis

Clique, Escrever, Selecionar, Checkbox, Tecla, Esperar, Scroll, Multiclick e Auto preenchimento. Os blocos podem ser adicionados pela paleta e reordenados por drag and drop.

## Sessão de Teste

Abra **Tools → Sessão de Teste** para agrupar o que acontece entre "comecei a testar isso" e
"terminei" - sem isso, status marcados, evidências e erros HTTP ficam espalhados por ferramentas
separadas, sem um fio condutor. Disponível em todos os planos.

1. **Iniciar sessão de teste** captura o contexto atual (cliente/projeto/produto/ambiente/URL) e
   mostra um indicador com cronômetro na barra enquanto está ativa - nunca fica rodando escondida.
2. Durante a sessão, cada status marcado em Test Suite e cada screenshot/gravação capturada é
   contado automaticamente; erros HTTP (Error Monitor) no período também entram no resumo.
3. **Finalizar sessão** abre um resumo editável: cenário (texto livre), contexto, duração,
   resultado, evidências, contexto técnico, observações e próximos passos. Dá para **Salvar**
   (histórico local), **Copiar** (Markdown) ou **Exportar** (arquivo `.md`).

A sessão é local (`chrome.storage.local`), não faz parte do workspace exportável/importável, e
"Desativar ferramentas ativas" descarta uma sessão em andamento sem abrir o resumo (mesmo
comportamento de cancelar uma gravação de macro/passos em andamento).

## Relatórios

Abra **Tools → Relatórios** para montar um relatório estruturado (bug, aprovação,
limitação, impedimento, reteste, melhoria ou risco) sem reescrever título, passos e contexto do
zero toda vez. Disponível em todos os planos.

- Campos: tipo, título, descrição, pré-condições, passos para reproduzir, resultado esperado,
  resultado atual, severidade, prioridade e tags. Ambiente, navegador, viewport e URL são
  capturados automaticamente do contexto atual.
- **Salvar como template** guarda o formato atual (sem o resultado atual, que é específico do
  incidente) com um nome, pra reaproveitar depois - útil pra times que sempre preenchem o mesmo
  tipo de relatório com a mesma estrutura. **Carregar template** aparece assim que existir pelo
  menos um salvo.
- **Salvar rascunho**, **Copiar** (Markdown) e **Exportar** (arquivo `.md`) funcionam como nas
  outras ferramentas de evidência.
- **Exportar PDF** abre uma composição A4 minimalista com contexto, dispositivo, severidade,
  prioridade, passos e resultados. Use a caixa de impressão do Chrome para salvar o PDF.
- O botão **Criar relatório** no resumo da Sessão de Teste abre Relatórios já preenchido
  com o cenário como título e o tipo mapeado a partir do último status marcado na sessão (Pass →
  Aprovação, Fail → Bug, Blocked → Impedimento, Limitation → Limitação).

Assim como a Sessão de Teste, é local (`chrome.storage.local`) e não faz parte do workspace
exportável/importável.

## Capturar Elementos

Abra **Tools → Capturar elementos** para escanear a página atual e exportar um CSV com todos os
elementos interativos (links, botões, inputs, selects), pensado para acelerar a criação de testes
de automação.

- Cada linha traz: tag, tipo, `name`, `id`, seletor CSS único, XPath, texto/label visível,
  placeholder e um marcador `sensitive` para campos identificados como senha/cartão/token.
- **Nenhum valor digitado é exportado**. Apenas dados estruturais e localizadores são incluídos,
  nunca o conteúdo de um campo.
- **Recapturar** refaz a varredura (útil após a página mudar); **Exportar CSV** baixa o arquivo com a data do dia no nome.

## Privacidade e limites

- Use somente ambientes e dados de teste.
- Senhas, tokens, cartões e códigos de segurança não são gravados nem preenchidos.
- O Key View não captura digitação em campos identificados como senha, cartão, CVV, token ou segredo e nunca persiste o texto exibido.
- O Capturar Elementos nunca exporta o valor digitado em nenhum campo, apenas seletor/XPath/metadados estruturais.
- A extensão não executa código colado. O modo Coder é uma saída Playwright para revisão/cópia.
- Macros retomam na mesma aba após navegação, desde que a nova URL continue pertencendo a um ambiente autorizado.
- Sites com CAPTCHA, iframe de outra origem ou Shadow DOM fechado podem exigir automação Playwright dedicada.
## Monitor de endpoint

O histórico local registra data, hora, método, status e URL das requisições capturadas. Em
**Meus Inspectors**, cada regra mostra a quantidade e os registros mais recentes. Use
**Exportar histórico CSV** para baixar os registros ou **Limpar histórico** para removê-los.
