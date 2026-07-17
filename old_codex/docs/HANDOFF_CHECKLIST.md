# Checklist público de entrega

Este arquivo contém apenas critérios reproduzíveis. IDs de projeto, estado remoto, contas, URLs privadas e instruções com valores reais pertencem a um runbook local em `docs/internal/`, ignorado pelo Git.

## Antes de cada pull request

- [ ] `npm ci` conclui sem alteração inesperada do lockfile.
- [ ] `npm run check` passa.
- [ ] Nenhum `.env`, export, backup, perfil de navegador, certificado ou pacote aparece em `git status`.
- [ ] Novas permissões do manifest têm justificativa e revisão.
- [ ] Alterações de migrations/Edge Functions preservam autenticação, autorização e RLS.

## Antes de publicar a extensão

- [ ] Atualizar `version` em `apps/extension/package.json` conforme SemVer.
- [ ] Revisar as mudanças desde a última versão.
- [ ] Executar `npm ci && npm run release:chrome` em checkout limpo.
- [ ] Confirmar que o scan do bundle passou.
- [ ] Conferir nome, versão e permissões em `apps/extension/.output/chrome-mv3/manifest.json`.
- [ ] Validar o SHA-256 gerado em `artifacts/`.
- [ ] Testar o ZIP em um perfil descartável do Chrome antes do upload.
- [ ] Enviar somente o arquivo `*-chrome-store.zip` para a Chrome Web Store.

## Configurações recomendadas no GitHub

- repositório privado enquanto houver documentação operacional em saneamento;
- proteção de `main`/`master`, pull request obrigatório e workflow `Quality` obrigatório;
- bloquear force-push e exclusão da branch padrão;
- ativar Secret scanning, Push protection, Dependabot alerts e private vulnerability reporting;
- usar Environments para secrets de deploy e limitar quem pode aprovar releases.
