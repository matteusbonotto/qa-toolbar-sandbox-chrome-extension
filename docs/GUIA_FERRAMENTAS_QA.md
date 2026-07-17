# Guia rápido — ferramentas de QA e Macro Studio

As ferramentas aparecem em **Tools** na barra e podem ser ativadas ou ocultadas em **Configurações → Barra e aparência**.

## Ferramentas rápidas

- **Contador de caracteres**: mede com/sem espaços, palavras, linhas e bytes UTF-8. Pode começar com o texto selecionado na página.
- **Multiclick**: escolha visualmente um elemento, defina de 2 a 100 cliques e o intervalo.
- **Input Lab**: selecione um input para ler suas regras e testar vazio, texto, número, caracteres especiais, Unicode e excesso de caracteres. O formulário não é enviado e o valor original volta ao final.
- **Faker Fill**: preenche a página ou um formulário escolhido com dados sintéticos. Campos sensíveis são ignorados.

## Key View

Abra **Tools → Key View** para ativar e personalizar o visualizador usado em demonstrações e gravações.

- Atalhos como `Ctrl + V` aparecem em teclas SVG com efeito 3D e desaparecem após 3 segundos.
- Escolha entre tecla preta com texto branco ou tecla branca com texto preto.
- A posição pode ser qualquer ponto de uma grade 3 × 3: esquerda, centro e direita nas faixas superior, central e inferior.
- **Modo Typing** mantém o texto digitado na tela até clicar em **Limpar**. O buffer tem no máximo 2.000 caracteres e existe somente na memória da página.
- **Visualizar mouse** desenha o mouse próximo ao ponteiro e destaca clique esquerdo, direito, meio e scroll para cima/baixo sem bloquear a interação original.

As mesmas preferências ficam disponíveis em **Configurações → Barra e aparência → Key View**.

## Macro Studio

1. Abra **Tools → Macro Studio → Gravar macro**.
2. Clique, escreva, selecione opções ou marque checkboxes na página.
3. Clique no indicador vermelho **Macro · parar** na barra.
4. Revise o fluxo no modo **Vibe Code**, dê um nome e salve.
5. Use **Coder** para copiar o teste Playwright equivalente.

Na lista de macros é possível executar, editar, fixar/desafixar no menu, exportar e excluir. **Importar** aceita o JSON gerado pelo próprio Studio; conteúdo executável ou ação desconhecida é descartado.

### Blocos disponíveis

Clique, Escrever, Selecionar, Checkbox, Tecla, Esperar, Scroll, Multiclick e Faker Fill. Os blocos podem ser adicionados pela paleta e reordenados por drag and drop.

## Privacidade e limites

- Use somente ambientes e dados de teste.
- Senhas, tokens, cartões e códigos de segurança não são gravados nem preenchidos.
- O Key View não captura digitação em campos identificados como senha, cartão, CVV, token ou segredo e nunca persiste o texto exibido.
- A extensão não executa código colado. O modo Coder é uma saída Playwright para revisão/cópia.
- Macros retomam na mesma aba após navegação, desde que a nova URL continue pertencendo a um ambiente autorizado.
- Sites com CAPTCHA, iframe de outra origem ou Shadow DOM fechado podem exigir automação Playwright dedicada.
