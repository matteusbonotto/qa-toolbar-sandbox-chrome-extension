# Backlog de produto recebido em 28/07/2026

Este documento registra as regras afirmadas pelo fundador e a prova usada para considerar cada
item concluído. Marcar um item exige comportamento implementado, teste compatível e evidência
visual quando aplicável.

## Acesso, onboarding e conteúdo

- [x] 01. Novos usuários recebem 30 dias de Release Manager. Migração, seleção de entitlement e
  testes de prioridade impedem voucher ou grant inferior de reduzir o acesso.
- [x] 02. Tour atualizado para a navegação lateral, Workspace hierárquico e nove etapas do wizard.
  O smoke percorre o tour completo e valida cada painel realmente aberto.
- [x] 03. As 30 imagens e os 30 vídeos de Tutorial e FAQ foram recriados a partir do worktree atual.
- [x] 04. Minha conta usa uma grade responsiva, hierarquia de conta/plano e cards com respiro.
- [x] 17. Cada cadastro obrigatório do wizard abre confirmação de sucesso com as opções de
  cadastrar outro item ou continuar.
- [x] 17.1. Contas, pagamentos, dispositivos e Inspectors oferecem exemplo e importação CSV.
- [x] 17.2. Dispositivos é a etapa 8 do wizard. Inspectors passou a ser a etapa 9.

## Aparência e preferências

- [x] 05. Restaurar tema padrão está separado por margem, divisor e área de ação própria.
- [x] 06. A interface exibe nove famílias uma única vez. Claro ou Escuro escolhe a variante.
- [x] 07. A opção de lista personalizada não existe na interface. Dados antigos continuam sendo
  normalizados somente para não quebrar instalações existentes.
- [x] 08. Sidebar e toolbar aparecem lado a lado com thumbnails SVG vivas que acompanham a posição.
- [x] 09. Preferências gerais possui prévia viva do breadcrumb e da toolbar.
- [x] 10. Reserva de espaço funciona nas quatro bordas da toolbar e da sidebar.
- [x] 11. Sidebar superior e inferior usa largura total e respeita a toolbar na mesma borda.
- [x] 12. Visibilidade, ordem e modo compacto do breadcrumb usam uma única lista com prévia.
- [x] 13. Menu, fixação, ordem e atalho de cada ferramenta usam uma única lista.
- [x] 14. Atalhos aceitam teclas simples, teclas nomeadas e combinações. Somente modificadores
  isolados e conflitos já utilizados são rejeitados.
- [x] 15. Salvar permanece em um rodapé fixo.
- [x] 18. Settings compartilha tokens, campos, accordions, diálogos e ações responsivas.
- [x] 30. Ferramentas e ações usam nomes orientados ao resultado, como Definir status do teste,
  Observar endpoints e Testar tamanhos de tela.

## Workspace

- [x] 16.1. O bloco Workspace pronto para testar foi removido.
- [x] 16.2. O cabeçalho foi refeito com título, criação guiada e busca global alinhados.
- [x] 16.3. Cliente, Projeto e Produto são accordions realmente aninhados.
- [x] 16.4. Adicionar fica no cabeçalho de cada nível. Cores e conectores diferenciam os ramos.
- [x] 16.5. Ambientes exibem uma toolbar na própria cor. URLs usam árvore filtrável por Ambiente,
  Cliente, Projeto e Produto.
- [x] 16.6. O formulário de URL permite multisseleção de ambientes e produtos.
- [x] 16.7. Todos os CRUDs reutilizam a mesma anatomia de diálogo, campos e ações.
- [x] 16.8. Sistemas e navegadores conhecidos usam imagens PNG incluídas no pacote.
- [x] 16.9. Contadores, ações nos cabeçalhos, accordions e busca reduzem a poluição visual.
- [x] 19. O submenu separa Organização e Operação.
- [x] 20. Dados de teste e Inspectors não são rotas laterais independentes. São seções do Workspace.

## Toolbar e sidebar

- [x] 21. Nota de texto usa o sistema de ícones da extensão.
- [x] 22. Ferramentas fica centralizado nas toolbars laterais.
- [x] 23. Ocultar e restaurar seguem a borda atual. Topo, base, esquerda e direita possuem ordem,
  direção e canto próprios.
- [x] 24. O botão de URL possui largura, altura e proporção circular fixas.
- [x] 31. Ações de ativar e desativar ficam no rodapé fixo da sidebar. Controles estruturais ficam
  no cabeçalho.

## Qualidade e entrega

- [x] 25. Este checklist registra conclusão, explicação e prova.
- [x] Código temporário, builds, perfis Chrome e pacotes de automação são removidos antes da entrega.
- [x] PT-BR, EN e ES, testes, FAQ, tutorial, documentação, imagens e vídeos foram atualizados.
- [x] Desktop, mobile, claro, escuro, console e service worker são cobertos pelo smoke Chrome.
- [x] PRs foram auditadas. O escopo de #116 e #117 foi consolidado na #115.
- [ ] Produção: configurar `ACCESS_TOKEN_PRIVATE_KEY_JWK` e republicar `access-status`. Esta ação
  altera o Supabase produtivo e permanece bloqueada até autorização explícita do fundador.

## Incrementos adicionais identificados no handoff

- [x] Steps Recorder: captura vídeo ou GIF junto dos passos usando o gravador local existente.
- [x] Steps Recorder: oferece replay declarativo pelo executor seguro já usado pelo Macro Studio.
- [x] Steps Recorder: relaciona dispositivo, passos e evidência com Sessão de Teste e Report Builder.
