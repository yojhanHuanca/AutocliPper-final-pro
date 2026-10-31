# AutoClipper

AutoClipper runs locally with **Docker Compose**: the Angular web app, API, worker, databases, Redis, and private object storage all run in containers. The browser uses the existing `http://localhost:4200`; the API gateway uses `http://localhost:3005`. Do not start a second frontend server.

## Requirements

- Windows 10/11 with Docker Desktop using the **Linux** engine (WSL 2 backend).
- Docker Compose v2 (`docker compose`, not the legacy `docker-compose`).
- Git and PowerShell.
- Ports `4200`, `3001`–`3005`, `3007`, `11025`, `15432`, `16379`, `19000`, and `19025` available on loopback.

The first run downloads pinned Docker images and builds the API and web images. No host Node.js, npm, or FFmpeg installation is needed. A short-lived official Node container creates local secrets; it does not run the application.

## First run

In PowerShell, clone the private repository and enter its root:

```powershell
git clone https://github.com/yojhanHuanca/AutocliPper-final-pro.git
Set-Location .\AutocliPper-final-pro
docker info
docker compose version
```

The bootstrap has two explicit, repeatable stages. Stage 1 creates the infrastructure and media environment. Stage 2 adds credentials and environment files for Identity, Workspace, Project, Analysis, and Billing, which the current Compose files require. Both scripts preserve existing entries, add only missing ones, and print no credential values. Run them from the repository root in the pinned Node container; no host Node installation is required:

```powershell
$repoRoot = (Get-Location).Path
$nodeBootstrap = @(
  'run', '--rm',
  '--mount', "type=bind,source=$repoRoot,target=/workspace",
  '--workdir', '/workspace/autoclipper-infrastructure',
  'node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20'
)
docker @nodeBootstrap node setup-local.mjs
if ($LASTEXITCODE -ne 0) { throw 'Stage 1 setup failed.' }
docker @nodeBootstrap node setup-stage2.mjs
if ($LASTEXITCODE -ne 0) { throw 'Stage 2 setup failed.' }
docker @nodeBootstrap node --test setup-scripts.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'Setup contract checks failed.' }
```

The setup scripts are safe to rerun when their environment files are intact: they preserve existing credentials and fill missing entries. If the infrastructure `.env` is missing while service `.env` files remain, Stage 1 stops instead of generating replacement credentials that might disagree with an existing database volume. Restore the original environment file from its protected backup. Never delete `.env` files or Docker volumes to troubleshoot.

Build and start the app profile from the infrastructure directory. This default command does not include the optional local-AI Compose override:

```powershell
Push-Location (Join-Path $repoRoot 'autoclipper-infrastructure')
try {
  $compose = @('-f', 'compose.yaml', '-f', 'compose.business.yaml', '-f', 'compose.web.yaml', '--profile', 'app')
  docker compose @compose up -d --build
  if ($LASTEXITCODE -ne 0) { throw 'Compose startup failed.' }
  docker compose @compose ps
  function Wait-ForHttpReady([string]$Uri, [int]$TimeoutSeconds = 300) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
      try {
        $response = Invoke-WebRequest -Uri $Uri -TimeoutSec 5
        if ($response.StatusCode -eq 200) { return }
      } catch { }
      Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)
    throw "Readiness check timed out for $Uri."
  }
  Wait-ForHttpReady 'http://localhost:4200/health/ready'
  Wait-ForHttpReady 'http://localhost:3005/v1/health/ready'
  Write-Output 'Web and API health checks passed (HTTP 200).'
} finally {
  Pop-Location
}
```

Wait until the `web`, `gateway`, `media`, `identity`, `workspace`, `project`, `analysis`, `billing`, `renderer`, `postgres`, `redis`, and `storage` services report healthy or completed successfully. Migration and storage initialization jobs run as one-shot containers during startup.

Open:

- Web app: [http://localhost:4200](http://localhost:4200)
- API health: [http://localhost:3005/v1/health/ready](http://localhost:3005/v1/health/ready)
- API docs: [http://localhost:3005/docs](http://localhost:3005/docs)
- Development email inbox (Mailpit): [http://localhost:19025](http://localhost:19025)

The `web` service health check is `/health/ready` on port `4200`; the Gateway is published on host port `3005` and checked at `/v1/health/ready`. `docker compose ps` should show the application services as healthy and one-shot migrations/storage initialization as completed.

## Local secrets and paid AI

Generated credentials live in ignored `.env` files. Keep them on this machine; do not commit them or paste their contents into chat, tickets, or screenshots. Do not share `docker compose config` output, container environment inspection, or logs that could include expanded environment values.

Paid AI remains disabled by default (`PAID_AI_ENABLED=false`, `AI_MAX_ESTIMATED_USD_PER_JOB=0`); the bootstrap leaves `OPENAI_API_KEY` empty and does not configure Ollama. Ordinary startup makes no paid provider calls. Do not set provider keys, enable payment, add `compose.analysis-local.yaml`, run the model download script, or enable Ollama as part of onboarding.

## Current source limits

- Local video upload is private and limited to 100 MiB.
- YouTube links can be previewed, but are not imported as source video.
- Kick preview is limited to live channels; VODs and clips are not imported.
- Twitch import has not been verified with a real OAuth account; fixture tests are not proof of live support.
- The Editor can use the private source-playback endpoint, but seeking in an existing storage bucket still requires its Range CORS configuration. Do not claim a real-storage end-to-end test until that is applied and tested.

## Stop and resume

From `autoclipper-infrastructure`, use the same Compose files to stop containers while preserving data:

```powershell
docker compose -f compose.yaml -f compose.business.yaml -f compose.web.yaml --profile app down
```

Do not add `-v`; that would delete the database, Redis, and object-storage volumes. To resume later, repeat the same Compose command with `up -d` (add `--build` only when you intentionally need to rebuild changed images). Rebuilding an in-use stack can recreate services, so coordinate that window with the team.

For service logs, inspect only the needed service and avoid sharing unreviewed output:

```powershell
docker compose -f compose.yaml -f compose.business.yaml -f compose.web.yaml --profile app logs --tail 100 web gateway media
```

## Contributor references

- [Docker and local development notes](autoclipper-project-documentation/local-development.md)
- [Architecture](autoclipper-project-documentation/architecture.md)
- [Current status and known limitations](autoclipper-project-documentation/status.md)
- [Verification evidence](autoclipper-project-documentation/verification.md)
- [Launch backlog](autoclipper-project-documentation/launch-backlog.md)
- [Frontend development notes](autoclipper-web-angular/README.md)
