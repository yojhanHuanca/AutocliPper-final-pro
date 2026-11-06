@echo off
cd /d "%~dp0autoclipper-infrastructure"
echo.
echo  Borrando SOLO los datos de prueba locales de Docker (base de datos, colas y videos)...
echo  El codigo y Git no se tocan.
docker compose -p autoclipper -f compose.yaml -f compose.business.yaml -f compose.web.yaml --profile app --profile test down -v --remove-orphans
echo.
echo  Listo. Arrancando la superversion desde cero...
cd /d "%~dp0"
call iniciar.cmd rebuild
