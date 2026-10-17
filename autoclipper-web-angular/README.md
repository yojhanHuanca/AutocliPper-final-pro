# AutoClipper · Frontend Angular

Primera entrega ejecutable del estudio: landing con fotografía ilustrativa y movimiento conectado, cuenta, espacios, proyectos, carga privada, pipeline local, editor versionado, revisiones y consumo real. Fondo **blanco** y acento **Cobalto** aprobados: principal `#2354BB`, hover `#183E90`, superficie de acento `#EDF2FC`, texto sobre acento `#FFFFFF`. Se conserva exactamente la variante azul que se mostró en el selector; el selector de propuestas ya fue retirado. No hay datos de negocio simulados ni fallback a mocks.

Logo provisional **v4** aprobado integrado en sitio/acceso y shells, con el PNG maestro conservado y WebP de 103 KB. La variante compacta omite el subtítulo mediante recorte CSS del mismo original, preservando proporciones; no es transparente ni vectorial. Ver [procedencia y derivados](docs/assets.md).

## Arranque

Angular/CLI **22.2.3**, TypeScript **6.0.3**, Node **24.21.0** y npm **11.12.1**. No cambiar globalmente Node ni tocar los servicios del backend para ejecutar el frontend. La [compatibilidad oficial de Angular](https://angular.dev/reference/versions) y los engines del paquete requieren un Node soportado; el Node 25 observado en el equipo no se utiliza para verificar builds.

Desde esta carpeta, con Node 24 activo:

```powershell
npm ci
npm start
```

Si no quieres cambiar la versión global:

```powershell
npm exec --yes --package=node@24.21.0 -- node node_modules/@angular/cli/bin/ng.js serve --host localhost --port 4200
```

Abrir [localhost:4200](http://localhost:4200). `public/config.json` contiene solo la URL **pública** del gateway, por defecto `http://localhost:3000/v1`. Se valida antes de iniciar; un fallo de configuración muestra un mensaje recuperable. Usar `localhost` para frontend y API, como exigen cookies/Origin del backend. No incluir credenciales ni variables internas en el frontend.

## Recorridos

| Ruta | Alcance |
|---|---|
| `/` | Landing; fotografía y escenas identificadas como ilustrativas; pausa y movimiento reducido |
| `/login`, `/register`, `/verify`, `/forgot`, `/reset` | Autenticación real; factor TOTP/recuperación opcional al entrar; enlaces de correo compatibles |
| `/app` | Sesión requerida, selector de espacios reales y alta de primer espacio personal |
| `/app/projects` | Lista/búsqueda y creación; máximo actual 100 proyectos |
| `/app/projects/:id` | PUT firmado hasta 100 MiB, inspección, intervalo manual, pipeline, descargas y creación de borrador |
| `/app/edits/:id` | Formato/encuadre, subtítulos, split screen, CAS/ETag, historial/restore, comentarios, revisión/aprobación y exportación |
| `/app/consumption` | Plan de desarrollo y ledger paginado real; segundos de material por etapa |
| `/app/settings` | Perfil y zona horaria, sesiones, 2FA/códigos y registro de solicitudes de privacidad |
| `/design`, `/design/projects`, `/design/editor`, `/design/settings` | Estructuras públicas sin datos de cuenta, mutaciones ni llamadas de negocio |
| `/design/admin` | Estructura administrativa prevista con layout propio; no concede privilegios globales |

La carga/pipeline puede retomarse mediante su ID autorizado. Solo IDs no secretos se conservan en `sessionStorage`, separados por usuario/proyecto. El contrato actual no ofrece listado de cargas/pipelines por proyecto, por lo que no se inventa. El primer envío desde esta interfaz es PUT; multipart/reanudación por partes requieren otra entrega de UI.

El editor reproduce **renders reales de una revisión**, mediante URLs temporales autorizadas. No reproduce una simulación del resultado ni promete equivalencia de preview interactivo con FFmpeg. Los cambios sin guardar bloquean exportación y aprobación. Un 412 conserva el formulario; recargar/descartar es una acción explícita. La pantalla dividida necesita el ID de una segunda carga autorizada. Los subtítulos aportados se editan por frase, con inicio/fin y texto; la transcripción usa el análisis autorizado vinculado al borrador.

Administración global, biblioteca global, calendario, marca/mezcla, selección automática real, importación social, traducción, publicación y pagos no se anuncian como disponibles. Google no está habilitado en esta UI. La ejecución integral de privacidad sigue pendiente, aunque pueden registrarse solicitudes. Las APIs administrativas del backend están evolucionando en paralelo y no se presentan como interfaz terminada.

## Verificación

```powershell
npm ci --prefix scripts/contracts
npm run contracts
npm run typecheck
npm test
npm run build
```

El generador usa su propio lockfile con TypeScript 5.9.3 porque `openapi-typescript@7.13.0` exige TS 5; Angular usa TS 6.0.3. No se fuerza una combinación incompatible. La generación predeterminada lee `contracts/public-gateway.snapshot.json`, una copia del contrato público con SHA-256, para que un checkout del frontend sea reproducible aunque existan cambios paralelos sin publicar. `npm run contracts:check` compara con el contrato central; `npm run contracts:sync` actualiza explícitamente snapshot y tipos tras revisar cambios. No copia implementación ni modifica backend. Los tipos administrativos preliminares no equivalen a una UI administrativa implementada.

Para la aceptación **opcional**, coordinada con quien mantiene el stack local:

```powershell
$env:FRONTEND_LIVE_ACCEPTANCE='true'
npm run test:live
```

Esta suite requiere servicios ya saludables, Mailpit local, FFmpeg en PATH y whisper.cpp configurado. Crea cuentas `example.test`, un espacio y material de prueba identificados; no envía correo externo, no arranca/detiene servicios, no modifica SQL ni cambia infraestructura. Deja el proyecto QA para revisión. Usa la grabación sintética declarada en `../autoclipper-backend-microservices/tests/fixtures/README.md`; la inferencia y los artefactos son reales. No ejecutar durante migraciones o aceptación de otro chat.

Resultado observado: **build de producción y typecheck aprobados; 23 unitarias/arquitectura y 7 de aceptación local aprobadas** (estas últimas incluyen el padre; 6 subcasos). Evidencia, límites y revisión responsive en [docs/verification.md](docs/verification.md).

## Estructura y diseño

Ver [arquitectura y límites de dependencias](docs/architecture.md), [decisiones de esta entrega](docs/design.md) y [procedencia de imágenes y prompt](docs/assets.md). El checkpoint incluye exclusivamente `autoclipper-web-angular`; no incorpora cambios paralelos de backend, infraestructura ni documentación central. Backend/infra se conservan bajo responsabilidad del chat paralelo.

La animación anterior se inspeccionó ejecutando su componente original en solo lectura. El visor opcional `node scripts/preview-legacy.mjs` genera todo dentro de `.local/legacy-preview` y sirve `http://localhost:4179`; no participa del build ni requiere copiar el proyecto anterior.

Solo en la landing, los acentos azul → rosado → morado cambian cada 3 segundos con transición de 900 ms. La pausa conserva el color actual y movimiento reducido mantiene Cobalto sin temporizador; el fondo blanco y los paneles/editor conservan sus tokens aprobados.

El editor protege cambios de composición/subtítulos al navegar, recargar el formulario o cerrar la pestaña (el aviso de cierre depende del navegador). Si una sección secundaria falla al cargar, el borrador sigue disponible, aparece un aviso de carga parcial y se pueden reintentar las consultas. Los errores al pedir más revisiones/comentarios conservan la página ya cargada. En proyectos, cambiar IDs invalida estados y respuestas anteriores. Una transcripción solo se vincula automáticamente si el pipeline fue creado aquí para esa carga; consultar un pipeline arbitrario por ID no prueba su procedencia. Se admiten archivos con MIME vacío únicamente por extensión MP4/WebM/MOV/MKV; la inspección del servidor sigue siendo obligatoria.

En ajustes de perfil se comprueba la zona horaria con Intl antes de guardar y se puede descartar el formulario. El URI de alta 2FA muestra el plazo recibido de la API; se oculta al vencer o cambiar de sección. Códigos y pruebas sensibles se limpian al salir de Seguridad. El ledger muestra nombres en español y conserva el ID completo de pipeline en el atributo de detalle.

Si al entrar en una ruta protegida el servidor responde que la sesión venció, se va al login conservando el destino. Si la API no está disponible, se conserva el mismo destino y se muestra el aviso de conexión; no se confunde con un rechazo de credenciales.

La ruta solicitada también se conserva si falla la carga del selector de espacios luego de restaurar la sesión.

Los ajustes cargan perfil, 2FA, privacidad y sesiones por separado; si uno falla, se conservan los demás datos y se indica qué consulta no respondió.
