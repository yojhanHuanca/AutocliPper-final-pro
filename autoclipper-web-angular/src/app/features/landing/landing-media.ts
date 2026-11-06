/**
 * Videos de la landing.
 *
 * Coloca tus archivos en `public/videos/` y escribe aquí su ruta (por ejemplo
 * `videos/hero.mp4`). Mientras `src` sea `null` se muestra el `poster`.
 *
 * Usa solo material con permiso: tus propias grabaciones, creadores que te
 * autorizaron por escrito o stock con licencia. Escribe el crédito en `credit`
 * para que aparezca en el pie de página.
 *
 * Formato recomendado: MP4 H.264, sin audio, 720p, menos de 3 MB por video.
 */
export interface LandingVideo {
  readonly src: string | null;
  readonly poster: string;
  readonly credit: string | null;
}

export const HERO_VIDEO: LandingVideo = {
  src: null,
  poster: "images/streamer-studio-v1.webp",
  credit: null,
};

export const TRANSFORM_VIDEO: LandingVideo = {
  src: null,
  poster: "images/streamer-studio-v1.webp",
  credit: null,
};

/** Nueve clips verticales para la pared de resultados. */
export const CLIP_VIDEOS: readonly LandingVideo[] = [
  { src: null, poster: "images/creator-portrait-v1.webp", credit: null },
  { src: null, poster: "images/streamer-studio-v1.webp", credit: null },
  { src: null, poster: "images/creator-960.webp", credit: null },
  { src: null, poster: "images/streamer-studio-v1.webp", credit: null },
  { src: null, poster: "images/creator-portrait-v1.webp", credit: null },
  { src: null, poster: "images/creator-960.webp", credit: null },
  { src: null, poster: "images/creator-portrait-v1.webp", credit: null },
  { src: null, poster: "images/streamer-studio-v1.webp", credit: null },
  { src: null, poster: "images/creator-960.webp", credit: null },
];
