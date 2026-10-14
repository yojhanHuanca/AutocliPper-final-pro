# AutoClipper

Nueva implementación independiente del backend. **Entrega actual: etapa 2, recorrido funcional de cuenta a inspección**. Incluye identidad/sesiones, workspaces, roles, proyectos, carga PUT/multipart y validación multimedia real. La generación de clips con IA sigue pendiente.

Identidad incluye 2FA TOTP, recuperación, perfil y solicitudes de privacidad. El adaptador Google valida credenciales en servidor; su prueba externa con una cuenta real sigue pendiente. Ver [límites de Google](autoclipper-project-documentation/google-identity.md) y [seguridad de identidad](autoclipper-project-documentation/identity-security.md).

La etapa 1 está publicada en `cf6912b`, con CI remoto aprobado. La entrega de etapa 2 y sus verificaciones se describen en [stage-2.md](autoclipper-project-documentation/stage-2.md). Swagger público en [gateway](http://localhost:3000/docs); correo de desarrollo en [Mailpit](http://localhost:19025).

- [Guía local](autoclipper-project-documentation/local-development.md)
- [Arquitectura y decisiones](autoclipper-project-documentation/architecture.md)
- [Estado por requisito](autoclipper-project-documentation/status.md)
- [Evidencia de verificaciones](autoclipper-project-documentation/verification.md)
- [Plan de entregas](autoclipper-project-documentation/scope.md)

El frontend Angular permanece separado y no se implementa aquí. No se reutilizaron archivos, secretos ni historia del proyecto Java anterior. Por autorización posterior del propietario se reutilizó únicamente su client ID público de Google, en configuración local ignorada. El repositorio remoto es privado; los commits se publican con autorización del usuario, sin desplegar producción.
