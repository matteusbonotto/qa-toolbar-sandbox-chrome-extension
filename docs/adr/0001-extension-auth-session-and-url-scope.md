# ADR 0001 — Sessão da extensão e escopo por URL

Data: 2026-07-17  
Status: aceito

## Contexto

A extensão precisa reconhecer a conta do cliente, validar o entitlement e aparecer somente nos
ambientes que ele configurou. Um pacote MV3 é público: qualquer chave ou credencial incluída nele
pode ser extraída. A navegação de aplicações SPA também pode trocar de URL sem recarregar a página.

## Decisão

- O service worker é o único responsável pela sessão. Login e renovação passam pelas Edge Functions
  `auth-sign-in` e `auth-refresh`; nenhuma chave privada ou `service_role` entra no pacote.
- A Landing Page pode entregar uma sessão já autenticada diretamente à extensão publicada usando
  `externally_connectable`. Tokens nunca são transportados por URL.
- Antes de registrar ou executar conteúdo privilegiado, o worker valida `access-status`. Ausência de
  sessão, entitlement inativo, resposta inválida ou falha de rede bloqueiam a barra.
- Os padrões de injeção são derivados das URLs ativas dos ambientes (ou da lista personalizada). Um
  workspace sem URLs não injeta nada. Alterações no storage reconstroem o registro imediatamente.
- A página informa mudanças de histórico e a barra também observa eventos de navegação e a URL atual,
  cobrindo SPAs sem liberar uma origem fora do ambiente configurado.
- A URL visível na barra mascara parâmetros e fragmentos com nomes sensíveis.

## Consequências

- A última sessão válida pode ser reutilizada/renovada, que é o comportamento esperado ao reabrir o
  navegador; “Sair” revoga o estado local, remove a barra das abas e fecha as superfícies protegidas.
- Sem conexão com o backend, a extensão falha fechada. Isso pode ocultar temporariamente a barra, mas
  evita manter acesso privilegiado cuja autorização não pôde ser comprovada.
- Mudanças de workspace, importações e URLs de ambiente passam por uma única normalização, evitando
  vínculos órfãos e divergência entre a tela de configurações e a barra.
