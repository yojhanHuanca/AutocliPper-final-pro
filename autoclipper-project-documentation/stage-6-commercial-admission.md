# Admisión de procesamiento por configuración del servidor

`PROCESSING_ADMISSION_MODE` acepta únicamente `development` o `commercial`. El valor predeterminado es `development`, declarado también en Compose y `.env.example`; un valor desconocido impide iniciar el servicio. Project captura la configuración al construirse: cambiar de modo requiere reiniciarlo. `NODE_ENV`, cabeceras, roles de workspace y cuerpos enviados por el cliente no seleccionan este modo.

En `commercial`, Project rechaza la **creación manual** de audio, análisis y render con HTTP 403 y `MANUAL_PROCESSING_NOT_ADMITTED`. El usuario debe tener sesión, CSRF y autorización válidos; ser owner o editor no exime del gate. Los identificadores inexistentes, entradas inválidas o recursos ajenos siguen sujetos a sus errores normales. El rechazo ocurre antes de crear intención, outbox, reserva técnica o solicitud al proveedor. Repetir un POST manual con su clave de idempotencia anterior también se rechaza: consultar el trabajo existente usa GET.

El nombre `commercial` designa esta política de admisión. No habilita cobros ni acredita lanzamiento comercial, seguridad de despliegue público, pagos, precios, selección LLM real o políticas de privacidad cumplidas. Billing mantiene los planes **de desarrollo** y la unidad de [segundos de material por etapa](stage-6-consumption.md).

## Inventario de entradas

Rutas relativas a `/v1`. El guard compartido de `DerivativesManager.beginValidated` cubre audio, recortes y ambos caminos de render; `AnalysisManager.begin` cubre todos los proveedores/selecciones de análisis. No depende del frontend ni de esconder botones.

| Entrada | development | commercial |
|---|---|---|
| POST `/uploads/{id}/processing`, audio | Admisión con cuotas técnicas existentes | 403, sin nueva intención/reserva |
| POST `/uploads/{id}/processing`, clip | Admisión; source/vertical/square/horizontal, framing y subtítulos aportados | 403 para todas las variantes |
| POST `/processing/{audioId}/analyses` | Preflight y admisión existentes de whisper_cpp/deepgram; selección none/llm | 403 antes del preflight, incluidos proveedores no configurados |
| POST `/analyses/{id}/renders` | Intervalo manual o propuesta persistida, con procedencia de transcripción | 403 para ambos caminos |
| POST `/edits/{id}/renders` | Revisión elegida; sin subtítulos, aportados o de transcripción; composición split | 403, incluidas revisiones antiguas y restauradas |
| POST `/uploads/{id}/pipelines` | Orquestación estricta y reserva Billing | Permitido sujeto a roles, proveedor disponible, cuotas y ledger; sin stages ni actor aportados por el navegador |
| Crear proyecto, cargar partes, confirmar upload | Cuotas técnicas y validación del objeto | Permitido como preparación de fuente; la inspección FFprobe sigue bajo cuotas técnicas, sin crear audio/ASR/render manual |
| Crear/actualizar/restaurar editor, comentarios, aprobaciones y grants | Permisos/versiones existentes | Permitido: metadatos y snapshots; crear un draft no ejecuta un render |
| GET estado/listados/historial/exportaciones/descargas | Permisos y firma privada existentes | Permitido, también para trabajos legacy |
| DELETE processing/analysis/pipeline | Cancelación autorizada, espera de limpieza/conciliación | Permitido para trabajos existentes |

Las entradas internas de Media y Analysis conservan autenticación de servicio y validaciones. El gateway no publica rutas internas de creación; no se aplica allí el guard manual porque reciben outboxes de pipelines admitidos y trabajos históricos. Las cuotas técnicas, límites de proveedor y recuperación siguen activos. Cambiar de modo no invalida intenciones históricas ya aceptadas: pueden finalizar o cancelarse, con su política original. No se aplica consumo retroactivo ni se reescriben artefactos/historial.

No existe una API pública para seleccionar el modo, asignar planes o fabricar movimientos de ledger. Para la admisión nueva permitida se conserva el flujo Project → Billing antes de audio, reserva atómica y conciliación por etapa. Una indisponibilidad no autoriza saltar el ledger. Un pipeline actual mantiene intervalo manual explícito y selección none; el gate no amplía ese contrato.

## Verificación reproducible

La suite `tests/admission-integration/http.test.mjs` levanta dos instancias HTTP reales de Project en secuencia (development y commercial), con sesión/CSRF y roles reales. Usa Pg, S3, inspección, extracción y render FFmpeg reales. Solo conduce explícitamente el temporizador de dispatch de Project para poder probar cancelación después del reinicio de modo. No sustituye autorización ni guard. Las cuentas verificadas, transcripción/propuesta terminadas y metadata legacy son fixtures SQL **explícitos**: no acreditan SMTP, ASR histórico ni LLM.

Compara todas las variantes manuales con owner y editor, cabeceras manipuladas, replay y cuenta ajena; comprueba que las denegaciones no alteren conteos de intenciones ni bytes reservados. Verifica historial/revisión antigua/restaurada, edición de metadatos, igualdad SHA-256 de descargas anteriores, consumo cero antes del primer pipeline y cancelación mediante workers reales de audio/análisis pendientes históricos.

El verificador de orquestación se ejecuta con `PROCESSING_ADMISSION_MODE=commercial`: sus estados de etapa/preflight son fixtures explícitos, pero autorización, transacciones, Billing, reservas y replay son reales. CI no descarga modelos. En la matriz sin ASR, un pipeline llega al preflight y devuelve `TRANSCRIPTION_NOT_CONFIGURED`; la aceptación local opt-in exige whisper.cpp configurado, orquesta una fuente de voz real y comprueba hash del modelo, descargas privadas, nueve movimientos de ledger y reserva cero.

Con imágenes construidas y dependencias preparadas, desde infraestructura:

```powershell
docker compose -f compose.yaml -f compose.business.yaml --profile app stop project
docker compose -f compose.yaml -f compose.business.yaml -f compose.business-tests.yaml --profile app run --no-deps --rm pipeline-verification
docker compose -f compose.yaml -f compose.business.yaml -f compose.business-tests.yaml --profile app run --no-deps --rm admission-verification
```

Para el ensayo local real, preparar el modelo ya verificado y arrancar Analysis con `compose.analysis-local.yaml`; después:

```powershell
docker compose -f compose.yaml -f compose.business.yaml -f compose.business-tests.yaml -f compose.analysis-local.yaml --profile app run --no-deps --rm -e ADMISSION_REAL_ASR=true admission-verification
docker compose -f compose.yaml -f compose.business.yaml -f compose.analysis-local.yaml --profile app up -d --no-build project
```

No ejecutar ambas matrices simultáneamente ni arrancar el dispatcher Project de aplicación durante el ensayo aislado. Conservar volúmenes y límites; los datos sintéticos persistentes no son datos de usuarios reales. El stack de desarrollo se restaura a su configuración explícita anterior al terminar.

Resultados propios:

| Comprobación | Resultado |
|---|---|
| Lint/build/OpenAPI/tipos, unitarias/HTTP | 29 aprobadas; runner 8.35 s |
| Matriz HTTP sin proveedores de IA configurados | 8 aprobadas; 39.94 s; preflight de pipeline devuelve 503, sin inferencia |
| Matriz HTTP con whisper.cpp local real | 8 aprobadas; 60.75 s; pipeline real 18.30 s, nueve movimientos de ledger, reserva cero |
| Recuperación/orquestación en commercial, fixtures de etapas explícitos | 8 aprobadas; 22.76 s; Pg/Identity/Workspace/Billing reales, SIGKILL del proceso propio y replay |
| Auditoría npm al construir imágenes | Cero vulnerabilidades reportadas |

Los conteos incluyen padres. La primera ejecución de la nueva matriz tuvo cinco tests aprobados y tres fallidos contando el padre: el guard sí devolvía 403, pero el filtro seguro convertía su código nuevo a `FORBIDDEN`. Se añadió exclusivamente `MANUAL_PROCESSING_NOT_ADMITTED:403` a su allowlist, se describió ErrorResponse en OpenAPI y se repitió la matriz completa con/sin ASR; ambas quedaron aprobadas. La última reconstrucción del verificador añadió solo las aserciones explícitas de modo commercial en la suite de orquestación, sin cambiar aplicación/contratos/modelo de la aceptación real. No se descargaron pesos nuevos.

El primer CI `80e2d45`, run 38837316717, aprobó quality y business, pero infrastructure falló antes de ejecutar tests porque PostgreSQL quedó unhealthy durante su primer inicio. Se encontraron ausentes `BILLING_OWNER_PASSWORD` y `BILLING_RUNTIME_PASSWORD` en el entorno del contenedor principal que ejecuta init-business.sh; el inicializador one-shot sí las recibía. Se añadieron ambas y se cambió pg_isready a TCP 127.0.0.1 para esperar al servidor definitivo, evitando la readiness del servidor temporal por socket durante initdb. CI añade un gate de primer inicio sin reinicios, seis bases y doce roles. La comprobación local usó proyecto/volumen nuevos aislados, seis bases/doce roles, cero reinicios y healthy; no reseteó datos del stack de trabajo.

CI final aprobada para `c9e57aa050a85c41ea0389dfb6070f8279765ff0`: [run 38837993047](https://github.com/yojhanHuanca/AutocliPper-final-pro/actions/runs/38837993047), quality/infrastructure/business success, incluido el bootstrap limpio. Logs consultados: 29 unitarias/HTTP, 34 infraestructura, 62 negocio, siete Analysis fixtures, ocho orquestación commercial y ocho admisión HTTP, cero fallos/omisiones. Los fixtures no acreditan inferencia; la matriz real local se documenta separadamente arriba. Stack de trabajo healthy con ASR local y development explícito, sin reiniciar su PostgreSQL ni borrar sus volúmenes; retirados únicamente los recursos del ensayo de bootstrap aislado.

Gates de lanzamiento restantes: administración/soporte separado, privacidad/purga/retención integral, restore, capacidad/observabilidad, aceptación externa Google/correo y preparación de entorno público; ver [backlog](launch-backlog.md).
