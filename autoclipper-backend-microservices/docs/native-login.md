# Inicio de sesión local sin Docker (Windows)

Esta ruta levanta únicamente Identity y Gateway para comprobar el inicio de sesión por correo y contraseña. Usa un clúster PostgreSQL 18 aislado y un Redis mínimo en memoria, ambos locales; no ofrece workspaces, proyectos, medios, recuperación ni garantías de producción. No modifica los servicios del sistema ni el stack Compose.

Requisitos: Node 24 compatible con el repositorio, `npm ci` y `npm run build` ya ejecutados, y binarios de PostgreSQL 18 en `C:\Program Files\PostgreSQL\18\bin` (o `AUTOCLIPPER_PG_BIN` apuntando al directorio `bin`). Desde `autoclipper-backend-microservices`, en PowerShell:

```powershell
$env:AUTOCLIPPER_NATIVE_PG_PORT = '55432'
$env:AUTOCLIPPER_NATIVE_REDIS_PORT = '16380'
$env:AUTOCLIPPER_NATIVE_IDENTITY_PORT = '3302'
$env:AUTOCLIPPER_NATIVE_GATEWAY_PORT = '3300'
node scripts/native-login/start.mjs
node scripts/native-login/smoke.mjs
node scripts/native-login/stop.mjs
```

Los puertos son configurables para evitar colisiones: el lanzador falla si uno de sus puertos Identity, Gateway o Redis está ocupado. `start.mjs` inicializa la base propia, migra Identity, crea una cuenta local de prueba y exige HTTP 200 en readiness, liveness y login antes de anunciar que está listo. Las credenciales de prueba quedan solo en `.local/native-login/config.json`, ignorado por Git; no las copies a tickets o logs. `smoke.mjs` repite la prueba HTTP con esa cuenta. `stop.mjs` comprueba la línea de comandos de cada PID antes de detenerlo y para solo el clúster PostgreSQL de `.local/native-login/postgres`; conserva los datos para otro arranque.

El Redis de compatibilidad implementa solo el subconjunto necesario para esta prueba. Las rutas de Workspace/Project del Gateway apuntan a puertos locales sin servicio y no se deben usar como aceptación de esas funciones. Para probar Google OAuth o el flujo integral con cargas y video se necesita la configuración real del proveedor y el stack completo.
