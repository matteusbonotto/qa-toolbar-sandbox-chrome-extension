# MVP, backlog e critérios de aceite

## Fluxos e wireframe

```text
[Pulse] [Projeto / Ambiente] [Observatory] [Errors] [JSON] [More]
   \-- compacto/flutuante                  \-- painel lateral

Onboarding -> criar projeto -> cadastrar domínio -> conceder permissão
           -> regra detecta contexto/ambiente -> toolbar ativa
```

## Backlog priorizado

| ID | Entrega | Fase | Aceite resumido |
| --- | --- | --- | --- |
| FND-01 | Monorepo, WXT, TS strict, CI | Foundation | check e build reproduzíveis |
| FND-02 | Design System, i18n e motion | Foundation | light/dark e reduced motion |
| CORE-01 | Toolbar Shadow DOM | Core | sem CSS global, cleanup e teclado |
| CORE-02 | Workspace/Project/Context/Environment | Core | CRUD local validado |
| CORE-03 | Detector e Permissions Center | Core | permissão só após gesto e revogável |
| CORE-04 | Import/export | Core | preview, checksum, merge e rollback |
| OBS-01 | Bridge Fetch/XHR | Observatory | captura opt-in e limitada |
| OBS-02 | History/Error Center | Observatory | filtro, retenção e redaction |
| OBS-03 | JSON Studio | Observatory | Tree/Raw sem executar payload |
| LIC-01 | Auth/RLS/entitlements | Commercial | adulteração local não eleva plano |
| LIC-02 | Founder/licenças/instalações | Commercial | grant/revoke auditado |
| PROD-01 | Accounts/payments/evidence | Productivity | local, redacted e export seguro |

## Plano de implementação

1. Foundation: shell executável, toolbar animada, tokens, schemas, testes e CI.
2. Core local: onboarding, hierarquia, detecção, permissões e import/export.
3. Observatory: bridge, histórico, erros, JSON Studio e monitors básicos.
4. Commercial: Supabase Auth/RLS, entitlement assinado, founder, admin e licença.
5. Productivity: accounts, sandbox payments, evidências e locator.
6. Hardening: billing, lojas, Firefox, legal review, performance e segurança.

## Estado deste corte

Implementado neste incremento: Foundation e um vertical slice visual/local da toolbar. Os demais itens permanecem backlog explícito; não são descritos como concluídos.
