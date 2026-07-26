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

- [x] Pacote de teste instalado automaticamente em perfil Chrome descartável e sem cache.
- [x] Conta liberada e ausência de entitlement validadas no smoke isolado.
- [x] Roteiro, gravação, GIF segmentado e empacotamento cobertos por harness determinístico.
- [x] Pausa independente entre evidência visual e passos coberta.
- [x] CSV validado em UTF-8/BOM, escaping e proteção de fórmula por testes automatizados.
- [x] Senha, cartão, CVV, token, autocomplete, colagem e remoção do DOM cobertos.
- [x] SPA, hash, reload e navegação completa cobertos.
- [x] Acessibilidade automatizável: teclado, foco, contraste, nomes acessíveis e geometria cobertos.
- [x] Suíte completa, builds, smoke Chrome e segurança são gates obrigatórios da candidata.

A aprovação humana de Produto/PO e QA é um gate externo de release, não uma pendência técnica.

## Publicação (somente depois da aprovação)

- Criar branch/PR, revisar o diff, aprovar, mesclar, empacotar, publicar na Chrome Web Store e
  registrar responsável/rollback são gates externos de release. Nenhum deles deve ser marcado
  como concluído localmente nem executado sem autorização explícita.

## Não confundir

- `npm run package:chrome:test`: gera o pacote seguro de teste. Nunca enviar à Web Store.
- `main` + workflow manual confirmado: caminho de produção, somente depois da homologação.
- Gravador de Passos documenta o teste; Macro Studio automatiza/reexecuta ações. São produtos distintos.
