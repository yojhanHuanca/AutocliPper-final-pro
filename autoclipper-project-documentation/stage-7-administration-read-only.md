# Administración mínima de solo lectura

Esta primera entrega proporciona consultas administrativas reales de metadatos mediante privilegios globales separados de las membresías de workspace. No es el panel administrativo completo: suspensión, borrado, configuración global, créditos, pagos, tickets/notificaciones y cumplimiento integral de privacidad siguen pendientes. No añade una cuenta administradora inicial, una contraseña predeterminada ni autoasignación desde la web.

## Autoridad y acceso

Identity es dueño de `admin_grants`, `admin_elevations` y `admin_access_audit` (migraciones aditivas `0004_administration` y `0005_admin_audit_grant_context`). El runtime solo lee grants; INSERT/UPDATE/DELETE/TRUNCATE están revocados. Un operador con la conexión owner de Identity ejecuta el CLI para conceder/revocar cuatro permisos explícitos:

| Permiso | Información autorizada |
|---|---|
| users.read | UUID, verificación, MFA habilitado y fecha de creación; requiere scope global explícito |
| workspaces.read | UUID, tipo personal/team, cantidad de miembros y fecha; scope global o allowlist de workspaces |
| jobs.read | UUID de intención, workspace, tipo, estado, fechas y código de error clasificado; scope global o allowlist |
| consumption.read | Workspace, versión de plan de desarrollo y segundos asignados/consumidos/reservados del mes UTC; scope global o allowlist |

Scope `global` es explícito. Una allowlist admite de uno a cincuenta UUID. Un workspace owner/admin no recibe ninguno de estos permisos automáticamente. `users.read` está prohibido en grants limitados a workspaces: Identity no enumera usuarios mediante membresías pertenecientes a otra base.

El usuario debe estar verificado y tener MFA habilitado para recibir un grant y para usarlo. Usa el login/cookie existentes. Además, POST `/v1/admin/access` exige CSRF, contraseña actual y TOTP fresco o recovery code de un uso; abre una elevación de **cinco minutos** ligada a esa sesión y revisión del grant, sin otro token público. TOTP/recovery conservan las verificaciones, protección de replay y límites de Identity. El navegador no decide duración, permisos, sesión ni alcance.

Cada consulta comprueba sesión/access token activos, verificación, MFA vigente, grant no revocado, permiso, scope y elevación/revisión actuales. No cachea autoridad. Revocar o actualizar el grant invalida la elevación anterior; revocar la sesión/deshabilitar MFA también bloquea el acceso. La autorización ya realizada de una solicitud en vuelo es su punto de decisión; la revocación se aplica a las verificaciones posteriores, sin prometer cancelar respuestas ya autorizadas. Redis limita treinta consultas administrativas por actor/minuto, también al atravesar contratos internos; sus fallos y los de Identity/auditoría no conceden acceso. Reautenticación conserva además los límites existentes de Identity.

La frontera pública limita además 120 solicitudes administrativas/minuto por IP antes de validar cookies o consultar grants. Incluye capacidad propia y reautenticación, para acotar lookups/auditoría ante cookies fabricadas; solo acepta la IP reenviada cuando viene de la credencial de servicio, y guarda su digest en Redis con TTL, no la devuelve. Las solicitudes rechazadas por este límite anterior a la autorización producen 429 y no un evento de autorización inventado. No sustituye protección de borde/capacidad multi-host de producción.

Una elevación no concede membresías ni acceso a fuentes, transcripciones, borradores, descargas o datos privados mediante APIs normales. No se omiten sus controles de workspace.

## Bootstrap por operador

Obtener el UUID de una cuenta verificada que ya haya configurado MFA. Usar la configuración ignorada de Identity con su `MIGRATION_DATABASE_URL` owner; nunca enviar conexión, contraseña, secreto TOTP o recovery codes como argumentos CLI. Desde backend:

```powershell
node --env-file=.env.identity scripts/admin-operator.mjs grant --user-id <UUID> --permissions workspaces.read,jobs.read,consumption.read --workspaces <WORKSPACE_UUID> --operator-reference <REFERENCIA_OPERATIVA>
node --env-file=.env.identity scripts/admin-operator.mjs grant --user-id <UUID> --permissions users.read,workspaces.read,jobs.read,consumption.read --workspaces global --operator-reference <REFERENCIA_OPERATIVA>
node --env-file=.env.identity scripts/admin-operator.mjs revoke --user-id <UUID> --operator-reference <REFERENCIA_OPERATIVA>
```

Los ejemplos son alternativas, no una instrucción para conceder scope global a todos. El CLI valida argumentos/permisos/scope y conexión a `autoclipper_identity` como `autoclipper_identity_owner`; requiere verificación y MFA habilitado al conceder. Grant/revoke y su registro de auditoría se confirman en una transacción. Toda modificación incrementa la revisión, incluso repetir grant. La salida contiene solo UUID, revisión, permisos y alcance; un fallo devuelve error genérico sin credenciales. La referencia del operador admite un identificador operativo de 1–64 caracteres alfanuméricos/guion/underscore, sin texto libre ni correo. Atribuir ese identificador a un operador y proteger/auditar el acceso owner corresponde al procedimiento operativo; no es autenticación humana adicional implementada por el CLI.

No se ha concedido privilegio global a una cuenta humana como parte de esta entrega. Las pruebas usan únicamente cuentas sintéticas y revocan sus grants al terminar.

## Contrato para Angular

Todas las rutas usan el gateway y la cookie existente. El OpenAPI público incluye sus respuestas/tipos y CSRF para la reautenticación:

| Método y ruta | Uso |
|---|---|
| GET `/v1/admin/access` | Capacidad propia: granted, mfaEnabled, permissions, workspaceIds y elevatedUntil; no enumera otras cuentas |
| POST `/v1/admin/access` | Body estricto `{password,factor}`; respuesta `{elevatedUntil}` |
| GET `/v1/admin/users` | Página de usuarios redactada; requiere users.read |
| GET `/v1/admin/workspaces` | Página de workspaces dentro del grant |
| GET `/v1/admin/jobs` | Página de intenciones de audio/render/análisis/pipeline dentro del grant |
| GET `/v1/admin/consumption` | Página de asignaciones existentes de Billing dentro del grant |

Las páginas responden `{items,nextBeforeId}`. Query estricto: `limit` 1–50 (predeterminado 25), `beforeId` UUID exclusivo y `workspaceId` opcional para las tres consultas de workspace. El orden es UUID descendente, no orden cronológico; solicitar limit+1 permite indicar con precisión si existe página posterior. Enviar un workspace ajeno al scope devuelve 403. Consultar sin filtro conserva la allowlist del grant. Se rechazan parámetros extras como scope, workspaceIds o role. La consulta de usuarios no admite workspaceId.

La capacidad propia GET access puede consultarse antes de elevar; no entrega datos administrativos. `granted=false` no habilita navegación administrativa. `elevatedUntil=null` exige reautenticación. Manejar 401/403/429/503 sin reintentar por rutas normales para evadir autoridad, y no fabricar cifras/cuentas cuando falten datos. El runtime vigente valida cada respuesta contra un esquema estricto antes de devolverla al navegador.

No devuelve nombres de personas/equipos/proyectos, direcciones de correo, IP, tokens/hashes de credenciales, MFA secrets, object keys, URLs firmadas, specs/payloads, captions, transcript, propuestas ni respuestas crudas de proveedor. Los errores de jobs se reducen a códigos clasificados; una cadena que no corresponde al formato se oculta. `jobs` refleja el estado persistido de las intenciones de Project, actualizado por su reconciliación normal; no es inspección directa de una cola ni diagnóstico en tiempo real de los workers. Billing lista únicamente workspaces con asignación existente, sin crear planes/asignaciones al leer; la unidad sigue siendo segundos de material **por etapa**, sin dinero ni créditos públicos.

## Dueños, auditoría y límites

El gateway envía admin a Identity. Identity consulta su propia proyección de usuarios; Workspace, Project y Billing exponen proyecciones internas limitadas de sus datos. Cada dueño exige la credencial de servicio y vuelve a consultar autoridad vigente en Identity para el permiso fijo que implementa; no acepta actor/scope del navegador. Ningún runtime recibe URL SQL de otra base ni lee sus tablas. Las rutas internas están excluidas del OpenAPI público y no tienen proxy público.

Identity registra allowed/denied por verificación administrativa, reauth/reauth_denied y grant/revoke. Conserva UUID de actor o sujeto del cambio, permiso, workspace solicitado, correlación y referencia operativa cuando aplica; no conserva contraseña/factor/cookie, contenido privado ni query libre. Los accesos/elevaciones autorizados conservan la revisión del grant; cada grant/revoke conserva en esa revisión los permisos y scope, para reconstruir autoridad pasada aunque cambie la fila vigente. Los cambios por CLI registran al sujeto y referencia operativa, sin atribuir falsamente la acción al usuario afectado. Allowed acredita una autorización, no garantiza que el dueño haya terminado una consulta después de una caída. La lectura de capacidad propia no equivale a consultar datos administrativos. La auditoría es append-only mediante trigger y permisos runtime; su retención/purga/exportación integral y respaldo operativo siguen en el backlog de privacidad/operación, sin anunciar cumplimiento legal.

Los servicios internos comparten la autenticación de servicio de desarrollo existente; segmentación/mTLS, credenciales por audiencia, operación multi-host y pruebas de carga/SLO de producción siguen pendientes. El scope y la redacción reducen acceso de usuarios administradores autorizados; no se afirma protección frente al compromiso de un dueño de datos o de la conexión operator owner.

## Verificación y ventana de actualización

La suite `tests/admin-integration/read-only.test.mjs` usa servicios HTTP reales, Pg/Redis, CLI owner real, login/TOTP/recovery codes/CSRF reales y consultas/redacción de dueños. Las cuentas previamente verificadas y jobs terminales con canarios privados son fixtures SQL explícitos: no acreditan SMTP, ASR ni renders reales. Billing recibe eventos skipped explícitos para probar lectura de reservas/liquidación, sin atribuir inferencia a esos eventos. Se comprueban negativos, scope, paginación, ausencia de contenido/tokens, permiso runtime de solo lectura sobre grants, elevación por sesión, expiración explícita de test, cambio de revisión, revocación CLI/MFA/sesión, 30/min e inmutabilidad de auditoría. Los límites existentes se respetan; si Identity devuelve 429 al preparar cuentas sintéticas, se espera el vencimiento natural sin borrar contadores.

Preparar build/contratos primero. Coordinar con el frontend antes de recrear Identity/Workspace/Project/Billing/Gateway; ejecutar la migración aditiva y conservar todos los volúmenes. `admin-verification` es opt-in con profile test y requiere el stack actualizado, Project activo y roles owner únicamente en el verificador, nunca en la aplicación:

```powershell
docker compose -f compose.yaml -f compose.business.yaml -f compose.business-tests.yaml --profile app run --no-deps --rm admin-verification
```

Verificación propia completada: lint/build, OpenAPI/tipos y 30 unitarias/HTTP; diez tests administrativos aprobados (95.36 s, incluyendo espera natural del límite y comprobación SQL final de cero grants sintéticos activos). Las dos migraciones aditivas fueron aplicadas/repetidas antes de la pausa y la suite revalidada después, sin recrear servicios durante esa revalidación. La regresión existente con whisper.cpp real aprobó siete tests antes de la pausa (105.91 s): transcripción/procedencia, MP4/SRT/VTT privados, revisión de editor/split, pipeline de una petición, ledger y aislamiento. No se atribuye esa inferencia a los fixtures de administración ni a CI.

La primera ejecución administrativa tuvo tres tests aprobados y siete fallidos contando el padre: reautenticación usaba SELECT FOR SHARE sobre grants y PostgreSQL exigía UPDATE (SQLSTATE 42501), correctamente revocado al runtime. Se retiró ese bloqueo sin conceder DML; el chequeo de revisión en cada lectura invalida una elevación si el operador modificó/revocó el grant. La suite completa quedó aprobada después. El guard de limpieza de temporales del ensayo ASR se validó antes de usar el directorio para conservar también lint sin excepciones directas en finally.

Comparación semántica del contrato público respecto al HEAD previo: cero rutas/esquemas existentes modificados y cinco rutas nuevas (GET/POST access y cuatro consultas). Construcción del verificador con cero vulnerabilidades npm reportadas. CI del SHA publicado se registrará tras comprobarla. No se modifican ni publican archivos Angular, diseño o arquitectura ajenos desde este trabajo; no se concedió administración a cuentas humanas ni se activaron producción/pagos.
