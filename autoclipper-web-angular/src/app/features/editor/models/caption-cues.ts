import type { Schema } from '../../../core/contracts/api-types';

export function validateCaptionCues(cues: readonly Schema<'SubtitleCueDto'>[], start: number, end: number): Schema<'SubtitleCueDto'>[] {
  if (!cues.length || cues.length > 200) throw new Error('Añade entre 1 y 200 frases para los subtítulos.');
  return cues.map((cue, index) => {
    if (!Number.isFinite(cue.startSeconds) || !Number.isFinite(cue.endSeconds) || cue.startSeconds < start || cue.endSeconds > end || cue.endSeconds <= cue.startSeconds) {
      throw new Error(`Revisa los tiempos de la frase ${index + 1}: deben quedar dentro del intervalo del clip y terminar después de empezar.`);
    }
    if (!cue.text.trim() || cue.text.length > 500) throw new Error(`La frase ${index + 1} debe tener entre 1 y 500 caracteres.`);
    return { startSeconds: cue.startSeconds, endSeconds: cue.endSeconds, text: cue.text };
  });
}
