# Guia rápido — ferramentas de QA e Macro Studio

As ferramentas aparecem em **Tools** na barra e podem ser ativadas ou ocultadas em **Configurações → Barra e aparência**.

## Ferramentas rápidas

- **Contador de caracteres**: mede com/sem espaços, palavras, linhas e bytes UTF-8. Pode começar com o texto selecionado na página.
- **Multiclick**: escolha visualmente um elemento, defina de 2 a 100 cliques e o intervalo.
- **Input Lab**: selecione um input para ler suas regras e testar vazio, texto, número, caracteres especiais, Unicode e excesso de caracteres. O formulário não é enviado e o valor original volta ao final.
- **Faker Fill**: preenche a página ou um formulário escolhido com dados sintéticos. Campos sensíveis são ignorados.

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
- A extensão não executa código colado. O modo Coder é uma saída Playwright para revisão/cópia.
- Macros retomam na mesma aba após navegação, desde que a nova URL continue pertencendo a um ambiente autorizado.
- Sites com CAPTCHA, iframe de outra origem ou Shadow DOM fechado podem exigir automação Playwright dedicada.
