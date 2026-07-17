# Auditoria de paridade com QA CNK Sandbox Tools v5.3.25

Fontes verificadas em 14/07/2026:

- `tampermonkey.js` fornecido pelo autor (10.119 linhas, versão 5.3.25).
- `Especificacao_Tecnica_Verificada_QA_CNK_v5.3.25.md`, gerada a partir do script.
- implementação MV3 atual da QA Toolbar Sandbox.

## Regra de migração

O legado define o comportamento observável. A extensão atual pode substituir a implementação quando uma API do Tampermonkey não existe no Manifest V3, quando a alternativa reduz permissões ou quando um requisito posterior amplia o recurso. Uma substituição não pode transformar um controle funcional em decoração sem ação.

## Matriz de cobertura

| Área legada | Implementação atual | Resultado da auditoria |
| --- | --- | --- |
| Windowsill fixa, minimizar e restaurar | Shadow DOM em overlay, fora do layout hospedeiro | Conforme, com adaptação MV3 intencional |
| Identificação de projeto, ambiente e URL | Projetos e padrões configuráveis; URL acompanha SPA | Conforme e generalizado |
| Menu Tools e itens fixados | Menu, pin/unpin e reordenação persistida | Conforme |
| Test Status Pass/Fail | Pass, Fail, Block e Limitation com histórico local | Conforme e ampliado |
| Posicionamento de marcadores Pass/Fail | Modo de posicionamento por clique restaurado | Corrigido nesta auditoria |
| Notas e formas flutuantes | Posicionamento por clique, remoção, arraste e redimensionamento de forma | Corrigido nesta auditoria |
| Screenshot | `tabs.captureVisibleTab`, download PNG local | Conforme via API MV3 |
| Gravação, pausa e retomada | MediaRecorder, MP4 quando suportado e fallback WebM | Conforme e atualizado |
| Cronômetro e URL durante evidência | Cronômetro real com pausa; URL acompanha navegação SPA | Corrigido nesta auditoria |
| Conversão Convertio | Chave local, permissão sob demanda, progresso, cancelamento e GIF | Conforme e mais explícito em privacidade |
| Pagamentos sandbox | Cadastro local, busca, resumo e cópia completa sob ação explícita | Corrigido nesta auditoria |
| Contas de teste | Cadastro local, busca e cópia explícita | Corrigido nesta auditoria |
| Network/captura de payload | Performance API e bridge consentida com redaction e limites | Conforme com restrição de segurança intencional |
| Product/Member/History/Prices/Movies/Showtimes | Contextos separados e associação por hints/endpoints configuráveis | Conforme de forma generalizada; sem acoplamento CNK |
| Árvore JSON e inspeção genérica | JSON Studio e payload formatado | Conforme e ampliado |
| Erros HTTP | Histórico local e contador na toolbar | Conforme dentro dos dados expostos pelo navegador |
| Congelamento de relógio | Injeção isolada no mundo MAIN e restauração | Conforme MV3 |
| Click Spy | Captura única e seletor copiado | Conforme |
| Force HTTP | Interceptação Fetch por padrão/status, consumida uma única vez | Corrigido nesta auditoria |
| Gerador RUT | Geração e cópia local | Conforme |
| CRUD de configuração | Clientes, projetos, produtos, ambientes, contas, pagamentos, APIs, inspectors e recursos | Conforme e ampliado |
| Importação/exportação/reset | Preview, merge/replace, rollback, export seguro/completo e reset por escopo | Conforme e ampliado |
| FAQ/About/i18n | Central offline, diagnóstico seguro e PT-BR/ES | Conforme e ampliado |
| Breakpoint Viewer | Presets, frames SVG, lado a lado e fallback para bloqueio de iframe | Recurso novo preservado |
| Auth, planos, Stripe e Supabase | Controle de acesso externo e cache de entitlement assinado | Recurso novo preservado |

## Diferenças intencionais

1. O spacer do userscript não foi copiado. O legado também deslocava elementos fixos do site; transportar apenas o spacer para um shadow host inserido no `body` criou uma segunda viewport em páginas flex. O overlay MV3 preserva a toolbar sem mutar o layout do site.
2. `GM_xmlhttpRequest`, `unsafeWindow` e storage Tampermonkey foram substituídos por permissões opcionais, `chrome.scripting`, bridge com nonce e `chrome.storage.local`.
3. A gravação antiga em partes/ZIP foi substituída pelo requisito posterior de download direto MP4/WebM e conversão GIF sob demanda.
4. Inspectors específicos de rotas CNK foram generalizados por contexto e endpoint para o produto atual continuar reutilizável em outros projetos.
5. A captura de payload não é silenciosa: exige ação do usuário e aplica redaction, limite de profundidade e limite de tamanho.

## Testes de caracterização adicionados

- Pass entra em modo de posicionamento e cria marcador na coordenada escolhida.
- O status posicionado também é persistido como evidência.
- Métodos sandbox configurados podem ser pesquisados e filtrados.
- A toolbar não volta a criar spacer no documento hospedeiro.
