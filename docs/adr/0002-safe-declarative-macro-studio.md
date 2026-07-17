# ADR 0002 — Macro Studio declarativo e ferramentas locais de QA

- Status: aceito
- Data: 2026-07-17

## Contexto

A extensão precisa gravar e repetir ações, oferecer edição visual, exibir código de automação e preencher formulários. Permitir JavaScript arbitrário, usar `eval`, baixar código remoto ou capturar credenciais contrariaria o modelo de segurança do Manifest V3 e transformaria uma ferramenta de QA em um executor de código privilegiado.

## Decisão

Macros são documentos JSON locais com até 200 etapas. O executor aceita somente `click`, `fill`, `select`, `check`, `press`, `wait`, `scroll`, `multiClick` e `fakerFill`. Toda gravação, importação e persistência passa pela mesma normalização do workspace.

O modo Vibe Code edita esses blocos por drag and drop em um fluxo linear. O modo Coder gera um teste Playwright real e somente leitura. O código gerado pode ser copiado, mas nunca é executado pela extensão.

Uma execução que atravessa navegação completa guarda somente `{ macroId, index, expiresAt }` em `chrome.storage.session`, isolada pelo ID da aba no service worker e limitada a dez minutos. Nenhum valor da macro é duplicado nesse estado efêmero.

Faker Fill usa um gerador sintético local e previsível o suficiente para QA, sem rede, dependência remota ou identidades reais. Input Lab testa a validação nativa sem submeter o formulário e restaura o valor original.

## Controles de segurança

- Não existem `eval`, `new Function`, scripts remotos ou execução de código importado.
- Ações desconhecidas e propriedades excedentes são descartadas.
- Seletor, nome, descrição, valor, quantidade, intervalo e duração têm limites rígidos.
- Campos e seletores associados a senha, token, autorização, chave de API, cartão, CVV/CVC e código de segurança são bloqueados na gravação, Faker Fill e reprodução.
- A importação aceita somente `format: qts-macros`, `version: 1`, arquivo de até 1 MB e no máximo 100 macros.
- Multiclick limita a 100 cliques e intervalo máximo de 5 segundos.
- A execução continua sujeita a autenticação, entitlement e URL de ambiente autorizada.
- O estado de continuação é escopado à aba; outra aba não pode assumir a macro.

## Consequências

O usuário ganha um fluxo simples e exportável, e o código Playwright serve como ponte para uma suíte profissional. Em troca, JavaScript personalizado não é aceito e o gravador não tenta interpretar iframes cross-origin, Shadow DOM fechado, CAPTCHAs ou autenticação real. Esses limites são intencionais.

## Evidência

`scripts/test-extension-workspace.mjs` cobre normalização, limites e descarte de ações/dados sensíveis. `scripts/smoke-extension.mjs` cobre no Chrome real contador, Faker protegido, Input Lab, multiclick, gravação/reprodução, Vibe Code/Coder, importação/exportação, macro fixada e retomada após navegação, além de zero erros de console/worker.
