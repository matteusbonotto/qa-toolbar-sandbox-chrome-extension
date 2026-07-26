# Instruções obrigatórias para agentes de IA

## Autoridade de produto

As afirmações do fundador/usuário sobre comportamento, regra ou critério de aceite são a fonte
prioritária das regras de negócio. Registre-as no checklist/requisito correspondente. Não substitua
uma regra afirmada pelo usuário por preferência técnica, comportamento histórico ou teste antigo.
Se um teste contradisser a regra afirmada, o teste está desatualizado até que o comportamento seja
validado de novo.

## Antes de automatizar

1. Execute `npm run automation:clean`.
2. Recrie builds e pacotes a partir do worktree atual.
3. Use perfil Chrome descartável; não reutilize perfil manual.
4. Registre no log versão e fingerprint do código carregado.
5. Falhe se o perfil/build não puder ser apagado. Nunca continue usando cache anterior.
6. Um teste que apenas encontra código, abre uma aba ou confirma ausência de exceção não comprova
   a regra visual. Valide o resultado real no DOM/estilo/estado e, quando relevante, salve evidência.

## Mudanças de produto

Não use travessão em nenhum texto, tradução, título, placeholder, documentação ou comentário da
Landing Page, Admin e extensão. Prefira ponto, vírgula, dois-pontos, parênteses ou hífen conforme o
contexto. A verificação de repositório deve falhar se esse caractere reaparecer nesses aplicativos.

Toda PR que alterar comportamento, UI, regra, plano, flag ou fluxo deve revisar e atualizar, quando
afetados:

- testes unitários, integração e smoke;
- tutorial, tour contextual e FAQ;
- textos PT-BR, EN e ES;
- screenshots e vídeos, recriados com pausas legíveis e sem mídia antiga;
- documentação de features, planos, flags e regras de negócio;
- versão da extensão e notas de release;
- Landing Page, Admin, extensão e backend para consistência transversal;
- critérios mobile, tema claro/escuro, acessibilidade, impressão e console/worker sem erros.

Não incremente versão nem regenere mídia sem mudança correspondente, mas nunca deixe artefatos
desatualizados quando a mudança os afetar.

## Validação e relato

Antes de PR, merge ou subida, execute `npm run test:all:clean`. Além do resultado das suites,
liste explicitamente:

- bugs, erros, defeitos e regressões encontrados;
- regras de negócio ainda divergentes;
- testes ausentes ou incapazes de provar o critério;
- evidências produzidas e artefatos atualizados;
- qualquer validação não executada e o motivo.

Smoke de LP/Admin é obrigatório via `npm run smoke:lp-admin`; smoke da extensão é obrigatório via
`npm run test:chrome`. Testes live que exigem credenciais/serviços isolados devem rodar no ambiente
de teste apropriado. Nunca use dados ou segredos produtivos para fabricar uma aprovação.

Nenhum deploy, publicação na Chrome Web Store, merge, Stripe ou Supabase produtivo é autorizado
apenas porque os testes passaram. Essas ações exigem autorização explícita do usuário.
