export const AUTH_STORY_ACCENTS = ["#2354BB", "#B83381", "#7543B0", "#3B68C0", "#9A397D"] as const;

export const AUTH_STORY_SCENES = [
  { label: "Sube tu grabación", micro: "PASO 1 · MATERIAL DE EJEMPLO", cue: "Un video local corto, listo para editar.", time: "00:15", playhead: "00:15", file: "episodio-demo.mp4" },
  { label: "Transcribe y busca", micro: "PASO 2 · TEXTO SINCRONIZADO", cue: "Sigue cada palabra en su momento del video.", time: "01:12", playhead: "01:12", file: "Transcripción · español" },
  { label: "Elige el momento", micro: "PASO 3 · SELECCIÓN MANUAL", cue: "Marca a mano el inicio y el final de la idea.", time: "02:05", playhead: "02:05", file: "Fragmento seleccionado" },
  { label: "Ajusta el encuadre", micro: "PASO 4 · FORMATO DEL CLIP", cue: "Reencuadra el mismo material en vertical.", time: "9:16", playhead: "03:04", file: "Encuadre de ejemplo" },
  { label: "Exporta tu clip", micro: "PASO 5 · ARCHIVO DE EJEMPLO", cue: "Prepara una descarga privada en MP4 y SRT.", time: "MP4 · SRT", playhead: "04:06", file: "Exportación de ejemplo" },
] as const;

type Scheduler = (tick: () => void, milliseconds: number) => () => void;

export function createAuthStoryCycle(
  getIndex: () => number,
  setIndex: (index: number) => void,
  schedule: Scheduler = (tick, milliseconds) => {
    const timer = globalThis.setInterval(tick, milliseconds);
    return () => globalThis.clearInterval(timer);
  },
) {
  let cancel: (() => void) | undefined;
  let alive = true;
  const stop = () => {
    cancel?.();
    cancel = undefined;
  };

  return {
    configure(paused: boolean, reducedMotion: boolean) {
      if (reducedMotion) setIndex(0);
      if (!alive || paused || reducedMotion) {
        stop();
        return;
      }
      if (!cancel) {
        cancel = schedule(() => {
          if (alive) setIndex((getIndex() + 1) % AUTH_STORY_SCENES.length);
        }, 3000);
      }
    },
    destroy() {
      alive = false;
      stop();
    },
  };
}
