@echo off
title AutoClipper - Frontend
cd /d "%~dp0"
echo.
echo  === AutoClipper frontend ===
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo  [X] No se encontro Node.js. Instala Node 24 LTS desde https://nodejs.org y vuelve a abrir este archivo.
  pause
  exit /b 1
)
for /f "delims=" %%v in ('node -v') do set NODEV=%%v
echo  Node detectado: %NODEV%
if not exist node_modules\@angular\cli (
  echo  Instalando dependencias, la primera vez tarda unos minutos...
  call npm ci --no-audit --no-fund
  if errorlevel 1 (
    echo  [X] Fallo npm ci. Revisa tu conexion a internet.
    pause
    exit /b 1
  )
)
echo.
echo  Iniciando en http://localhost:4200  (cierra esta ventana para detenerlo)
echo  El detalle queda en frontend.log
echo.
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a===24&&b>=15||a===22&&b>=22||a>=26?0:1)"
if errorlevel 1 (
  echo  Tu Node %NODEV% no sirve para Angular 22: se usara Node 24.21.0 temporal, sin cambiar tu instalacion.
  call npx --yes node@24.21.0 node_modules/@angular/cli/bin/ng.js serve --host localhost --port 4200 --open > frontend.log 2>&1
) else (
  call npx ng serve --host localhost --port 4200 --open > frontend.log 2>&1
)
echo.
echo  El servidor se detuvo. Revisa frontend.log si hubo un error.
pause
