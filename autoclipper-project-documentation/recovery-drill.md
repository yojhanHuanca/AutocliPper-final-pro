# Ensayo aislado de recuperación cifrada

Fecha: 18 de octubre de 2026. Incremento de operación, separado de la arquitectura pública [Cloudflare](cloudflare-architecture.md). El ensayo de restauración local está aprobado con el alcance sintético descrito abajo; su CI se registra por separado. No reemplaza un sistema de backup de producción.

## Alcance ejecutable

Desde la raíz del repositorio:

```powershell
$env:DOCKER_BIN = 'C:\Users\USER\AppData\Local\Programs\DockerDesktop\resources\bin\docker.exe'
node autoclipper-infrastructure/scripts/recovery-drill.mjs
```

En Linux, `docker` se usa por defecto. Requiere motor Linux con al menos dos CPU y 3 GiB asignados, las imágenes fijadas de PostgreSQL/RustFS/Redis ya disponibles y `autoclipper-backend:0.2.0` construido desde este código. El script no descarga imágenes; falla si faltan. Para preparar la imagen local usar el procedimiento de build del repositorio en una ventana acordada, porque la etiqueta también la utiliza el stack de desarrollo. CI ya construye la imagen antes del ensayo.

El driver genera un UUID y crea exclusivamente sus propios contenedores, una red Docker `--internal` y cuatro volúmenes nuevos etiquetados con ese UUID. No publica puertos ni consulta credenciales/configuración del stack compartido. Verifica las etiquetas antes de parar/eliminar cualquier recurso y elimina únicamente los que creó. No ejecuta `compose down`, no selecciona contenedores por prefijo genérico y no toca otros proyectos.

Se inicializa un clúster de origen con los scripts canónicos: seis bases y doce roles owner/runtime. Aplica dos veces las migraciones de los seis dueños y guarda un marcador sintético diferente en cada base. Los marcadores se identifican explícitamente como fixtures; no simulan registros de usuarios, pagos ni inferencia IA. Calcula hashes de todas las tablas `public`/`drizzle`, incluidas migraciones, antes del snapshot.

Genera un MP4 propio de dos segundos con FFmpeg y un objeto multipart de dos partes. Conserva tamaño, ETag y SHA-256. Inserta una inspección realmente pendiente y su outbox con acuse previo, sin ejecutar un worker en origen: representa el caso de perder Redis después de confirmar la entrega.

Para copiar volúmenes se paran limpiamente solo PostgreSQL y RustFS **del ensayo**. PostgreSQL debe indicar `shut down`, no tener `postmaster.pid`, usar PG18 en la disposición esperada y no tener symlinks a datos externos. Se respalda el volumen del clúster completo, no ficheros de una base individual. Esta condición sigue las restricciones de [backup físico de PostgreSQL 18](https://www.postgresql.org/docs/18/backup-file.html); el procedimiento no implementa snapshots atómicos en caliente ni PITR.

Los streams tar se cifran con AES-256-GCM, nonce aleatorio y AAD ligado al UUID, tipo de volumen e identidad exacta de imagen de origen. También se cifra la configuración sintética y el manifiesto de comprobación. No hay un tar en claro en el host. Se autentica el archivo completo antes de abrir un extractor; otra clave, contexto o contenido alterado no puede entregar plaintext al proceso de extracción. Los archivos pertenecen al ensayo en ejecución y deben permanecer inmutables durante las dos pasadas. No se ofrece importar archivos tar arbitrarios.

La restauración se hace en otros dos volúmenes, inicialmente vacíos, con las mismas imágenes fijadas y arquitectura del ensayo. Las credenciales se recuperan desde el sobre cifrado. Un Redis nuevo comienza sin la cola anterior. Se comprueban los manifiestos SQL de las seis bases antes de arrancar un worker, treinta rechazos de conexión cruzada, seis rechazos de DDL runtime y la prohibición de escribir grants administrativos desde runtime.

Se comparan ambos objetos por tamaño, SHA-256 y ETag original, incluido el ETag multipart; se rechaza GET anónimo. Se inicia `InspectionRuntime` real y se exige que reconstruya el trabajo desde PostgreSQL/outbox, ejecute FFprobe sobre el MP4 restaurado y persista `succeeded` con un intento y dimensiones/duración correctas. No equivale a restaurar y ejecutar un pipeline completo de audio/ASR/render ni a conciliar proveedores externos.

## Evidencia y material privado

Salida de éxito: JSON con UUID, checkpoint sintético, tiempos medidos de backup y restauración/verificación, conteos, denegaciones y resultado de inspección. Se escribe también en `.local/recovery/<UUID>/report.json`, ignorado por Git. Solo se escribe `status=passed` si las comprobaciones y la limpieza de recursos Docker terminaron. El código de error evita imprimir stderr de Docker, URLs, SQL o secretos.

Los archivos cifrados están en ese mismo directorio. La clave aleatoria de 32 bytes se crea aparte en `.local/recovery-keys/<UUID>.key`. Los archivos env temporales se retiran al finalizar. El modo 0600 se solicita donde el sistema lo soporta; no acredita una configuración de ACL de Windows. Estas claves son material sintético del laboratorio, no claves de usuarios ni del stack existente. El directorio `.local` no se publica ni se conserva como artifact de CI.

Guardar clave y archivos en el mismo host **no** constituye custodia externa ni recuperación tras pérdida de ese host. En CI son efímeros. Para producción quedan pendientes almacenamiento externo/cifrado/custodia y rotación de claves, política de retención aprobada, programación/alertas, pruebas de volumen representativo, PITR y un procedimiento para credenciales/identidades del entorno destino. No hay RPO/RTO de producción acreditados; los segundos del fixture no son un SLA.

## Resultado registrado

- Prueba local de integridad del sobre: una prueba aprobada, cero fallos/omisiones. Incluye round-trip de más de 1 MiB, rechazo de sobrescritura, clave/contexto incorrectos, corrupción de cabecera/ciphertext/tag y truncamiento; cero bytes emitidos al extractor ante corrupción.
- `npm run verify`: lint, compilación y 31 pruebas aprobadas, cero fallos/omisiones; contratos públicos sin cambios.
- Motor Linux local: inicialmente inaccesible tras la reanudación; posteriormente se recuperó y el gateway existente respondió HTTP 200. No se recreó ese stack para ejecutar el ensayo.
- Primera restauración aprobada: UUID `3fd741aa-bda1-4ca3-85f9-c7969cb246cb`, checkpoint `2026-10-18T19:11:30.198Z`. Seis bases, dos objetos, 30 denegaciones cruzadas, seis DDL runtime denegados, escritura de grants denegada e inspección recuperada `succeeded` en un intento. Backup/parada del fixture: 54.047 s; restore/verificación: 72.926 s; total del ensayo hasta verificar: 166.761 s. No se extrapolan a datos reales.
- Dos intentos previos quedaron interrumpidos durante el diagnóstico del CLI y sus recursos etiquetados se retiraron selectivamente. Sus errores de EOF no se interpretan como un defecto demostrado de Docker ni como un restore válido. La repetición completa anterior sí terminó sus comprobaciones. El driver posterior mueve descifrado/extracción a un helper Linux, acota comandos y retira volúmenes anónimos de sus propios contenedores con `rm -v`.
- Repetición con los ajustes finales aprobada: UUID `01ea6672-dbc2-42c3-9f4b-25e7b3a7380f`, checkpoint `2026-10-18T19:15:17.864Z`; mismas comprobaciones de seis bases, dos objetos, roles y replay. Backup/parada: 30.828 s; restore/verificación: 114.651 s; total hasta verificar: 187.782 s. Descifrado/extracción dentro del helper Linux y limpieza final de recursos/archivos env aprobados.
- CI del incremento `bb53363`: [run 39157441748](https://github.com/yojhanHuanca/AutocliPper-final-pro/actions/runs/39157441748), tres jobs success: 31 unitarias/HTTP, 34 infraestructura, 62 negocio, 10 administración, 7 Analysis fixtures, 8 orquestación y 8 admisión, cero fallos/omisiones; paso de recuperación cifrada aprobado. El SHA de los ajustes finales tendrá su propio resultado remoto.
- CI final de `7f860900bf5771eae6343440161e6aa3996cde56`: [run 39158379956](https://github.com/yojhanHuanca/AutocliPper-final-pro/actions/runs/39158379956), quality/infrastructure/business success; mismos conteos sin fallos/omisiones. Restore final remoto UUID `18e7ebb1-0a92-401a-a423-b0f514452bff`, checkpoint `2026-10-18T19:27:41.853Z`: seis bases, dos objetos, 30 rechazos cruzados, seis rechazos DDL, grants runtime denegados e inspección succeeded en un intento. Backup 9.480 s, restore/verificación 9.635 s, total hasta verificar 28.660 s en el runner; no equivale a tiempos del host local ni a un SLA.

## Uso operativo fuera del fixture

El driver no es una herramienta para parar el stack real ni para seleccionar volúmenes existentes. Un backup real necesita una ventana con todos los escritores/dispatchers/workers detenidos, conciliación de operaciones en curso y consistencia entre las seis bases, objetos y secretos. Una copia física RustFS preserva metadatos locales; copiar objetos mediante PUT puede cambiar ETags multipart, y una migración R2 requiere su propia validación. No modificar los ETags persistidos para ocultar una recuperación incorrecta.

Antes de habilitar efectos tras un restore real, mantener proveedores de pago/publicación deshabilitados y conciliar los intentos posteriores al checkpoint o de resultado incierto. La reconstrucción de Redis no autoriza volver a cobrar ni publicar. La política de privacidad también debe contemplar tombstones/eliminaciones y la posible reaparición de datos desde copias antiguas. Estas decisiones continúan en el [backlog de lanzamiento](launch-backlog.md).
