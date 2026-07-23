# TESTE e PRODUÇÃO — guia simples

## A ideia em uma frase

Você desenvolve e experimenta na versão **[TESTE]**. A versão normal, usada pelos clientes, só é
atualizada depois que os testes passam e você aprova explicitamente a promoção.

| Ambiente | Como reconhecer | Onde fica o código | Pode ir para a Store? |
|---|---|---|---|
| TESTE | Nome `QA Toolbar Sandbox [TESTE]` e selo amarelo `TESTE` na barra | Branch `feature/...` ou `fix/...` | Não |
| PRODUÇÃO | Nome normal, sem selo | Branch `main` | Sim, somente com confirmação manual |

As duas extensões podem ficar instaladas ao mesmo tempo porque usam pastas/perfis diferentes.
Para não confundir dados, o pacote TESTE também recusa o backend de produção.

## Primeira configuração do ambiente de teste

Escolha uma das opções:

1. **Mais simples para desenvolvimento local:** rode o Supabase local do projeto. O endereço padrão
   já será `http://127.0.0.1:54321/functions/v1`.
2. **Para uma equipe testar pela internet:** crie um segundo projeto Supabase somente para teste,
   aplique as mesmas migrations e configure localmente:

```powershell
$env:QTS_TEST_FUNCTIONS_BASE_URL="https://SEU-PROJETO-TESTE.supabase.co/functions/v1"
```

Nunca use a URL do Supabase de produção nessa variável. O script bloqueia isso automaticamente.
O ID fixo da extensão de teste é `dppfhjpccijidcpbmmcdlbhoknkdjoll`; inclua somente esse ID na
allowlist do backend de teste.

Para iniciar ou zerar o backend local de teste:

```powershell
npm run backend:test:start
npm run backend:test:reset
```

Para encerrá-lo: `npm run backend:test:stop`.

Para testar também a landing page, copie `apps/landing/test-env.template` para
`apps/landing/.env.test.local`, coloque a chave pública/anon do Supabase de teste e rode
`npm run dev:landing:test`. Para o painel admin, copie `apps/admin/test-env.template` e rode
`npm run dev:admin:test`.

## Rotina diária: desenvolver e testar

1. Crie uma branch. Exemplo:

```powershell
git switch main
git pull
git switch -c feature/minha-melhoria
```

2. Faça a alteração.
3. Abra a extensão de teste:

```powershell
npm run dev:extension:test
```

4. No Chrome, confirme que aparece **[TESTE]** no nome e o selo amarelo **TESTE** na toolbar.
5. Faça os testes. Nada desse comando é enviado à Chrome Web Store.
6. Rode a validação antes de pedir aprovação:

```powershell
npm run typecheck
npm test
npm run security:repo
npm run security:extension
npm run test:chrome
```

7. Abra um Pull Request da sua branch para `main`. O PR é o local para revisar e aprovar.

## Quando os testes forem aprovados

1. Faça o merge do Pull Request em `main`.
2. O GitHub gera o pacote de produção, mas **não envia automaticamente à Store**.
3. Na aba **Actions**, abra `Build Chrome Web Store package` e clique em **Run workflow**.
4. Selecione a branch `main`.
5. Digite exatamente `PUBLICAR PRODUCAO`.
6. Marque a opção de enviar para revisão somente quando quiser lançar.

Mesmo nesse momento, o job usa o ambiente protegido `production`. É recomendável configurar uma
aprovação obrigatória em **GitHub → Settings → Environments → production**.

## Proteções contra engano

- Branch de teste não publica na Store.
- Merge em `main` apenas gera o pacote; não publica sozinho.
- O uploader aceita somente a branch `main` e exige `--confirm-production`.
- Arquivos com `teste`, `test` ou `staging` no nome são recusados pelo uploader.
- O pacote [TESTE] se recusa a usar a URL do backend de produção.
- TESTE tem nome e selo visual diferentes.

## Resumo para lembrar

**Branch → extensão [TESTE] → testes → Pull Request → aprovação → merge em main → publicação manual.**

Se ainda estiver “em avaliação”, pare antes do merge. Se foi aprovado, o Pull Request é o caminho
simples e rastreável para levar a mesma alteração à produção.
