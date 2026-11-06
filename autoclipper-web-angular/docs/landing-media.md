# Videos de la landing

La landing (`src/app/features/landing`) tiene 11 espacios de video: el hero, la sección "La transformación" y 9 clips verticales en "Resultados". Mientras no haya un video, cada espacio muestra su imagen `poster`.

## Cómo poner tus videos

1. Crea la carpeta `public/videos/` y copia ahí los archivos (por ejemplo `hero.mp4`, `clip-01.mp4`).
2. Abre `src/app/features/landing/landing-media.ts` y cambia `src: null` por la ruta, por ejemplo `src: "videos/hero.mp4"`.
3. Escribe el crédito en `credit` (por ejemplo `"Clip cedido por @creador"`).

| Espacio | Formato | Recomendación |
|---|---|---|
| Hero / transformación | Horizontal 16:9 | 720p, 8–15 s en loop, menos de 3 MB |
| Clips de resultados | Vertical 9:16 | 720×1280, 10–20 s, menos de 2 MB |

Exporta en MP4 H.264, sin audio (`ffmpeg -i in.mp4 -an -vf scale=-2:720 -c:v libx264 -crf 26 -preset slow -movflags +faststart out.mp4`).

## Derechos

Usa solo material que puedas publicar: tus propias grabaciones, clips de creadores que te dieron permiso por escrito o stock con licencia (Pexels, Mixkit, Coverr). Fragmentos de directos de otros streamers sin autorización pueden recibir reclamos de copyright y dan a entender que ellos respaldan AutoClipper.

## Animaciones

`landing-motion.ts` contiene todas las animaciones sin librerías externas: intro de corte 9:16 (una vez por sesión, con botón "Saltar"), letras del hero, parallax por mouse, secciones fijas ligadas al scroll, tarjetas apiladas, marquee que acelera con el scroll, pared de clips con parallax, botón magnético y footer revelado. Con `prefers-reduced-motion` se omiten intro, parallax y marquee.
