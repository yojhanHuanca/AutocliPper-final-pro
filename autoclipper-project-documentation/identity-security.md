# Identidad: 2FA, perfil y solicitudes de privacidad

Ampliación de etapa 2. No requiere construir la interfaz Angular. Contratos generados desde los controladores reales en `contracts/identity.openapi.json` y `contracts/gateway.openapi.json`.

## Autenticación de dos factores

`GET /v1/auth/2fa` informa si está activada y cuántos códigos de recuperación quedan. El alta requiere una sesión, CSRF y contraseña: `POST /auth/2fa/setup` devuelve un URI `otpauth://` con un secreto aleatorio de 160 bits, válido para confirmar durante diez minutos. Angular puede representar ese URI como QR; debe evitar registrarlo en telemetría o persistirlo en almacenamiento del navegador.

`POST /auth/2fa/enable` exige contraseña y un TOTP SHA-1 de seis dígitos y período de 30 segundos. Se admite una ventana de un período a cada lado. El paso aceptado queda persistido: no se permite volver a utilizarlo, tampoco entre instancias concurrentes. El secreto se cifra con AES-256-GCM y contexto autenticado ligado al ID de usuario, para rechazar intercambios de ciphertext entre cuentas. La biblioteca OTPAuth está fijada en 9.5.2.

La activación devuelve diez códigos aleatorios de recuperación de 96 bits, una sola vez. Solo se conservan hashes SHA-256 y se consume cada código en una transacción. Activar o desactivar 2FA revoca todas las sesiones existentes; Angular debe solicitar nuevamente el inicio de sesión. El código usado para activar ya está consumido: esperar el siguiente período o usar un código de recuperación.

El login con 2FA exige `factor`, que admite TOTP o un código de recuperación. `POST /auth/2fa/recovery/rotate` requiere contraseña y factor, invalida todos los códigos anteriores y devuelve diez nuevos. `POST /auth/2fa/disable` requiere contraseña y factor cuando está activo. Las operaciones sensibles están limitadas por IP/usuario. Recuperar la contraseña no elimina el segundo factor.

## Perfil y preferencias

`GET /v1/auth/profile` devuelve el perfil propio, preferencias y versión. `PATCH` exige esa versión; una actualización concurrente devuelve 409. Se admiten nombre, idioma `es/en`, zona IANA canónica o UTC, tema y preferencia de notificaciones por correo. No se permite cambiar correo, roles o permisos mediante este DTO. La preferencia queda persistida; todavía no existe un servicio completo de notificaciones que la aplique a todos los eventos.

## Privacidad y auditoría

`POST /v1/auth/privacy-requests` requiere contraseña y factor si está activo. Registra solicitudes `export` o `deletion` y devuelve 202 con `state=requested` y `fulfillment=pending`. Una solicitud pendiente del mismo tipo se reutiliza. `GET` solo muestra las solicitudes propias.

**Registrar una solicitud no ejecuta una exportación ni elimina los datos.** Faltan el proceso entre servicios, los archivos de exportación, la transferencia de propiedad cuando corresponda, la revocación integral y la purga de objetos. No se anuncia cumplimiento normativo ni eliminación concluida.

El incremento posterior [inventaría las seis bases y ofrece un aporte del perfil propio](privacy-lifecycle.md) mediante `POST /v1/auth/privacy-requests/{id}/identity-export`, con nueva comprobación sensible e idempotencia. Es `identity-profile-v1`, `fulfillment=partial` y `globalFulfillment=pending`: no completa la solicitud global ni exporta contenido de otros servicios. Solo persisten recibos/hash/auditoría, sin otra copia del JSON personal y sin inventar un plazo de retención.

`GET /v1/auth/security-events` muestra hasta cien eventos propios. Se registran login, reutilización de refresh, cambio de contraseña, alta/confirmación/desactivación de 2FA, rotación de recuperación y primeras solicitudes de privacidad. Los eventos contienen acción, fecha e identificador de correlación; no incluyen contraseñas, tokens, factores ni secretos. No constituyen todavía una auditoría exhaustiva de toda la plataforma.

## Evidencia y límites

La suite unitaria valida el vector SHA-1 de RFC 6238 y el rechazo por ventana/formato, además de autenticación de ciphertext con contexto. La aceptación Docker usa cuentas verificadas mediante SMTP local, PostgreSQL real y OTPAuth para generar códigos: comprueba concurrencia del perfil, aislamiento de privacidad/auditoría, rechazo de factores reutilizados, rotación y revocación servidor de sesiones al activar/desactivar. Consultar la evidencia final en `stage-2.md`.

Google se entrega por separado. Se localizó y reutilizó exclusivamente el client ID público del proyecto anterior en `.env.identity`, archivo ignorado. No se copiaron secretos OAuth ni se modificó el proyecto anterior. Los orígenes autorizados en Google Cloud y el inicio de sesión con una credencial real siguen sin comprobarse.

Fuentes: [OTPAuth](https://github.com/hectorm/otpauth), [RFC 6238](https://www.rfc-editor.org/rfc/rfc6238), [validación oficial de credenciales Google](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token).
