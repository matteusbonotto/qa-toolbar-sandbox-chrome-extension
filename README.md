# QA Toolbar Sandbox

Extensão Chromium MV3 para QA exploratório e análise local de aplicações web. A interface roda em Shadow DOM, solicita acesso a hosts de forma opcional e mantém dados operacionais no navegador.

## Desenvolvimento

Requisitos: Node.js 22 e npm.

```bash
npm ci
npm run dev
```

Carregue no Chrome a pasta indicada pelo WXT. Por padrão, o content script é limitado a `localhost` e `127.0.0.1`; novos domínios dependem de permissão explícita do usuário.

## Validação

```bash
npm run check
```

Esse comando procura segredos e arquivos privados, executa typecheck/testes, compila todos os pacotes e inspeciona o conteúdo exato que será enviado como extensão.

## Pacote para a Chrome Web Store

```bash
npm run release:chrome
```

O ZIP pronto para upload e seu SHA-256 são gravados em `artifacts/`, pasta sempre ignorada pelo Git. O mesmo processo pode ser executado em **Actions → Build Chrome Web Store package → Run workflow**. Veja [o guia de publicação](docs/deploy/chrome-web-store.md).

## Limite público/privado

- Podem ser públicos: código da extensão, migrations, testes, arquitetura e exemplos sem valores reais.
- Permanecem locais: `.env*` reais, tokens, chaves privadas, perfis do Chrome, exports/backups, pacotes de release e runbooks internos.
- Valores `WXT_PUBLIC_*` e `VITE_*` entram no bundle e nunca podem conter credenciais de servidor.
- O antigo `tampermonkey.js` contém referências operacionais e é preservado somente no checkout local, fora do Git.

Consulte [a política de segurança](SECURITY.md), [o modelo de ameaças](docs/security/threat-model.md) e [a arquitetura](docs/architecture/overview.md).
