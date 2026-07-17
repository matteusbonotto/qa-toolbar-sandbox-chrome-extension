# Threat model inicial

| Ameaça | Controle obrigatório |
| --- | --- |
| Página falsifica mensagens | Nonce por aba, tipos permitidos, Zod, vínculo tab/frame e limites |
| XSS por payload | Renderização como texto, protocolos permitidos, CSP, sem `eval`/`new Function` |
| Import malicioso | Schema estrito, limites de tamanho/profundidade, bloqueio de chaves perigosas, staging e rollback |
| Exfiltração | Local-first, host permission opt-in, redaction antes de export/log/notificação |
| Roubo de segredo local | Vault AES-GCM opt-in; senha mestra nunca persistida; auto-lock; comunicação honesta de limites |
| Elevação de plano/role | Entitlement assinado, RLS deny-by-default e mutações críticas somente por Edge Function |
| Replay de licença/webhook | Nonce/idempotência, chave hasheada no servidor, assinatura e unicidade de evento |
| Abuso administrativo | MFA/reauth, motivo, autorização server-side e audit log |

Trust boundaries: página ↔ content; content ↔ background; background ↔ storage; extensão ↔ Supabase; Edge ↔ banco/provider; admin ↔ Edge. Nenhum dado da página é confiável.
