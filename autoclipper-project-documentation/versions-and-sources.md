# Versiones y fuentes oficiales

Consultadas durante la entrega del 13 de octubre de 2026 (America/Lima). Las versiones exactas de npm y sus integridades quedan en package-lock.json; las imágenes de dependencia y Node se fijan por digest. No se utiliza una etiqueta latest en la configuración del proyecto.

| Componente | Versión fijada |
|---|---|
| Node.js | 24.21.0 LTS |
| npm | 11.12.1 |
| NestJS common/core/platform-express | 12.1.3 |
| Nest Swagger | 12.0.2 |
| TypeScript | 5.9.3 |
| PostgreSQL | 18.6 bookworm |
| Redis | 8.2.10 bookworm |
| BullMQ | 6.3.14 |
| ioredis | 5.11.1 |
| RustFS | 1.0.1 |
| Drizzle ORM / Kit | 0.45.4 / 0.31.11 |
| esbuild de @esbuild-kit/core-utils | Override 0.25.12; corrige GHSA-67mh-4wv8-2f99; generación Drizzle verificada |
| AWS SDK S3 | 3.1151.0 |
| Zod | 4.6.7 |
| Pino | 10.4.0 |
| Prometheus client | @prometheus-io/client 0.16.1 |
| FFmpeg/FFprobe en Docker | Debian 7:5.1.9-0+deb12u1 |
| Fuente de subtítulos DejaVu | fonts-dejavu-core 2.37-6, snapshot Debian fijado |
| FFmpeg/FFprobe del host, usado en integración Windows | 8.1.1 |
| Aplicaciones backend de etapa 2 | 0.2.0 |
| Argon2 / Nodemailer | 0.45.1 / 10.1.0 |
| OTPAuth / Google auth library | 9.5.2 / 11.3.0 |
| AWS presigner | 3.1151.0 |
| Mailpit | v1.31.5, imagen por digest |
| Docker / Compose observados | 29.7.2 / 5.4.0 |

Node del host observado: 25.9.0. No es el runtime fijado. Las pruebas de integración se ejecutan explícitamente con Node 24.21.0 y también dentro de Docker cuando se indica en la evidencia. Las comprobaciones de npm en Node 25 emiten advertencias de engines; no se ocultan ni cambian los requisitos para eliminarlas.

Fuentes primarias de las decisiones implementadas:

- [Calendario y versiones Node](https://nodejs.org/en/about/previous-releases): política LTS y elección de runtime.
- [Migración y requisitos NestJS 12](https://docs.nestjs.com/migration-guide): compatibilidad con Node y paquetes ESM.
- [OpenAPI en NestJS](https://docs.nestjs.com/openapi/introduction): generación desde controladores.
- [Drizzle: migraciones](https://orm.drizzle.team/docs/migrations), [Drizzle migrate](https://orm.drizzle.team/docs/drizzle-kit-migrate): SQL versionado y registro de migraciones.
- [BullMQ conexiones](https://docs.bullmq.io/guide/connections), [compatibilidad Redis](https://docs.bullmq.io/guide/redis-tm-compatibility/), [reintentos](https://docs.bullmq.io/guide/retrying-failing-jobs): noeviction, conexiones de worker y backoff.
- [PostgreSQL: schemas y privilegios](https://www.postgresql.org/docs/18/ddl-schemas.html): separar propiedad y permisos de datos.
- [AWS S3: uploads firmados](https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html): las URLs firmadas tendrán alcance y vencimiento; carga por usuarios aún pendiente.
- [RustFS repositorio oficial](https://github.com/rustfs/rustfs), [releases](https://github.com/rustfs/rustfs/releases): proveedor S3 local; verificar operaciones necesarias con pruebas.
- [FFprobe opciones](https://ffmpeg.org/ffprobe.html): JSON/show_entries y ejecución por argumentos.
- [Prometheus client oficial](https://github.com/prometheus/client_js): sustitución de prom-client por el paquete mantenido.
- [Docker Desktop CLI](https://docs.docker.com/desktop/features/desktop-cli/): arranque del motor observado detenido.

Fuentes para próximos adaptadores, **sin integración funcional anunciada**:

- [Postmark SMTP](https://www.postmarkapp.com/developer/user-guide/send-email-with-smtp): requiere habilitar acceso y credenciales; TLS obligatorio en implementación futura.
- [Deepgram pre-recorded](https://developers.deepgram.com/reference/speech-to-text/listen-pre-recorded), [diarización](https://developers.deepgram.com/docs/diarization): candidato STT; fijar modelo y validar etiquetas realmente recibidas, sin asumir soporte universal.
- [TikTok Direct Post](https://developers.tiktok.com/docs/en/content-posting-api-get-started): app registrada, scope autorizado y auditoría antes de levantar restricciones de visibilidad.
- [YouTube videos](https://developers.google.com/youtube/v3/docs/videos), [insert](https://developers.google.com/youtube/v3/docs/videos/insert): las páginas consultadas presentan información distinta sobre restricciones de proyectos no verificados; revalidar con el proyecto real antes de implementar y publicar. No se asume visibilidad pública disponible.

Instagram, Twitch y Kick requieren revisión oficial adicional en su etapa. No hay importador universal ni descarga de plataformas implementada.
