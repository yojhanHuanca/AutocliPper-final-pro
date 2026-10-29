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

Generate ignored local credentials once. This command mounts the checkout into a temporary Node container; it does not print credentials:

```powershell
$repoRoot = (Get-Location).Path
docker run --rm --mount "type=bind,source=$repoRoot,target=/workspace" `
  --workdir /workspace/autoclipper-infrastructure `
  node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 `
  node setup-local.mjs
```

On an existing checkout, do **not** run setup again if its `.env` files already exist. The setup scripts intentionally refuse to overwrite credentials. Never delete `.env` files or Docker volumes to troubleshoot without first checking whether they contain data you need.

Build and start the application from the infrastructure directory:

```powershell
Set-Location .\autoclipper-infrastructure
$compose = @('-f', 'compose.yaml', '-f', 'compose.business.yaml', '-f', 'compose.web.yaml', '--profile', 'app')
docker compose @compose up -d --build
docker compose @compose ps
```

Wait until the `web`, `gateway`, `media`, `identity`, `workspace`, `project`, `analysis`, `billing`, `renderer`, `postgres`, `redis`, and `storage` services report healthy or completed successfully. Migration and storage initialization jobs run as one-shot containers during startup.

Open:

- Web app: [http://localhost:4200](http://localhost:4200)
- API health: [http://localhost:3005/v1/health/ready](http://localhost:3005/v1/health/ready)
- API docs: [http://localhost:3005/docs](http://localhost:3005/docs)
- Development email inbox (Mailpit): [http://localhost:19025](http://localhost:19025)

## Local secrets and paid AI

Generated credentials live in ignored `.env` files. Keep them on this machine; do not commit them or paste them into chat, tickets, or screenshots. Do not share the output of `docker compose config`, since it expands environment values.

Paid AI is disabled by default (`PAID_AI_ENABLED=false`, `AI_MAX_ESTIMATED_USD_PER_JOB=0`), and the bootstrap does not configure an OpenAI key. Automatic AI selection will therefore remain unavailable until separately configured and authorized; ordinary startup makes no paid provider calls. Do not enable Ollama or paid calls as part of onboarding.

## Current source limits

- Local video upload is private and limited to 100 MiB.
- YouTube links can be previewed, but are not imported as source video.
- Kick preview is limited to live channels; VODs and clips are not imported.
- Twitch import has not been verified with a real OAuth account; fixture tests are not proof of live support.
- The Editor can use the private source-playback endpoint, but seeking in an existing storage bucket still requires its Range CORS configuration. Do not claim a real-storage end-to-end test until that is applied and tested.

## Stop and resume

From `autoclipper-infrastructure`, use the same Compose files to stop containers while preserving data:

```powershell
docker compose @compose down
```

Do not add `-v`; that would delete the database, Redis, and object-storage volumes. To resume later, repeat `docker compose @compose up -d` (add `--build` only when you intentionally need to rebuild changed images). Rebuilding an in-use stack can recreate services, so coordinate that window with the team.

For service logs, inspect only the needed service and avoid sharing unreviewed output:

```powershell
docker compose @compose logs --tail 100 web gateway media
```

## Contributor references

- [Docker and local development notes](autoclipper-project-documentation/local-development.md)
- [Architecture](autoclipper-project-documentation/architecture.md)
- [Current status and known limitations](autoclipper-project-documentation/status.md)
- [Verification evidence](autoclipper-project-documentation/verification.md)
- [Launch backlog](autoclipper-project-documentation/launch-backlog.md)
- [Frontend development notes](autoclipper-web-angular/README.md)
