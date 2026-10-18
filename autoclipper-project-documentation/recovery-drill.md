# Ensayo aislado de recuperación cifrada

Fecha: 18 de octubre de 2026. Incremento de operación, separado de la arquitectura pública [Cloudflare](cloudflare-architecture.md). Estado inicial: implementación y prueba de cifrado verificadas; ejecución completa con Docker/CI pendiente de registrar abajo. No reemplaza un sistema de backup de producción.

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
- Motor Linux local: inaccesible al preparar este incremento después de la reanudación; no se ejecutó ni se anuncia el restore completo local. El driver se incorpora al job business de CI para verificarlo en un Docker independiente.
- Restore completo: pendiente del resultado CI del commit de implementación. No elevar el estado en `status.md` hasta obtener esa evidencia.

## Uso operativo fuera del fixture

El driver no es una herramienta para parar el stack real ni para seleccionar volúmenes existentes. Un backup real necesita una ventana con todos los escritores/dispatchers/workers detenidos, conciliación de operaciones en curso y consistencia entre las seis bases, objetos y secretos. Una copia física RustFS preserva metadatos locales; copiar objetos mediante PUT puede cambiar ETags multipart, y una migración R2 requiere su propia validación. No modificar los ETags persistidos para ocultar una recuperación incorrecta.

Antes de habilitar efectos tras un restore real, mantener proveedores de pago/publicación deshabilitados y conciliar los intentos posteriores al checkpoint o de resultado incierto. La reconstrucción de Redis no autoriza volver a cobrar ni publicar. La política de privacidad también debe contemplar tombstones/eliminaciones y la posible reaparición de datos desde copias antiguas. Estas decisiones continúan en el [backlog de lanzamiento](launch-backlog.md).
