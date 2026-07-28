# Integrações — QA Toolbar Sandbox

## Estado real (não aspiracional)

| Integração | Status | O que existe hoje |
|---|---|---|
| Slack / Teams | **Disponível** (fase 1: copiar formatado) | Report Builder → "Copiar p/ Slack/Teams" gera texto em mrkdwn (`*negrito*`, sem `#`), pronto para colar num canal. Sem app OAuth, sem webhook. |
| Jira | Não implementado | Nenhum conector, nenhuma tela de configuração |
| Azure DevOps | Não implementado | Nenhum conector |
| GitHub Issues | Não implementado | Nenhum conector (existe integração de *deploy* com o GitHub via Actions, que é infraestrutura do projeto, não uma integração de produto para o usuário final) |

A Landing e a extensão **não anunciam** nenhuma dessas quatro como pronta — verificado
explicitamente na auditoria desta sessão (nenhuma menção a Jira/Azure/GitHub como recurso
disponível em `apps/landing/src/i18n/translations.ts` nem em `tutorial-data.js`). Isso é
correto: não há inconsistência de confiança aqui, é um gap de roadmap conhecido.

## Por que Slack/Teams veio primeiro

O PDF-fonte deste ciclo de trabalho já recomendava essa ordem: "Não exigir integração complexa
se o fluxo de cópia resolver inicialmente." Copiar texto formatado resolve o caso de uso mais
comum (compartilhar um relatório com o time) sem exigir:

- registro de um app OAuth (Slack/Teams exigem aprovação de admin do workspace do cliente);
- armazenamento de token de terceiro no Supabase;
- uma tela de configuração de integração no Admin.

## O que falta para Jira/Azure DevOps/GitHub (e Slack/Teams "de verdade", com webhook)

Todas as quatro precisam da mesma coisa que não está disponível para mim resolver sozinho: uma
**credencial de um app registrado na conta de terceiro do founder**. Especificamente:

1. **Jira Cloud** — um OAuth 2.0 app registrado no Atlassian Developer Console (client ID/secret)
   + escopo `write:jira-work`. Sem isso não dá para nem começar a arquitetura de conector.
2. **Azure DevOps** — um Azure AD app registration com permissão `vso.work_write`.
3. **GitHub Issues** — um GitHub App (não OAuth App simples, para não pedir acesso a todos os
   repositórios do usuário) com permissão `issues:write`.
4. **Slack (webhook)** — um Incoming Webhook URL por workspace de destino, criado pelo próprio
   usuário em `api.slack.com/apps` (não exige aprovação de admin, mas exige que o founder decida
   se isso é self-service por usuário ou uma app compartilhada).

Nenhuma dessas credenciais existe em nenhum `.env*` deste repositório hoje — não é um bug, é uma
decisão ainda não tomada. Quando o founder decidir seguir com uma delas, a arquitetura sugerida
(seção 10 do prompt original) é uma camada de conectores comum (autenticação, mapeamento de
campos, preview antes de enviar, tratamento de erro, log sanitizado) para não duplicar lógica a
cada integração nova — mas construir essa camada sem uma integração real para validar contra é
justamente o risco que `AGENTS.md` pede para evitar ("não reconstruir do zero", "não adicionar
abstração para caso hipotético").

## Painel de integrações (Admin)

Ainda não existe uma tela dedicada no Admin para gerenciar integrações — não há o que gerenciar
enquanto não existir ao menos uma integração real conectada. Quando a primeira (provavelmente
Jira, por prioridade do PDF-fonte) for implementada, essa tela deve mostrar: integração, status,
usuário, organização, data, último uso, falhas, permissões, revogação e logs seguros — nunca o
token completo.
