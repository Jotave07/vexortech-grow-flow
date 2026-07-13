param(
  [switch]$Execute
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$rootPrefix = $root.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
$quarantineDirectory = Join-Path $root "quarantine"
$staging = Join-Path $quarantineDirectory ".staging-legacy-and-residue-20260710"
$archive = Join-Path $quarantineDirectory "legacy-and-residue-20260710.zip"
$report = Join-Path $root "docs\project-removed-files.csv"

$candidates = @(
  ".codex-screenshots",
  ".wf-adm.json",
  ".wf-asaas-audit.json",
  ".wf-backend-audit.json",
  ".wf-output.json",
  "APPLY_NOW.md",
  "AUDIT_FIX_REPORT.md",
  "AUDIT_SUBSCRIPTIONS.md",
  "artifacts",
  "asaas_b.txt",
  "checkout_fix.py",
  "claude-cookbooks-main",
  "components.json",
  "deploy_vps.py",
  "evo_files.txt",
  "evo_full.txt",
  "evo_main.txt",
  "evo_search.txt",
  "evo_source.ts",
  "evo_status.txt",
  "migrations",
  "patch",
  "patches",
  "public\brand\design-ref.png",
  "public\brand\hype-delivery-brand.png",
  "scripts\__pycache__",
  "scripts\apply-and-deploy.ps1",
  "scripts\deploy-vps.py",
  "scripts\fix-service.py",
  "skills_checkout.md",
  "src\App.tsx",
  "src\assets",
  "src\components",
  "src\contexts",
  "src\functions\asaas.ts",
  "src\functions\evolution.ts",
  "src\hooks",
  "src\integrations\backend\client.ts",
  "src\integrations\backend\types.ts",
  "src\integrations\supabase",
  "src\lib\auth",
  "src\lib\brand.ts",
  "src\lib\delivery.ts",
  "src\lib\domains.ts",
  "src\lib\format.test.ts",
  "src\lib\format.ts",
  "src\lib\order-print.ts",
  "src\lib\payment-capabilities.test.ts",
  "src\lib\payment-capabilities.ts",
  "src\lib\profile-verification.test.ts",
  "src\lib\profile-verification.ts",
  "src\lib\queryKeys.ts",
  "src\lib\safe-redirect.test.ts",
  "src\lib\safe-redirect.ts",
  "src\lib\store-segments.ts",
  "src\lib\store-theme.ts",
  "src\lib\subscription.test.ts",
  "src\lib\subscription.ts",
  "src\lib\tone-constants.ts",
  "src\lib\upload-image.ts",
  "src\lib\utils.ts",
  "src\pages",
  "src\router.tsx",
  "src\routes",
  "src\routeTree.gen.ts",
  "src\server\asaas.functions.ts",
  "src\services\cep",
  "src\services\delivery",
  "src\services\kitchen",
  "src\services\subscription-billing.ts",
  "src\styles.css",
  "src\types\delivery.ts",
  "src\types\router-registration.d.ts",
  "src\utils",
  "vite.config.ts",
  "_deploy",
  "_deploy.tgz",
  "_port",
  ".build.log",
  ".codex-dev-server.err.log",
  ".codex-dev-server.log",
  ".codex-preview.err.log",
  ".codex-preview.log",
  ".codex-prod-server.err.log",
  ".codex-prod-server.log",
  ".codex-start.err.log",
  ".codex-start.out.log",
  ".codex-start-4174.err.log",
  ".codex-start-4174.out.log",
  ".codex-vite.err.log",
  ".codex-vite.out.log",
  ".codex-vite-5173.log",
  ".dbcheck.log",
  ".lint.log",
  ".migrate.log",
  ".npm-install.log",
  ".vps-check.log"
)

function Assert-InWorkspace([string]$PathValue) {
  $absolute = [IO.Path]::GetFullPath($PathValue)
  if (-not $absolute.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing path outside workspace: $absolute"
  }
  if ($absolute -eq $root) {
    throw "Refusing workspace root as a quarantine target."
  }
  return $absolute
}

function Classification([string]$RelativePath) {
  $slash = $RelativePath.Replace("\", "/")
  if ($slash -match "^(src/(App|assets|components|contexts|hooks|pages|routes)|src/router|src/routeTree|src/styles|components.json|vite.config.ts)") {
    return @("obsoleto", "Frontend React/TanStack/Tailwind substituido por HTML, CSS e JavaScript nativos com paridade validada.")
  }
  if ($slash -match "^(deploy_vps.py|scripts/(deploy-vps.py|fix-service.py|apply-and-deploy.ps1))$") {
    return @("critico_removido", "Script de deploy legado com credencial embutida ou fluxo inseguro; remover do codigo ativo e rotacionar a credencial.")
  }
  if ($slash -match "^public/brand/.*\.png$") {
    return @("obsoleto", "Raster de referencia/original substituido por WebP otimizado no runtime.")
  }
  if ($slash -match "^claude-cookbooks-main/") {
    return @("nao_utilizado", "Material terceiro sem import, rota ou participacao no build da aplicacao.")
  }
  if ($slash -match "^(patch/|patches/|_deploy/|_port/|migrations/|artifacts/|\.wf-|\.codex-screenshots/)") {
    return @("duplicado", "Copia, evidencia antiga ou residuo operacional sem dependencia no runtime nativo.")
  }
  return @("nao_utilizado", "Sem referencia no grafo ativo do cliente nativo, servidor, build ou testes mantidos.")
}

$sources = @()
foreach ($relative in $candidates) {
  $source = Assert-InWorkspace (Join-Path $root $relative)
  if (-not (Test-Path -LiteralPath $source)) { continue }
  if ((Get-Item -LiteralPath $source).PSIsContainer) {
    $sources += Get-ChildItem -LiteralPath $source -Recurse -File -Force
  } else {
    $sources += Get-Item -LiteralPath $source -Force
  }
}
$sources = $sources | Sort-Object FullName -Unique
$totalBytes = ($sources | Measure-Object Length -Sum).Sum

if (-not $Execute) {
  [pscustomobject]@{
    mode = "dry-run"
    targets = ($candidates | Where-Object { Test-Path -LiteralPath (Join-Path $root $_) }).Count
    files = $sources.Count
    bytes = $totalBytes
    archive = $archive
  } | ConvertTo-Json
  exit 0
}

if (Test-Path -LiteralPath $staging) { throw "Staging already exists: $staging" }
if (Test-Path -LiteralPath $archive) { throw "Archive already exists: $archive" }
New-Item -ItemType Directory -Path $staging -Force | Out-Null
New-Item -ItemType Directory -Path (Split-Path $report) -Force | Out-Null

$manifest = foreach ($file in $sources) {
  $relative = $file.FullName.Substring($rootPrefix.Length)
  $destination = Assert-InWorkspace (Join-Path $staging $relative)
  New-Item -ItemType Directory -Path (Split-Path $destination) -Force | Out-Null
  Copy-Item -LiteralPath $file.FullName -Destination $destination -Force
  $classification = Classification $relative
  [pscustomobject]@{
    caminho = $relative.Replace("\", "/")
    bytes = $file.Length
    classificacao = $classification[0]
    justificativa = $classification[1]
    sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $file.FullName).Hash.ToLowerInvariant()
  }
}

$manifest | Export-Csv -LiteralPath $report -NoTypeInformation -Encoding UTF8
Copy-Item -LiteralPath $report -Destination (Join-Path $staging "_quarantine-manifest.csv") -Force

Add-Type -AssemblyName System.IO.Compression.FileSystem
New-Item -ItemType Directory -Path $quarantineDirectory -Force | Out-Null
[IO.Compression.ZipFile]::CreateFromDirectory($staging, $archive, [IO.Compression.CompressionLevel]::Optimal, $false)
$zip = [IO.Compression.ZipFile]::OpenRead($archive)
try {
  if ($zip.Entries.Count -lt ($sources.Count + 1)) {
    throw "Archive verification failed: expected at least $($sources.Count + 1) entries, got $($zip.Entries.Count)."
  }
} finally {
  $zip.Dispose()
}

foreach ($relative in $candidates) {
  $target = Assert-InWorkspace (Join-Path $root $relative)
  if (Test-Path -LiteralPath $target) {
    Remove-Item -LiteralPath $target -Recurse -Force
  }
}
Remove-Item -LiteralPath $staging -Recurse -Force

[pscustomobject]@{
  mode = "executed"
  files = $sources.Count
  bytes = $totalBytes
  archive = $archive
  archiveBytes = (Get-Item -LiteralPath $archive).Length
  archiveSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLowerInvariant()
  report = $report
} | ConvertTo-Json
