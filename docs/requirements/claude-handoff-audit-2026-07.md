# Auditoria do histórico entregue pelo Claude

> Atualização em 29/07/2026: a matriz abaixo registra o estado encontrado no início da auditoria
> e não deve ser usada isoladamente como estado atual. Assinatura de acesso, Steps Recorder,
> validação completa e mídia do Workspace foram integrados posteriormente. O estado operacional
> atual está em `docs/handoff/CODEX_PR121_CONTEXTO_2026-07-29.md`.

## Fonte de autoridade

Esta auditoria registra as solicitações do fundador contidas no histórico anexado em 28/07/2026.
Marcações, comentários de PR e afirmações de sucesso no histórico não são evidência. Um item só pode
ser considerado concluído quando código, teste e resultado observável confirmarem a regra.

## Matriz de requisitos

| Requisito | Estado auditado | Evidência ou divergência |
| --- | --- | --- |
| Redesenhar integralmente a tela principal do Workspace | Em correção | O wizard foi reconstruído. A primeira passada da tela principal preservou a parede de CRUD. O worktree atual substitui Estrutura por um explorador hierárquico. As demais áreas ainda precisam da aprovação visual final. |
| Wizard com oito etapas | Implementado, validação final pendente | Cliente, Projeto, Produto, Ambiente, URLs, Contas, Pagamentos e Inspectors existem no mesmo fluxo. |
| Exibir opções reais nas três últimas etapas | Implementado, validação final pendente | Contas, Pagamentos e Inspectors agora explicam escopo e campos e oferecem formulário ou CSV quando aplicável. |
| Formulários relacionais N:N | Implementado, validação final pendente | Contas e Pagamentos usam conjuntos de ambientes e produtos. O wizard repassa as seleções anteriores ao formulário. |
| Padronizar os composers CRUD | Implementado, validação final pendente | Clientes, projetos, produtos, ambientes, URLs, contas, pagamentos, catálogos, dispositivos e integrações reutilizam a mesma base de diálogo, campos e ações. |
| Exibir CRUD de dispositivos e catálogos reutilizáveis | Implementado, validação final pendente | A navegação agora expõe Dispositivos. Contas e Pagamentos expõem seus tipos. Dispositivos expõe sistemas operacionais, navegadores e vínculos N:N. |
| Corrigir ações que estouram as linhas | Implementado, validação final pendente | Ações são iconográficas. O novo explorador remove a grade antiga de três colunas da área Estrutura. |
| Eliminar autorização baseada em `active: true` local | Existe em branch separada, não integrado | O commit `087adec` adiciona tokens ECDSA assinados, mas não está nesta branch nem em `main`. A produção não pode ser considerada protegida. |
| Verificar IDOR e autorização de download | Auditado conceitualmente, prova consolidada pendente | Não existe endpoint `tools/:id/download`. O ZIP público é uma regra afirmada pelo fundador. As Edge Functions devem continuar derivando o usuário do token autenticado. |
| Remover escolha antecipada Numerado/Gherkin | Implementado | O recorder cria uma gravação única e o editor alterna a visualização posteriormente. |
| Capturar vídeo ou GIF junto da gravação de passos | Não implementado | O gravador de evidência existe separadamente, mas não há vínculo com a gravação de passos. |
| Replay dos passos sem expor Macro Studio | Não implementado | Não há ação de replay no Steps Recorder nem adaptador comprovado para seu modelo de passos. |
| Integrar Steps Recorder, Sessão de Teste e Report Builder | Parcial | Sessão de Teste abre o Report Builder com resultado e contexto. Evidências e gravações de passos ainda não são vinculadas como anexos estruturados. |
| Executar duas validações completas consecutivas do fix crítico | Não comprovado | O histórico registra falhas repetidas tratadas como flake. Isso não satisfaz o critério. |
| Deploy do fix de segurança | Não executado | Exige secret e redeploy de produção. Nenhum deploy é autorizado implicitamente. |
| Limpar lixo e legado | Implementado para os artefatos encontrados | O perfil Chrome descartável em caminho acidental foi removido e passou a fazer parte da limpeza automatizada obrigatória. |

## Critérios para declarar 100%

- Nenhum item material da matriz pode permanecer como parcial, não implementado ou não comprovado.
- O pacote deve ser criado do worktree atual depois de `npm run automation:clean`.
- `npm run test:all:clean` precisa terminar com sucesso, sem classificar falhas reproduzidas como
  flake.
- O smoke deve validar DOM, estilo, estado e persistência do Workspace em desktop e mobile.
- O fingerprint do pacote carregado e as evidências produzidas precisam ser registrados.
- Código sem referência, seletores removidos, estilos inline repetidos e componentes paralelos
  precisam ser removidos ou justificados.
- Textos PT-BR, EN e ES, tutorial, FAQ, documentação, versão e mídia devem ser atualizados quando a
  alteração final afetá-los.
- Deploy, merge, publicação, Stripe, Supabase produtivo e Chrome Web Store continuam exigindo
  autorização explícita.
