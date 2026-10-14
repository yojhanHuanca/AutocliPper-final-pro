# Alcance y prioridades

Esta entrega implementa la etapa 1 e inicia la inspección multimedia interna para verificar la base técnica. No equivale a producto completo ni satisface aún la aceptación de una cuenta que genera clips con IA real.

| Etapa | Entrega y criterio de salida | Estado |
|---|---|---|
| 1 | Repo independiente, workspace estricto, NestJS, dependencias Docker, roles/migraciones, salud/contratos, pruebas reales y CI básica | Implementada; ver evidencia y pendientes operativos |
| 2 | Identidad completa, workspaces/roles, proyectos, carga directa/multipart segura y confirmación real; tests de aislamiento | Pendiente de desarrollo |
| 3 | Extracción, proveedor real de transcripción, selección validada, render/subtítulos, estado y descarga; flujo real completo | Inspección interna implementada; demás pendiente |
| 4 | Especificación de edición versionada, concurrencia, revisiones, marca, comentarios, aprobación y review links | Pendiente |
| 5 | OAuth y publicación/calendario por proveedor permitido, zonas IANA, dedupe y conciliación | Pendiente; revisión oficial y credenciales al implementar |
| 6 | Consumo interno, reservas/conciliación, planes versionados, proveedor de pagos si se elige, soporte/admin autorizados | Pendiente |
| 7 | Carga, recuperación ante cortes reales, seguridad, restore completo, evaluación de tesis y documentación final | Pruebas base disponibles; evaluación final pendiente |

## Siguiente recorrido funcional

Registro → verificación real por correo → sesión segura → workspace personal → proyecto → intención de carga autorizada → multipart/PUT firmado → HEAD/checksum y cuota → inspección → extracción → transcripción real → segmentos → render con subtítulos → consulta autorizada → descarga temporal. Otro usuario debe recibir denegación sin conocer el recurso.

Este recorrido se probará con un video corto de voz autorizado y proveedor real configurado. Los mocks no aceptan la etapa 3. Pendencias de proveedor no deben bloquear el desarrollo de permisos, datos, almacenamiento y render.

## Funciones que no se anuncian antes de implementarlas

Importación universal YouTube/Twitch/Kick; tracking automático; unión de segmentos, pantalla dividida y múltiples pistas; viralidad garantizada; publicación a redes sin revisión/permisos; cobros sin proveedor; métricas de clientes, ventas y rentabilidad. Cada capacidad debe tener validación, pruebas e integración real antes de pasar a implementada.

## Integraciones

Correo y Google necesitan dominio/clientId, callback permitido y validación servidor. La IA necesita selección definitiva del proveedor, credenciales, política de datos y presupuesto. Social necesita cuentas de desarrollador, revisión de aplicación y scopes por destino. Pagos requiere entidad/país/proveedor y verificación de webhooks. No se buscaron ni reutilizaron secretos del proyecto anterior.
