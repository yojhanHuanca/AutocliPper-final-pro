/** Tamaño máximo de un video subido: 30 GiB, igual que OpusClip (10 h en 1080p). */
export const MAX_UPLOAD_BYTES = 32212254720;
/** Duración máxima de un video: 10 horas. */
export const MAX_SOURCE_SECONDS = 36000;
/** Audio WAV 16 kHz mono de 10 h (~1.07 GiB) con margen. */
export const MAX_AUDIO_BYTES = 1342177280;
/** Segmentos de transcripción admitidos para 10 h de habla. */
export const MAX_TRANSCRIPT_SEGMENTS = 100000;
