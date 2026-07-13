# Arquitetura proposta

## Decisões

- WXT, React e TypeScript strict para extensão MV3 Chromium; adaptação Firefox será testada por capacidade.
- Content UI é montada em Shadow DOM. A página hospedeira é tratada como origem não confiável.
- Preferências pequenas ficam em `browser.storage.local`; sessão efêmera em `storage.session`; entidades e histórico irão para IndexedDB por repositories versionados.
- UI envia commands tipados ao background. Captura futura em MAIN world atravessa uma bridge com nonce por aba, allowlist Zod e limite de volume; credenciais e licença nunca atravessam essa fronteira.
- Módulos são registrados no build. Não existe carregamento remoto de código.
- Supabase guarda identidade, roles, planos, licenças, instalações, pagamento e auditoria — nunca payloads operacionais por padrão.

```text
Host page (untrusted)
  -> validated capture bridge
Content script / Shadow DOM toolbar
  -> typed extension messages
Background service worker
  -> local repositories (browser storage + IndexedDB)
  -> Supabase Edge Functions (identity/licensing only)
```

## Estrutura

```text
apps/extension      WXT entrypoints e features
apps/admin          painel administrativo (fase comercial)
packages/domain     schemas, matching, redaction e regras puras
packages/storage    IndexedDB/repositories (próximo corte)
packages/security   vault, bridge e tokens (próximo corte)
packages/ui         design system compartilhável (extração progressiva)
supabase            migrations, seed e Edge Functions versionadas
docs                discovery, arquitetura, produto, QA, segurança e legal
```

## Motion e acessibilidade

Tokens: fast 140 ms, standard 220 ms e panel 320 ms. Animações usam `transform` e `opacity`, com easing suave; abertura de módulos tem stagger curto e o botão flutuante usa feedback elástico discreto. `prefers-reduced-motion: reduce` remove deslocamento, stagger e animações contínuas sem esconder mudanças de estado. Focus visible, Escape, nomes acessíveis e alvo mínimo são critérios P0.
