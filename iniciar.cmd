@echo off
setlocal EnableDelayedExpansion
title AutoClipper
cd /d "%~dp0"
echo.
echo  ===============================================
echo   AutoClipper  -  videos de hasta 30 GB y 10 h
echo  ===============================================
echo.
set REBUILD=0
if /i "%~1"=="rebuild" set REBUILD=1

rem --- 1. Docker ---------------------------------------------------------
set tries=0
docker info >nul 2>nul
if not errorlevel 1 goto dockerok
echo  Docker no esta encendido. Abriendo Docker Desktop...
if exist "C:\Program Files\Docker\Docker\Docker Desktop.exe" start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
:waitdocker
timeout /t 5 /nobreak >nul
docker info >nul 2>nul
if not errorlevel 1 goto dockerok
set /a tries+=1
if !tries! GEQ 48 (
  echo  [X] Docker no respondio en 4 minutos. Abre Docker Desktop y vuelve a ejecutar este archivo.
  pause
  exit /b 1
)
goto waitdocker
:dockerok
echo  [1/4] Docker listo.

rem --- 2. Claves locales (no se suben a Git) ------------------------------
set NODEIMG=node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
set BOOT=docker run --rm --mount "type=bind,source=%CD%,target=/workspace" --workdir /workspace/autoclipper-infrastructure %NODEIMG%
%BOOT% node setup-local.mjs >nul 2>setup.err || (type setup.err & echo  [X] Fallo la configuracion inicial. & pause & exit /b 1)
%BOOT% node setup-stage2.mjs >nul 2>setup.err || (type setup.err & echo  [X] Fallo la configuracion de servicios. & pause & exit /b 1)
del setup.err >nul 2>nul
echo  [2/4] Configuracion lista.

rem --- 3. IA: Groq (nube, rapida) o local --------------------------------
set ENVF=autoclipper-infrastructure\.env
findstr /b /c:"GROQ_API_KEY=gsk_" "%ENVF%" >nul 2>nul
if not errorlevel 1 goto groq
echo.
echo  La IA mas rapida es Groq (gratis): https://console.groq.com/keys
echo  Pega tu API key (empieza con gsk_) o deja vacio y presiona Enter para usar la IA local.
set "GROQ_KEY="
set /p GROQ_KEY= API key de Groq: 
if "!GROQ_KEY:~0,4!"=="gsk_" (
  %BOOT% node -e "const fs=require('fs');let e=fs.readFileSync('.env','utf8').replace(/^(GROQ_API_KEY|AI_ANALYSIS_PROVIDER)=.*\r?\n?/gm,'');if(!e.endsWith('\n'))e+='\n';fs.writeFileSync('.env',e+'GROQ_API_KEY='+process.argv[1]+'\nAI_ANALYSIS_PROVIDER=groq\n')" "!GROQ_KEY!"
  echo  Key guardada en autoclipper-infrastructure\.env (no se sube a Git^).
  goto groq
)
set FILES=-f compose.yaml -f compose.business.yaml -f compose.web.yaml -f compose.analysis-local.yaml -f compose.ai-free.yaml
echo  [3/4] IA local: Whisper + modelo pequeno (mas lenta, usa tu CPU).
%BOOT% node setup-analysis-model.mjs >nul || (echo  [X] No se pudo descargar el modelo de Whisper. & pause & exit /b 1)
goto build
:groq
set FILES=-f compose.yaml -f compose.business.yaml -f compose.web.yaml
echo  [3/4] IA en la nube: Groq (Whisper large-v3 + Llama 3.3 70B).

rem --- 4. Construir (solo si hace falta) y levantar ----------------------
:build
cd autoclipper-infrastructure
if "%REBUILD%"=="0" (
  docker image inspect autoclipper-backend:0.2.0 >nul 2>nul || set REBUILD=1
  docker image inspect autoclipper-web:0.1.0 >nul 2>nul || set REBUILD=1
)
if "%REBUILD%"=="1" (
  echo  [4/4] Construyendo imagenes. La primera vez tarda unos minutos; luego es rapido...
  echo        El detalle queda en autoclipper-infrastructure\run.log
  docker compose %FILES% --profile app build --build-arg USE_SNAPSHOT=false > run.log 2>&1 || (echo  [X] Fallo la construccion. Revisa autoclipper-infrastructure\run.log & pause & exit /b 1)
) else (
  echo  [4/4] Levantando con las imagenes ya construidas. Si cambiaste codigo usa reconstruir.cmd
  echo. > run.log
)
docker compose %FILES% --profile app up -d --remove-orphans >> run.log 2>&1 || (echo  [X] Fallo al levantar. Revisa autoclipper-infrastructure\run.log & pause & exit /b 1)
if not "%FILES:ai-free=%"=="%FILES%" (
  echo        Preparando el modelo local de seleccion de clips...
  docker compose %FILES% --profile app exec -T local-ai ollama pull qwen3:0.6b >> run.log 2>&1
)
echo        Esperando a que todo arranque...
set waits=0
:waitready
timeout /t 5 /nobreak >nul
curl -fs http://localhost:3005/v1/health/ready >nul 2>nul && curl -fs http://localhost:4200/health/ready >nul 2>nul && goto ready
set /a waits+=1
if !waits! GEQ 60 (
  echo  [X] No termino de arrancar en 5 minutos. Revisa Docker Desktop o autoclipper-infrastructure\run.log
  pause
  exit /b 1
)
goto waitready
:ready
docker compose %FILES% --profile app ps >> run.log 2>&1
echo.
echo  LISTO.  App: http://localhost:4200    Correo de pruebas: http://localhost:19025
start "" http://localhost:4200
echo  Para apagar: apagar.cmd
pause
