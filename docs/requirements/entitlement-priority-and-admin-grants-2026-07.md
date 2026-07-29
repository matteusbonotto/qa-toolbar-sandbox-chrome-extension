# Prioridade de acessos e concessões administrativas

## Regra de produto

Um novo voucher, trial, acesso manual, licença ou assinatura nunca pode reduzir as capacidades que
o usuário já possui por outra concessão ativa.

Quando houver mais de uma concessão ativa:

1. A concessão com mais capacidades efetivas é selecionada.
2. Se as capacidades forem equivalentes, o acesso permanente é selecionado.
3. Se ambas expirarem, a maior data de expiração é selecionada.
4. A data de criação serve apenas como último desempate.
5. Uma concessão administrativa antiga sem plano continua irrestrita por compatibilidade.

Vouchers de desconto são aplicados no checkout. Eles não alteram o plano diretamente. Vouchers de
dias ou vitalícios criam concessões, mas não substituem um acesso superior já existente.

## Regras do Admin

- O administrador seleciona o usuário cadastrado. Não digita UUID manualmente.
- Toda nova concessão administrativa exige um plano ativo.
- As origens disponíveis são cortesia manual, fundador e trial estendido.
- Voucher, licença e assinatura são gerenciados nos fluxos próprios.
- Só pode existir uma concessão administrativa ativa por usuário criada por essa tela.
- Uma data de expiração representa o fim do dia selecionado.
- A listagem informa usuário, origem, plano, expiração e status.

## Critérios de regressão

- Um voucher mais novo e inferior não rebaixa um Release Manager manual permanente.
- Entre capacidades equivalentes, uma concessão permanente vence uma temporária.
- Uma concessão administrativa legada sem plano permanece irrestrita.
- O Admin rejeita usuário inválido, plano inativo, plano ausente e duplicidade administrativa ativa.
