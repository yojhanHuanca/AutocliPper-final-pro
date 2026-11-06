param([switch]$Build)
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$infrastructure = Join-Path $projectRoot 'autoclipper-infrastructure'
if (-not (Test-Path -LiteralPath (Join-Path $infrastructure '.env'))) {
    throw 'Primero completa las dos etapas de configuración local descritas en README.md.'
}
docker info --format '{{.ServerVersion}}'
if ($LASTEXITCODE -ne 0) { throw 'Inicia Docker Desktop con el motor Linux y vuelve a ejecutar este script.' }
$nodeImage = 'node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20'
docker run --rm --mount "type=bind,source=$projectRoot,target=/workspace" --workdir /workspace/autoclipper-infrastructure $nodeImage node setup-analysis-model.mjs
if ($LASTEXITCODE -ne 0) { throw 'No se pudo verificar el modelo local de transcripción.' }
Push-Location $infrastructure
try {
    $composeArgs = @('-f','compose.yaml','-f','compose.business.yaml','-f','compose.web.yaml','-f','compose.analysis-local.yaml','-f','compose.ai-free.yaml','--profile','app')
    docker compose @composeArgs up -d --no-deps local-ai
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo iniciar la IA local.' }
    $localAiReady = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        docker compose @composeArgs exec -T local-ai ollama list *> $null
        if ($LASTEXITCODE -eq 0) { $localAiReady = $true; break }
        Start-Sleep -Seconds 2
    }
    if (-not $localAiReady) { throw 'La IA local no respondió durante el arranque.' }
    docker compose @composeArgs exec -T local-ai ollama show qwen3:0.6b *> $null
    if ($LASTEXITCODE -ne 0) {
        docker compose @composeArgs exec -T local-ai ollama pull qwen3:0.6b
        if ($LASTEXITCODE -ne 0) { throw 'No se pudo descargar el modelo local de selección.' }
    }
    $upArgs = @('up','-d')
    if ($Build) { $upArgs += '--build' }
    docker compose @composeArgs @upArgs
    if ($LASTEXITCODE -ne 0) { throw 'No se pudieron iniciar todos los servicios.' }
    docker compose @composeArgs ps
    Write-Output 'AutoClipper: http://localhost:4200 · API: http://localhost:3005/v1/health/ready'
    Write-Output 'Modo IA local: las llamadas de pago permanecen desactivadas.'
} finally {
    Pop-Location
}
