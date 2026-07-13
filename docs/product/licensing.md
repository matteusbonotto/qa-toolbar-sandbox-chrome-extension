# Licenciamento e entitlements

Fonte de verdade: `plans + features + planFeatures + grants + overrides`. Precedência: revogação/deny, override, grant, plano. O backend resolve e emite snapshot ES256 contendo usuário, instalação, versão, emissão e expiração. A extensão possui apenas a chave pública.

O serviço local expõe `can(feature)`, `limit(feature)`, `usage(feature)` e `remaining(feature)`. Limites são aplicados nos services/repositories, nunca somente na UI. A instalação usa UUID aleatório, sem fingerprint. Expiração jamais bloqueia exportação ou exclusão dos dados do usuário.

| Capacidade | Free inicial | Pro inicial |
| --- | ---: | ---: |
| Workspaces | 1 | 10 |
| Projetos | 2 | 50 |
| Contextos por projeto | 3 | 25 |
| Ambientes por projeto | 4 | 20 |
| Contas | 10 | 500 |
| Métodos sandbox | 5 | 100 |
| Monitores | 3 | 100 |
| Histórico de rede | 200 / 1 dia | 10.000 / 30 dias |
| JSON | Tree + Raw | Diff + Schema + comparação |
| Export/import | Seguro + replace | Completo + merge + templates |
| Notificação | Toast + badge | Nativa + som consentido |
| Evidência | Screenshot + markers | Gravação + annotations completas |

Os valores são defaults bootstrap e serão configuráveis no catálogo backend.
