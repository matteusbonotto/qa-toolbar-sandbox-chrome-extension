# Checklist de lançamento — 1.4 e Gravador de Passos

Este documento separa claramente o que está pronto no ambiente de teste do que ainda pode ir para produção. Nada abaixo autoriza publicação automática na Chrome Web Store ou merge na `main`.

## Concluído no código (ambiente de teste)

- [x] MP4 com contêiner/extensão coerentes e controles normais do player.
- [x] GIF real, limitado a partes de 15 segundos; uma parte baixa diretamente e várias partes vão para ZIP ordenado.
- [x] Correções de onboarding, sincronização de sessão, tour, Linha, Borrar e Holofote.
- [x] Versão 1.4.0 sincronizada na extensão e landing page.
- [x] FAQ, tutorial e landing page atualizados para o pacote 1.4.
- [x] Build de teste separado, identificado como `[TESTE]`, com ID estável e proteção contra backend de produção.
- [x] Workflow de produção manual, protegido por confirmação e branch `main`.
- [x] Gravador de Passos separado do Macro Studio.
- [x] Captura de tela inicial, clique, clique direito, digitação consolidada, seleção, checkbox, submit, teclas relevantes e navegação SPA/hash.
- [x] Pausar, retomar, desfazer, cancelar, parar e consultar histórico.
- [x] Criação manual, edição, duplicação e exclusão de etapas.
- [x] Modos numerado e Gherkin (`Dado que/E/Quando/Então`).
- [x] Resultado esperado por etapa, recolhido por padrão.
- [x] CSV UTF-8 separado em `id, steps, resultado esperado`, com escape e proteção contra fórmula.
- [x] Textos PT-BR, ES e EN nas superfícies novas.
- [x] Valores sensíveis protegidos; senhas/tokens/cartões não são persistidos no roteiro.
- [x] Feature flag `stepsRecorder.enabled`, liberada do Smoke Test em diante.
- [x] Landing page e tutorial descrevem o Gravador de Passos.

## Validação antes de aprovar produção

- [ ] Instalar `artifacts/extension-test` em um perfil Chrome exclusivamente de teste.
- [ ] Validar uma conta Smoke Test liberada e uma conta sem entitlement bloqueada.
- [ ] Gravar um roteiro sozinho, outro junto com MP4 e outro junto com GIF maior que 15 segundos.
- [ ] Conferir pausa independente entre evidência visual e passos.
- [ ] Abrir CSV no Excel, Google Sheets e LibreOffice e conferir acentos/colunas.
- [ ] Testar senha, cartão, CVV, token, autocomplete, colagem e campos removidos do DOM.
- [ ] Testar SPA, hash, reload e navegação completa. A continuidade após reload completo permanece critério de homologação.
- [ ] Revisão manual de acessibilidade: teclado, foco, contraste e leitor de tela.
- [ ] Executar suíte completa, build da landing, smoke Chrome e verificações de segurança na versão final candidata.
- [ ] Aprovação explícita de Produto/PO e QA no ambiente de teste.

## Publicação (somente depois da aprovação)

- [ ] Criar branch/PR de release a partir das alterações homologadas.
- [ ] Revisar o diff e confirmar que nenhum arquivo, nome, chave ou endpoint de teste entrou no pacote de produção.
- [ ] Fazer merge na `main` somente após aprovação do PR.
- [ ] Gerar o pacote de produção pela ação manual, digitando a confirmação exigida.
- [ ] Fazer upload manual na Chrome Web Store e validar a versão publicada.
- [ ] Registrar data, responsável, versão, resultado do smoke de produção e plano de rollback.

## Não confundir

- `npm run package:chrome:test`: gera o pacote seguro de teste. Nunca enviar à Web Store.
- `main` + workflow manual confirmado: caminho de produção, somente depois da homologação.
- Gravador de Passos documenta o teste; Macro Studio automatiza/reexecuta ações. São produtos distintos.
