param(
    [string]$ProjectPath = "",
    [string]$OutputPath = "",
    [switch]$AllowNonMain
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ([string]::IsNullOrWhiteSpace($ProjectPath)) {
    $ProjectPath = Split-Path -Parent $PSScriptRoot
}
$ProjectPath = [System.IO.Path]::GetFullPath($ProjectPath)

if (-not (Test-Path -LiteralPath (Join-Path $ProjectPath ".git"))) {
    throw "O projeto informado não é um repositório Git: $ProjectPath"
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "Git não encontrado no PATH."
}

Push-Location $ProjectPath
try {
    $branch = (git branch --show-current).Trim()
    if ($LASTEXITCODE -ne 0) { throw "Não foi possível identificar a branch atual." }
    if (-not $AllowNonMain -and $branch -ne "main") {
        throw "Pacote INPI automático permitido somente na branch main. Branch atual: $branch"
    }

    $commit = (git rev-parse HEAD).Trim()
    $shortCommit = (git rev-parse --short=12 HEAD).Trim()
    $commitDate = (git show -s --format=%cI HEAD).Trim()
    $remote = (git remote get-url origin 2>$null).Trim()
    $manifestAtHead = git show "HEAD:apps/extension/manifest.json" | ConvertFrom-Json
    $version = [string]$manifestAtHead.version
    if ([string]::IsNullOrWhiteSpace($version)) { throw "Versão ausente no manifest do commit atual." }

    if ([string]::IsNullOrWhiteSpace($OutputPath)) {
        $downloads = Join-Path ([Environment]::GetFolderPath("UserProfile")) "Downloads"
        $OutputPath = Join-Path $downloads "QA-Toolbar-Sandbox-INPI"
    }
    $OutputPath = [System.IO.Path]::GetFullPath($OutputPath)
    New-Item -ItemType Directory -Force -Path $OutputPath | Out-Null

    $stamp = Get-Date -Format "yyyy-MM-dd_HHmmss"
    $temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) "qts-inpi-$stamp-$shortCommit"
    $snapshotZip = Join-Path $temporaryRoot "snapshot.zip"
    $snapshot = Join-Path $temporaryRoot "conteudo"
    $registrationDocs = Join-Path $snapshot "REGISTRO-INPI"
    New-Item -ItemType Directory -Force -Path $registrationDocs | Out-Null

    try {
        Write-Host "[INPI] Criando snapshot fechado do commit $shortCommit..." -ForegroundColor Cyan
        git archive --format=zip --output=$snapshotZip HEAD
        if ($LASTEXITCODE -ne 0) { throw "git archive falhou." }
        Expand-Archive -LiteralPath $snapshotZip -DestinationPath $snapshot -Force

        $thirdParty = @"
CRÉDITOS E COMPONENTES DE TERCEIROS

O QA Toolbar Sandbox utiliza software gratuito, publicamente disponível e open source.
Isso não significa domínio público: autoria, marcas, avisos e licenças originais permanecem válidos.

Dependências principais em produção:
- React e React DOM — interface — licença MIT.
- React Router — navegação do painel — licença MIT.
- Supabase JS — autenticação e acesso a dados — licença MIT.
- Bootstrap Icons — ícones da landing page — licença MIT.

Ferramentas de desenvolvimento, teste e empacotamento:
- Vite e Vitest — licenças MIT.
- TypeScript e Playwright — licenças Apache-2.0.
- Archiver — licença MIT.

A interface usa fontes disponibilizadas pelo sistema operacional, como Segoe UI e equivalentes,
sem incorporar uma fonte comercial externa ao pacote. Google Chrome, Chrome Web Store, GitHub,
Supabase e Stripe são serviços ou marcas de seus respectivos titulares e seguem termos próprios.
Os créditos não representam patrocínio, parceria ou endosso.

As versões exatas e dependências transitivas constam nos arquivos package-lock.json e package.json
incluídos neste snapshot. Os textos integrais de licença distribuídos pelos pacotes devem ser
preservados conforme as obrigações aplicáveis.
"@
        Set-Content -LiteralPath (Join-Path $registrationDocs "CREDITOS-E-TERCEIROS.txt") -Value $thirdParty -Encoding UTF8

        $technicalSheet = @"
FICHA TÉCNICA — QA TOOLBAR SANDBOX

Software: QA Toolbar Sandbox
Autor indicado: Matheus Alves Bonotto Santos
Versão: $version
Manifest: $($manifestAtHead.manifest_version)
Branch de origem: $branch
Commit: $commit
Data do commit: $commitDate
Repositório: $remote
Gerado em: $((Get-Date).ToString("o"))

NATUREZA
Extensão Chrome Manifest V3, landing page, painel administrativo e backend de suporte.
Tecnologias principais: JavaScript, TypeScript, HTML, CSS, React e Supabase.

DESCRIÇÃO FUNCIONAL ATUALIZADA
Plataforma local-first de produtividade para QA com workspaces, contextos de cliente/projeto/
produto/ambiente, contas e recursos de teste, anotações visuais, inspeção, evidências MP4 e GIF,
Macro Studio, Gravador de Passos numerado/Gherkin com CSV, planos, permissões e administração.

INTEGRIDADE
O código deste pacote corresponde exatamente aos arquivos rastreados no commit informado,
acrescidos apenas desta documentação técnica gerada localmente. O SHA-256 do ZIP final consta
nos relatórios externos que acompanham o arquivo.

OBSERVAÇÃO
Este material é preparatório e técnico. Não substitui a Declaração de Veracidade, o protocolo
oficial do INPI, análise de titularidade contratual ou orientação jurídica profissional.
"@
        Set-Content -LiteralPath (Join-Path $registrationDocs "FICHA-TECNICA-ATUALIZADA.txt") -Value $technicalSheet -Encoding UTF8

        $metadata = [ordered]@{
            software = "QA Toolbar Sandbox"
            authorIndicated = "Matheus Alves Bonotto Santos"
            version = $version
            manifestVersion = $manifestAtHead.manifest_version
            generatedAt = (Get-Date).ToString("o")
            source = [ordered]@{ branch = $branch; commit = $commit; commitDate = $commitDate; remote = $remote }
            snapshotPolicy = "git archive HEAD; arquivos rastreados e confirmados no commit"
            thirdPartyNotice = "REGISTRO-INPI/CREDITOS-E-TERCEIROS.txt"
        }
        $metadata | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $registrationDocs "METADADOS-ATUALIZADOS.json") -Encoding UTF8

        $checklist = @"
CHECKLIST ANTES DE USAR NO PEDIDO

[ ] Confirmei que este ZIP corresponde ao commit que desejo registrar.
[ ] Conferi a versão, autoria indicada e titular pretendido.
[ ] Revisei contratos de trabalho, prestação de serviços e cláusulas de propriedade intelectual.
[ ] Conferi que o ZIP não contém segredos, .env, certificados ou dados pessoais/corporativos.
[ ] Preservei o ZIP sem qualquer alteração após a geração do SHA-256.
[ ] Guardei ZIP, SHA-256 e relatórios em pelo menos dois locais pessoais.
[ ] Informarei no e-Software exatamente o SHA-256 deste ZIP, se este for o arquivo escolhido.
[ ] Guardarei recibo, protocolo, Declaração de Veracidade e comprovantes oficiais.

IMPORTANTE: um novo merge em main gera um novo ZIP e um novo hash. Não substitua silenciosamente
o arquivo já usado em um pedido; preserve cada versão com seus respectivos relatórios.
"@
        Set-Content -LiteralPath (Join-Path $registrationDocs "CHECKLIST-DE-CONFERENCIA.txt") -Value $checklist -Encoding UTF8

        $zipName = "QA-Toolbar-Sandbox_v${version}_commit-${shortCommit}_INPI_${stamp}.zip"
        $zipPath = Join-Path $OutputPath $zipName
        Compress-Archive -Path (Join-Path $snapshot "*") -DestinationPath $zipPath -CompressionLevel Optimal
        $hash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
        $size = (Get-Item -LiteralPath $zipPath).Length

        $hashReport = @"
Software: QA Toolbar Sandbox
Versão: $version
Branch: $branch
Commit: $commit
Algoritmo: SHA-256
Hash: $hash
Arquivo: $zipName
Tamanho: $size bytes
Gerado em: $((Get-Date).ToString("o"))

Preserve o ZIP exatamente como gerado. Qualquer alteração produz outro hash.
"@
        Set-Content -LiteralPath "$zipPath.sha256.txt" -Value $hashReport -Encoding UTF8
        ([ordered]@{ software = "QA Toolbar Sandbox"; version = $version; branch = $branch; commit = $commit; algorithm = "SHA-256"; hash = $hash; file = $zipName; sizeBytes = $size; generatedAt = (Get-Date).ToString("o") }) |
            ConvertTo-Json -Depth 5 | Set-Content -LiteralPath "$zipPath.report.json" -Encoding UTF8

        Write-Host "[INPI] Pacote criado: $zipPath" -ForegroundColor Green
        Write-Host "[INPI] SHA-256: $hash" -ForegroundColor Green
    }
    finally {
        if (Test-Path -LiteralPath $temporaryRoot) { Remove-Item -LiteralPath $temporaryRoot -Recurse -Force }
    }
}
finally {
    Pop-Location
}
