# Operación, despliegue y recuperación

## Entornos

Desarrollo: Compose, puertos loopback, secretos aleatorios, Swagger explícito. Pruebas: mismas dependencias reales, fixtures efímeras con IDs propios y limpieza selectiva. Producción: aún sin configuración final ni despliegue; se requieren DNS/TLS, secret manager, IAM por servicio, backups, proveedores y observabilidad central.

La imagen fija Node por versión/digest, npm por versión y FFmpeg por paquete exacto; `npm ci` usa lockfile. APT y sus dependencias se resuelven desde el snapshot Debian `20261013T000000Z`, con firmas de repositorio verificadas; solo se desactiva la caducidad del índice histórico. Promover la imagen resultante por digest y registrar SBOM/paquetes al preparar releases. No se publica ninguna imagen en este encargo.

Los servicios de aplicación ejecutan UID/GID 1000, filesystem de solo lectura, tmpfs limitado, cap_drop ALL y no-new-privileges. La inicialización de PostgreSQL necesita el entrypoint oficial para preparar permisos; sus aplicaciones usan roles no privilegiados. Las imágenes de dependencias usan sus entrypoints oficiales.

## Escalado y backpressure

Gateway sin estado y worker multimedia tienen entradas independientes. El límite de concurrencia es por proceso (2 local); limiter global por cola 10 trabajos/segundo. Despacho por lotes de 50 y reconciliación paginada de 100. Redis noeviction devuelve errores al alcanzar memoria; PostgreSQL mantiene el outbox sin entregar. No se fija capacidad de usuarios: depende de mediciones todavía pendientes.

El reparto justo por workspace, prioridades de negocio, capacidad separada de transcripción/análisis/render y métricas de costo no están implementados. No exponer creación de trabajo hasta contar con cuotas y backpressure de admisión.

Logs JSON incluyen código seguro, correlationId y taskId, y duración/bytes cuando la inspección termina. `/v1/metrics` en media publica métricas HTTP y de proceso con Bearer interno. No se registran bodies, query strings, tokens, cookies ni stack de proveedores. Trazas distribuidas y colector OTel pendientes: correlación no equivale a tracing completo.

Health live separada de ready; errores de dependencias no filtran endpoints. El apagado Nest/BullMQ deja de despachar y espera jobs activos, cierra cola, Redis, S3 y pool. Compose espera hasta 90 segundos antes de forzar: descarga y probe tienen un timeout independiente de 30 segundos cada uno.

## Backup y restauración

Las aplicaciones nunca necesitan password del superusuario. Para backup local desde `autoclipper-infrastructure`, no usar redirección binaria de PowerShell:

```powershell
New-Item -ItemType Directory -Force backups
docker compose exec -T postgres pg_dump -U autoclipper_bootstrap -d autoclipper_media -Fc -f /tmp/media.dump
docker compose cp postgres:/tmp/media.dump ./backups/media.dump
docker compose exec -T postgres rm /tmp/media.dump
```

PostgreSQL: dump diario cifrado fuera del host y WAL/PITR para producción según RPO elegido. Objetos: backups/versionado según capacidades del proveedor; comparar manifiesto de claves/ETags con exportaciones respaldadas. Redis: AOF es durabilidad local, no backup externo. Mantener una copia de roles/configuración administrada en el gestor de secretos. No guardar backups ni credenciales en Git.

Restaurar **en otro stack y volumen**, nunca sobre la única copia: crear roles desde configuración nueva, crear base vacía con owner correcto, copiar dump al contenedor destino y ejecutar `pg_restore --no-owner --role=autoclipper_media_owner --dbname=autoclipper_media ...` desde una sesión de administración. Verificar ownership/grants y migraciones antes de habilitar el runtime. Restaurar objetos al bucket privado correspondiente. Si Redis no se restaura, el reconciliador vuelve a encolar tasks no terminales desde PostgreSQL/outbox. Ejecutar las pruebas de integración y validar conteos, ETags y muestras de objetos. Registrar RTO/RPO medidos; no declararlos cumplidos sin ensayo.

Se verificó `pg_dump -Fc` y `pg_restore --no-owner --role=autoclipper_media_owner` en una base temporal independiente: una migración restaurada y cero filas de prueba residuales; luego se eliminó únicamente esa base temporal y su dump. La restauración integral de objetos, Redis, caída de host y PITR aún no se ha ensayado. La restauración puede reproducir inspecciones, que son idempotentes. Los futuros renders/publicaciones necesitan claves de intención y conciliación de efectos externos: no se permite tratar una restauración como autorización de volver a publicar.

## Retención

Implementado: limpieza de temporales en finally; tmpfs se descarta al recrear el contenedor; S3 aborta multipart incompletos después de 1 día. Filas de prueba/objetos y jobs son retirados selectivamente por las pruebas.

Propuesta pendiente: resultados operativos y eventos 30 días, jobs BullMQ terminales 7 días, papelera 30 días, invitaciones 7 días, verificaciones de correo 24 horas, auditoría mínima 180 días. No existe aún un purgador automático de filas/jobs ni papelera. No eliminar IDs de cola mientras outbox siga siendo reproducible sin garantizar comprobación de terminales; no truncar outbox como solución operativa. Acordar política legal/privacidad y backup antes de usuarios reales.

## Repositorio remoto

El repositorio local es independiente, rama main. Tras la inspección inicial apareció el commit `66097ec` y el remoto `https://github.com/yojhanHuanca/AutocliPper-final-pro.git`, configurados fuera de las acciones de esta implementación. Se conservaron, sin ejecutar push ni cambiar visibilidad. No se verificó su visibilidad ni estado remoto. Confirmar esos datos antes de publicar código. CI se entrega como workflow GitHub Actions; su ejecución remota todavía no está verificada.
