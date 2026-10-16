# Imágenes y movimiento

La imagen de la creadora se generó con la herramienta integrada **imagegen**, sin API externa configurada ni compra de assets. Persona ficticia y composición ilustrativa, identificadas en landing/autenticación. Se inspeccionó el resultado antes de usarlo. No se reutilizaron fotografías de las referencias como datos de clientes.

Archivos finales del proyecto:

- `public/images/creator-480.webp` — 480×320, 18.2 KB; composiciones pequeñas.
- `public/images/creator-960.webp` — 960×640, 47.2 KB; escenas intermedias.
- `public/images/creator-1440.webp` — 1440×960, 83.6 KB; hero/autenticación.

Se convirtieron a WebP con Pillow del runtime disponible, sin alterar el contenido de la imagen. El hero usa `srcset`/`sizes` y prioridad de carga; imágenes bajo el primer pliegue usan lazy loading y dimensiones explícitas para evitar saltos de layout. Tipografía de sistema y Georgia, sin fuentes remotas. Iconos e ilustraciones de estados vacíos son SVG/CSS propios del frontend.

Prompt final utilizado:

> Use case: photorealistic-natural. Asset type: cinematic editorial photography for the AutoClipper video editing website, an illustrative fictional creator, not a customer testimonial. Primary request: a very polished realistic photograph of a young adult Latin American female podcast creator talking thoughtfully into a professional black broadcast microphone in a warm contemporary recording studio. Horizontal 3:2 composition, woman centrally framed waist up, hands naturally gesturing, lots of photographic detail, soft window light and subtle warm practical light, pale concrete and walnut textures, very subtle muted red detail on clothing, subdued almost monochrome warm neutral color grading. Camera 50mm, natural skin texture, shallow depth of field. No text, no logos, no watermarks, no interface, no collages. Must look like beautiful cinematic still, not stock business photography.

Movimiento: transform/opacity en tijera y clip; cambios de escena por visibilidad, sin scroll secuestrado ni contadores de negocio ficticios. Existe pausa explícita y desactivación por movimiento reducido.

## Logo provisional aprobado: v4

Fuente: `../autoclipper-project-documentation/design-references/autoclipper-logo-concept-v4.png`, elegida expresamente por el usuario. No se usan v1–v3. El original se copió sin modificar a `assets/source/autoclipper-logo-v4-original.png`: RGB, 2170×725, 1 463 056 bytes, SHA-256 `dee4b550d57e3678c0012eeaed023d6f290ec81080e798960099549ea21afca9`.

Entrega web: `public/images/autoclipper-logo-v4.webp`, 1536×513 (altura proporcional redondeada), 103 294 bytes. Redimensionado con Lanczos y WebP calidad 94; aproximadamente 93 % menos bytes que el PNG maestro. Conserva fondo blanco; **no es transparente ni vectorial**. El PNG original queda fuera de los assets públicos del build.

`shared/ui/brand` reutiliza esta misma imagen en navegación pública/login, footer, shell de usuario y estructura administrativa. La versión completa con subtítulo aparece en el cierre de la landing cuando hay espacio suficiente. En cabeceras pequeñas se presentan recortes **solo por CSS** del emblema y wordmark, sin redibujar, estirar ni generar otra identidad: emblema `(0,0,670,725)` y wordmark `(650,250,1490,270)` en coordenadas del original. Así el subtítulo se omite en compacto, en vez de comprimirlo hasta hacerlo ilegible. El mismo recurso se reutiliza desde caché.
