# Automação local do pacote técnico para o INPI

## O que acontece

Depois de um merge ou `git pull` concluído na branch `main`, o hook local `post-merge`:

1. fecha uma fotografia dos arquivos rastreados no commit atual;
2. atualiza ficha técnica, metadados, checklist e créditos de terceiros;
3. cria um ZIP em `Downloads/QA-Toolbar-Sandbox-INPI`;
4. calcula o SHA-256 do ZIP;
5. grava ao lado os relatórios `.sha256.txt` e `.report.json`.

O nome contém versão, commit e horário. Isso evita confundir pacotes de releases diferentes.

## Ativação neste computador

Execute uma vez:

```powershell
npm run prepare
```

O projeto já usa essa configuração para o hook de segurança `pre-commit`; agora o mesmo diretório também contém o `post-merge` do INPI.

## Execução manual

Na `main`:

```powershell
npm run inpi:package
```

Para ensaiar em outra branch, sem usar o resultado em um pedido oficial:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/generate-inpi-package.ps1 -AllowNonMain
```

## Regras simples para não se confundir

- O ZIP é uma fotografia do commit (`HEAD`), não de alterações ainda não commitadas.
- Merge em outra branch não gera pacote.
- O processo é exclusivamente local; não envia arquivos ao INPI, GitHub ou Chrome Web Store.
- Cada ZIP tem seu próprio hash. Nunca edite ou recompacte um ZIP depois de escolher seu hash.
- Um novo merge cria outro arquivo; não apaga nem substitui os anteriores.
- Antes do protocolo, confira autoria, titularidade, contratos, conteúdo do ZIP e exigências oficiais vigentes.

Esta automação organiza evidências técnicas. Ela não substitui o procedimento oficial, a Declaração de Veracidade ou aconselhamento jurídico.
