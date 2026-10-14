# Protocolo propuesto de evaluación de tesis

No hay resultados de evaluación, usuarios comerciales, ventas ni rentabilidad medidos en esta entrega.

## Diseño

Usar al menos 12 videos autorizados de distintos hablantes/ruido/duración (p. ej. 5–30 minutos), español y otros idiomas solo si se evalúan explícitamente. Separar conjunto de ajuste de prompts y conjunto de evaluación. Definir tareas equivalentes: obtener una cantidad fija de clips dentro de un rango de duración, con subtítulos y encuadre especificado.

Comparación cruzada y orden aleatorio entre flujo manual y asistido, idealmente con 6–10 evaluadores; registrar experiencia de edición. Medir tiempo activo humano por separado de espera de máquina. Evitar que el mismo participante edite el mismo contenido dos veces sin controlar el efecto de aprendizaje.

| Métrica | Definición y evidencia |
|---|---|
| Tiempo manual/asistido | Segundos desde inicio de tarea hasta entrega aprobada; registrar intervención humana y esperas; ahorro relativo = (manual−asistido)/manual |
| Procesamiento por minuto | Tiempo monotónico desde admisión a resultado / duración de entrada en minutos; separar cola, descarga, STT, análisis y render |
| Costo por trabajo | Uso facturado de IA + CPU/RAM temporal + almacenamiento/egreso asignados; registrar tarifa, fecha y supuestos; estimación vs cargo real separados |
| Tasa completada | Trabajos que satisfacen especificación / trabajos admitidos; cancelaciones, fallos de red y entradas inválidas reportados por separado |
| Transcripción | WER=(S+D+I)/N sobre referencia humana; normalización escrita antes de evaluar; medir también error temporal de timestamps y idioma |
| Utilidad de segmentos | Evaluación ciega por ≥2 revisores: coherencia, relevancia, inicio/fin, utilidad social, subtítulos; escala 1–5 y acuerdo entre revisores |

Reportar mediana, p95 e intervalos de confianza (bootstrap si procede), tamaños de muestra, hardware, concurrencia, versiones/modelos, prompts, idioma y errores. No inferir viralidad a partir de una puntuación del modelo. Las muestras de voz requieren consentimiento y política de eliminación.

## Costos con supuestos explícitos

Escenario ilustrativo de dimensionamiento: 100 trabajos/mes, 20 minutos cada uno, 1 GiB de entrada y 0.1 GiB de derivados por trabajo, retención 30 días, 2 descargas de derivados por trabajo. **No representa uso ni precio observado**.

- Transcripción: 2000 minutos × tarifa_STT_por_minuto.
- Análisis: tokens_entrada/1e6 × tarifa_entrada + tokens_salida/1e6 × tarifa_salida, sumados por trabajo.
- Workers: horas_CPU × tarifa_CPU + GiB_hora_RAM × tarifa_RAM; medir render/inspección antes de estimar capacidad.
- Objetos: aproximadamente 110 GiB al alcanzar retención estable × tarifa_GiB_mes; añadir operaciones y backups.
- Egreso mínimo ilustrativo de derivados: 20 GiB/mes × tarifa_egreso, más previsualizaciones si se implementan.
- Costos fijos: bases, Redis, correo, observabilidad, dominio y soporte; pagos/comprobantes solo al definir proveedor y jurisdicción.

Completar tarifas desde ofertas oficiales fechadas cuando se elijan proveedores/región. Los precios del proyecto Java anterior no se consideran definitivos. No estimar utilidad comercial sin ingresos reales y costos completos.
