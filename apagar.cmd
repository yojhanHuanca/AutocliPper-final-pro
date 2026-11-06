@echo off
cd /d "%~dp0autoclipper-infrastructure"
echo  Apagando AutoClipper (tus datos se conservan)...
docker compose -f compose.yaml -f compose.business.yaml -f compose.web.yaml -f compose.analysis-local.yaml -f compose.ai-free.yaml --profile app down
pause
