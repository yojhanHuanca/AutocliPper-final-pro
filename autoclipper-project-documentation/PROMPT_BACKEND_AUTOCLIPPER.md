# Prompt de implementación del backend de AutoClipper

Actúa como arquitecto de software y desarrollador backend senior. Diseña e implementa el backend de AutoClipper, una startup que convierte videos largos en clips para redes sociales mediante inteligencia artificial.

El producto será utilizado por usuarios reales y sustentará una tesis de Diseño y Desarrollo de Software. La implementación debe ser organizada, escalable, segura, documentada y verificable.

Trabaja con autonomía en decisiones técnicas rutinarias. Implementa por etapas, verifica y documenta. No presentes funciones simuladas como terminadas.

## 1. Contexto y restricciones

- Nombre: AutoClipper.
- Título: “AutoClipper: Plataforma inteligente basada en inteligencia artificial para la generación y gestión automatizada de clips de video para redes sociales”.
- Línea de titulación: Startup.
- Existe una versión anterior con Java y Spring Boot. No modifiques ese proyecto ni copies secretos.
- Directorio: `C:\estudio\4_ciclo\proyecto\AutocliPper-final-pro`.

Confirma el directorio y lee las instrucciones locales antes de escribir. Si no tienes acceso, informa la limitación; no escribas silenciosamente en otro proyecto.

Usa un repositorio Git independiente. Comprueba si ya existe y si hay un repositorio padre antes de inicializarlo. No alteres el historial anterior. Para publicar un repositorio remoto deben estar definidos proveedor, propietario y visibilidad. Si faltan, prepara el repositorio local y solicita solo esos datos. Nunca publiques secretos.

```text
AutocliPper-final-pro/
├── autoclipper-web-angular/
├── autoclipper-backend-microservices/
├── autoclipper-infrastructure/
└── autoclipper-project-documentation/
```

El frontend será Angular con TypeScript. Este encargo comprende backend, infraestructura y documentación; no construyas la interfaz Angular. Usa nombres descriptivos y consistentes, sin alargarlos sin propósito.

## 2. Tecnologías

Obligatorias: Node.js, NestJS, TypeScript estricto, PostgreSQL, FFmpeg, FFprobe, Redis, BullMQ, almacenamiento compatible con S3, OpenAPI/Swagger, Docker y Docker Compose.

Verifica versiones estables compatibles mediante documentación oficial y fija versiones reproducibles. Elige y justifica gestor de paquetes, herramienta de monorepositorio, ORM, migraciones, transporte entre servicios, correo, adaptadores de IA y proveedor de pagos cuando corresponda.

Evita herramientas redundantes. No agregues Kubernetes, Kafka o una malla de servicios sin necesidad demostrable.

## 3. Arquitectura

```text
autoclipper-backend-microservices/
├── apps/
│   ├── autoclipper-api-gateway/
│   ├── autoclipper-identity-service/
│   ├── autoclipper-workspace-service/
│   ├── autoclipper-project-service/
│   ├── autoclipper-media-processing-service/
│   ├── autoclipper-content-analysis-service/
│   ├── autoclipper-social-publishing-service/
│   ├── autoclipper-billing-service/
│   └── autoclipper-notification-service/
└── packages/
    ├── autoclipper-api-contracts/
    ├── autoclipper-event-contracts/
    ├── autoclipper-observability/
    ├── autoclipper-configuration/
    └── autoclipper-testing/
```

Define responsabilidades antes de implementar y documenta ajustes fundamentados. Cada servicio debe poder ejecutarse y desplegarse de manera independiente. No crees servicios vacíos para aparentar completitud.

Organiza cada servicio por módulos de negocio, separando dominio, casos de uso, infraestructura e interfaces HTTP/eventos. Mantén dependencias hacia el dominio sin capas ceremoniales.

- El gateway no concentra lógica de negocio.
- No compartas entidades ORM ni repositorios entre servicios.
- Comparte contratos y utilidades técnicas acotadas.
- Ningún servicio escribe datos de otro directamente.
- No uses transacciones distribuidas.
- Define consistencia eventual, compensaciones e idempotencia.
- No asumas entrega exactamente una vez.
- Usa outbox/inbox cuando sea necesario para coordinar persistencia y eventos.
- Evita dependencias circulares y cadenas síncronas innecesarias.

## 4. Datos y multitenencia

PostgreSQL almacena datos estructurados; videos, audios, miniaturas y exportaciones van al almacenamiento de objetos. En desarrollo puede haber una instancia PostgreSQL con bases o esquemas y credenciales separados por servicio, conservando la posibilidad de separación física.

Diseña usuarios, identidades, sesiones, verificaciones, workspaces, miembros, invitaciones, proyectos, archivos, transcripciones, segmentos, clips, revisiones, configuraciones del editor, trabajos, conexiones sociales, publicaciones, planes, suscripciones, consumo, notificaciones y auditoría.

Incluye identificadores, fechas, restricciones, índices y reglas de borrado. Verifica acceso al workspace y al recurso en cada operación; un workspaceId enviado por el cliente no demuestra autorización.

Entrega migraciones reproducibles, datos de demostración sin información sensible y políticas de conservación. Usa borrado lógico solo con finalidad clara.

## 5. Identidad y equipos

Implementa registro, verificación de correo, login, recuperación de contraseña, Google validado en servidor, contraseñas con Argon2id o equivalente apropiado, sesiones, renovación y revocación.

Incluye rotación de refresh tokens y detección de reutilización, dos factores con códigos de recuperación, perfil, preferencias, exportación y eliminación de datos.

Implementa workspaces personales y de equipo, invitaciones con vencimiento, roles propietario/administrador/editor/lector, transferencia de propiedad y protección contra dejar un workspace sin propietario.

Documenta autenticación de Angular, cookies, CORS y protección CSRF según el mecanismo elegido.

## 6. Ingesta y proyectos

- Proyectos, carpetas, etiquetas, búsqueda, filtros y favoritos.
- Cargas directas con URLs firmadas, multipart y recuperación de interrupciones.
- Confirmación verificando realmente el objeto almacenado.
- Validación de tamaño, duración, formato y cuota; metadatos con FFprobe.
- Importación mediante adaptadores autorizados.
- Papelera, eliminación, cancelación y reintentos apropiados.

No prometas compatibilidad universal con YouTube, Twitch o Kick. Verifica mecanismos, permisos y límites. Protege importaciones contra SSRF, redirecciones peligrosas y redes privadas; limita tamaños y tiempos de descarga.

## 7. Procesamiento e IA

Pipeline persistente: carga validada → inspección → extracción de audio → transcripción → análisis → segmentos → clips → subtítulos/formato → exportación.

Cada etapa tendrá estados y transiciones válidas, identificador y correlación, tiempos, errores clasificados, reintentos limitados con backoff, cancelación cooperativa, limpieza, métricas y recuperación ante reinicios.

Distingue avance medido de estimado. No inventes porcentajes.

IA: transcripción temporal, idioma, hablantes si el proveedor lo permite, segmentos coherentes, instrucciones personalizadas, duración/cantidad configurables, títulos, descripciones, hashtags, traducción, explicación de selección y registro de modelo, versión de prompt y costo estimado.

Valida las respuestas de IA y sus tiempos contra el video. Trata transcripciones y contenido como datos no confiables: sus instrucciones no pueden alterar permisos ni ejecutar herramientas.

Las puntuaciones serán orientativas; no garantices viralidad. Usa adaptadores intercambiables. Sin credenciales, indica proveedor no configurado. Mocks solo en pruebas o demostraciones identificadas.

## 8. Edición y exportación

Admite una descripción versionada y validada de edición: inicio/fin, unión de segmentos implementada, encuadre, relación de aspecto, vertical/cuadrado/horizontal, seguimiento con ajuste manual cuando esté disponible, subtítulos, estilos, logos, marca, pantalla dividida, volumen, fundidos, pistas, resolución y calidad.

Incluye borradores, concurrencia para evitar sobrescrituras, revisiones, previsualización, render final, descarga de video/SRT/VTT, historial y URLs temporales.

Ejecuta FFmpeg con argumentos seguros sin concatenar comandos del usuario. Limita CPU, memoria, disco y tiempo; aísla workers y valida recursos/opciones. Documenta diferencias entre vista previa y render final.

## 9. Colaboración y publicación

Colaboración: comentarios temporales, estados, aprobaciones, enlaces revocables con vencimiento e historial.

Publicación: adaptadores para TikTok, Instagram y YouTube; OAuth con state y PKCE según corresponda; tokens cifrados, renovación, desconexión y revocación; validación por destino; publicación inmediata/programada permitida; calendario y zona horaria; instantes UTC y zona IANA; horarios ambiguos/inexistentes; cancelación; estados, errores y enlace al resultado; prevención de duplicados y conciliación ante respuestas inciertas.

Verifica documentación oficial vigente y documenta permisos, revisiones y credenciales que requieran al propietario. Un endpoint existente no demuestra una integración funcional.

## 10. Facturación y consumo

Implementa catálogo de planes versionado, suscripciones, cuotas de procesamiento/almacenamiento/miembros/exportaciones, reserva previa y conciliación, ajustes ante fallos con política explícita, historial, avisos, cambios/cancelación, créditos, promociones y auditoría.

Webhooks firmados, idempotentes y tolerantes a desorden. No fijes precios anteriores como definitivos. No almacenes tarjetas completas ni confundas recibos de pagos con comprobantes tributarios.

Sin proveedor elegido, implementa contratos y consumo interno; documenta pendientes sin simular cobros reales.

## 11. Notificaciones, soporte y administración

Notificaciones internas y por correo con preferencias: procesos, fallos, cuotas y conexiones vencidas. Tickets básicos de soporte.

Administración de usuarios, equipos, planes, trabajos, ajustes de créditos con motivo y auditoría; métricas operativas y comerciales. Usa permisos específicos, no acceso global por conocer una ruta.

## 12. Contratos para Angular

API versionada, OpenAPI, DTO validados, paginación limitada, filtros/ordenamiento permitidos, errores consistentes con código y correlationId, fechas/unidades documentadas, idempotencia, SSE o WebSocket autorizado con reconexión/consulta de estado, ejemplos y generación de cliente TypeScript.

No expongas tokens, secretos, trazas internas ni información de otros equipos.

## 13. Operación y escalabilidad

Escala gateway, servicios HTTP y workers de transcripción/análisis/render independientemente. Configura concurrencia, prioridades y límites por trabajo/workspace; evita monopolización.

Incluye logs estructurados con redacción, correlación, trazas, métricas, liveness/readiness, apagado ordenado, timeouts, reintentos acotados, backpressure, backups y restauración, retención, Docker reproducible sin privilegios, entornos separados y CI con lint/tipos/pruebas/build.

No prometas millones de usuarios sin mediciones.

## 14. Pruebas y aceptación

Verifica permisos y aislamiento, sesiones, archivos, recuperación del pipeline, ausencia de duplicados, cuotas, webhooks desordenados, migraciones reales en PostgreSQL, contratos y flujo con video corto autorizado.

Primera aceptación:
1. Crear y verificar cuenta.
2. Crear proyecto.
3. Subir video.
4. Procesar con proveedor real configurado.
5. Obtener clip con subtítulos.
6. Consultar estado.
7. Descargar resultado.
8. Comprobar que otro usuario no accede.

Mocks no satisfacen por sí solos esta aceptación. Registra comandos, resultados y límites; no declares pruebas aprobadas sin ejecutarlas.

## 15. Documentación y tesis

Entrega alcance/prioridades, diagramas de contexto/servicios/despliegue, propiedad de datos, modelos, flujos, contratos HTTP/eventos, decisiones y alternativas, amenazas, guía local, variables sin secretos, despliegue/restauración, costos con supuestos, evidencia y pendientes.

Propón evaluación de tiempo manual versus asistido, tiempo por minuto de video, costo por trabajo, tasa de éxito, calidad de transcripción y utilidad de segmentos evaluada por personas. No inventes resultados, clientes, ventas o rentabilidad.

## 16. Ejecución por etapas

1. Entorno, repositorio independiente, arquitectura, workspace, Docker, PostgreSQL, Redis, almacenamiento y CI.
2. Identidad, equipos, permisos, proyectos y carga segura.
3. Pipeline completo con transcripción, selección, render y descarga.
4. Editor, versiones, marca y colaboración.
5. Publicación/calendario con integraciones verificadas.
6. Facturación, consumo, soporte y administración.
7. Carga, recuperación, seguridad y documentación final.

En cada etapa implementa, verifica, corrige, documenta e informa resultados y pendientes. Ante bloqueos externos continúa tareas independientes y registra el bloqueo; no reemplaces integraciones reales silenciosamente por simulaciones.

## 17. Resultado esperado

Entrega código ejecutable, infraestructura, migraciones, contratos para Angular, pruebas y documentación.

Mantén una matriz de estado:
- Implementado y verificado.
- Implementado sin verificación externa.
- Pendiente de configuración.
- Pendiente de desarrollo.

Empieza inspeccionando el entorno y preparando la primera etapa. Prioriza un flujo real confiable y amplíalo hasta cubrir el alcance sin comprometer límites entre servicios.
