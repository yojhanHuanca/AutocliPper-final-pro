# Twitch OAuth en entorno local

Estado observado al 1 de noviembre de 2026: Identity devuelve `configured: true`, pero el endpoint autenticado de vínculo requiere una sesión y sin ella responde 401. Esto confirma que hay configuración de la app en el contenedor; no confirma que exista una cuenta enlazada ni que se hayan concedido los scopes. El bloque de registro de abajo sirve para verificar la app o preparar otro entorno.

## Registrar la aplicación

1. Entra en [Twitch Developer Console](https://dev.twitch.tv/console/apps) con la cuenta dueña y activa/verifica su correo y la autenticación de dos factores.
2. Registra una aplicación. En **OAuth Redirect URLs** escribe exactamente `http://localhost:3005/v1/auth/twitch/callback` (el Gateway local de este entorno se publica en `localhost:3005`). Selecciona la categoría adecuada y guarda.
3. Copia el **Client ID** y genera un **Client Secret**. Authorization Code requiere ambos. Guarda el secreto únicamente en el archivo local privado; no lo pegues en el chat, terminal compartida, documentación, Git ni logs.
4. En el consentimiento se solicitan `editor:manage:clips` y `channel:manage:clips`, las dos alternativas de autorización aceptadas por Get Clips Download para cubrir cuentas vinculadas con rol de editor o broadcaster. No se configuran como variables ni forman parte de la lista de redirect URLs. La cuenta vinculada debe tener permiso sobre el canal del clip.

Referencia: [registro de aplicaciones](https://dev.twitch.tv/docs/authentication/register-app/) y [Authorization Code OAuth](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/).

## Configuración privada

Para el backend ejecutado desde el host, edita `autoclipper-backend-microservices/.env.identity`, generado por `autoclipper-infrastructure/setup-stage2.mjs`. Añade o completa estas líneas sin reemplazar las demás:

```dotenv
TWITCH_CLIENT_ID=<Client ID>
TWITCH_CLIENT_SECRET=<Client Secret>
TWITCH_REDIRECT_URI=http://localhost:3005/v1/auth/twitch/callback
```

El archivo `.env.identity` está excluido por Git. Conserva permisos privados y no imprimas su contenido. Para Docker, coloca los valores en `autoclipper-infrastructure/.env`; `compose.business.yaml` los pasa explícitamente al contenedor `identity`. No guardes el secreto en `.env.example` ni en Git.

Después de aplicar las migraciones, desplegar el código actual de Identity y configurar sus variables, recrea Identity para cargar la configuración; `GET http://localhost:3005/v1/auth/providers` debe mostrar `twitch.configured: true`. El estado de enlace `GET /v1/auth/twitch/link` seguirá `linked: false` hasta autorizar la cuenta desde el flujo de importación de Twitch. El callback devuelve a `http://localhost:4200/app/settings?provider=twitch&status=linked`. El redirect registrado y `TWITCH_REDIRECT_URI` deben coincidir carácter por carácter. En otro entorno, registra el callback HTTPS público exacto `/v1/auth/twitch/callback`.

## Migraciones 0013 y 0012

`0013_twitch_oauth_links.sql` pertenece a Identity (`twitch_links`); `0012_twitch_source_imports.sql` pertenece a Project (`source_imports`). El runner Drizzle toma un bloqueo advisory y aplica todas las migraciones pendientes de cada servicio, no solo la de Twitch. Antes, revisa el historial de migraciones y confirma qué otras migraciones pendientes se incluirán. Realiza y verifica respaldos de las bases `autoclipper_identity` y `autoclipper_project` antes de tocar una base con datos.

En ejecución local desde la carpeta `autoclipper-backend-microservices`, tras confirmar que `.env.identity` y `.env.project` apuntan al entorno correcto y usan las credenciales owner generadas por `setup-stage2.mjs`, aplica cada servicio por separado:

```powershell
node --env-file=.env.identity scripts/migrate-service.mjs identity
node --env-file=.env.project scripts/migrate-service.mjs project
```

Comprueba el código de salida de cada comando antes de continuar. No uses las URLs runtime. No ejecutes estos comandos mientras falten respaldos verificados o haya una migración pendiente inesperada. En Compose existen los one-shot `migrate-identity` y `migrate-project`, pero el despliegue Docker requiere primero resolver el paso de configuración de Twitch descrito arriba.

Estas migraciones no tienen migraciones `down`. Para revertir con seguridad, restaura el respaldo completo de cada base afectada si aún no recibió escrituras posteriores y valida la restauración antes de volver a habilitar servicios. En una base local desechable también puede recrearse la base desde cero. Si ya hubo escrituras que se deben conservar, no borres tablas ni filas del historial Drizzle manualmente: prepara y revisa una migración correctiva hacia delante. No uses `down -v` en un entorno con datos que deban conservarse.

## Estado del control de seguridad

El inicio de vinculación exige la sesión autenticada y CSRF. Genera `state` aleatorio, lo guarda con expiración de cinco minutos en Redis y en cookie `HttpOnly; SameSite=Lax`; el callback compara ambos valores, consume el estado una sola vez y comprueba que continúa la misma sesión de la aplicación. El intercambio y validación se hacen en Identity; ambos tokens quedan cifrados en la columna `token_cipher` con AES-GCM y clave asociada al usuario. Los scopes solicitados son `editor:manage:clips` y `channel:manage:clips`, las dos alternativas que acepta Get Clips Download según el rol de la cuenta.

Las renovaciones ante 401 ahora se serializan por usuario con un advisory lock de PostgreSQL compartido entre réplicas. La nueva pareja de tokens rotada se cifra y persiste antes de validar el access token nuevo, y las solicitudes que esperaban recargan la pareja vigente en lugar de reutilizar un refresh token anterior. La escritura reintenta tres veces con el mismo ciphertext para cubrir errores transitorios. El bloqueo espera hasta 10 segundos; si no se libera, se devuelve un error temporal sin borrar la vinculación. Si falla la adquisición del lock o no puede confirmarse su liberación, Identity descarta esa conexión PostgreSQL para que el servidor libere su lock de sesión. La rutina periódica de validación reutiliza la misma ruta de renovación.

Límite de recuperación: Twitch y PostgreSQL no comparten una transacción. Si Twitch rota el refresh token y PostgreSQL permanece indisponible durante todos los reintentos, cada intento habrá escrito el mismo valor cifrado de forma atómica, pero no se puede asegurar si el último commit llegó al servidor cuando se perdió la conexión. El valor almacenado no queda parcialmente escrito; aun así, la cuenta puede requerir nueva vinculación si Twitch invalidó el refresh anterior y la nueva pareja no llegó a persistirse.

El flujo documentado de Authorization Code de Twitch usa un cliente confidencial con `client_secret` y `state`; la documentación oficial consultada no describe parámetros PKCE para este flujo. No se agrega PKCE inventado. La prueba `tests/twitch-api.test.mjs` usa tokens cifrados sintéticos y mocks; no verifica una autorización OAuth real ni sustituye el registro/configuración de la app Twitch.
