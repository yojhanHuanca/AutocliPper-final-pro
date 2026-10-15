# Alcance y prioridades

La entrega actual acredita el recorrido de cuenta a transcripción local real y descarga, con intervalo manual, edición versionada y colaboración. Pantalla dividida está en verificación. La selección automática, marca/audio avanzado y capacidades de lanzamiento restantes siguen pendientes. Ver [matriz vigente](status.md), [evidencia de ASR real](stage-3-analysis.md) y [backlog de lanzamiento](launch-backlog.md); las entregas parciales no equivalen a producción lista.

| Etapa | Entrega y criterio de salida | Estado |
|---|---|---|
| 1 | Repo independiente, workspace estricto, NestJS, dependencias Docker, roles/migraciones, salud/contratos, pruebas reales y CI básica | Implementada; ver evidencia y pendientes operativos |
| 2 | Identidad, workspaces/roles, proyectos, carga directa/multipart y aislamiento | Recorrido y 2FA verificados; Google externo, fulfillment de privacidad y gestión avanzada pendientes |
| 3 | Extracción, proveedor real de transcripción, selección validada, render/subtítulos, estado y descarga; flujo real completo | Audio, whisper.cpp real y render/descarga verificados con intervalo manual; selección real, traducción y orquestación automática pendientes |
| 4 | Especificación de edición versionada, concurrencia, revisiones, marca, comentarios, aprobación y review links | Edición/colaboración verificadas; split en verificación; marca/audio avanzado pendientes |
| 5 | OAuth y publicación/calendario por proveedor permitido, zonas IANA, dedupe y conciliación | Pendiente; revisión oficial y credenciales al implementar |
| 6 | Consumo interno, reservas/conciliación, planes versionados, proveedor de pagos si se elige, soporte/admin autorizados | Pendiente |
| 7 | Carga, recuperación ante cortes reales, seguridad, restore completo, evaluación de tesis y documentación final | Pruebas base disponibles; evaluación final pendiente |

## Siguiente recorrido funcional

Recorrido ya acreditado: registro → verificación SMTP local → sesión segura → workspace → proyecto → carga autorizada → HEAD/checksum/cuota → inspección → audio → whisper.cpp real → intervalo manual → clip subtitulado → estado/descarga temporal y denegación a otro usuario. El siguiente incremento de etapa 3 debe reemplazar la elección manual por selección real validada y orquestación automática, preservando ese aislamiento.

La aceptación real utilizó voz sintética autorizada y modelo local fijado; no acredita calidad general ni selección LLM. Los fixtures de proveedores no satisfacen inferencia real. Pendencias de proveedor no deben bloquear trabajo independiente en permisos, datos, almacenamiento, edición y render.

## Funciones que no se anuncian antes de implementarlas

Importación universal YouTube/Twitch/Kick; tracking automático; unión de segmentos y mezcla de pistas; viralidad garantizada; publicación a redes sin validación de permisos; cobros sin proveedor; métricas de clientes, ventas y rentabilidad. Pantalla dividida se marca en verificación hasta cerrar sus pruebas/CI. Cada capacidad debe tener validación, pruebas e integración real antes de pasar a implementada.

## Integraciones

Correo externo y Google necesitan aceptación real y configuración de dominio/orígenes. Google ya valida credenciales en servidor y reutiliza únicamente el client ID público autorizado en configuración local ignorada. ASR local está verificado; LLM y proveedores externos necesitan recursos/configuración, política de datos y presupuesto. Social exige contrastar API/scopes/revisión por destino al implementar. Pagos depende de entidad/país/proveedor y pruebas de webhooks. No se reutilizaron secretos del proyecto anterior.
