import type { Schema } from '../../../core/contracts/api-types';

export function captionCueIssues(cue: Schema<'SubtitleCueDto'>, start: number, end: number): { times: string; text: string } {
  return {
    times: !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start ||
      !Number.isFinite(cue.startSeconds) || !Number.isFinite(cue.endSeconds) || cue.startSeconds < start || cue.endSeconds > end || cue.endSeconds <= cue.startSeconds
      ? 'Los tiempos deben quedar dentro del intervalo del clip y terminar después de empezar.' : '',
    text: !cue.text.trim() || cue.text.length > 500 ? 'El texto debe tener entre 1 y 500 caracteres.'
      : /[<>\\{}]/u.test(cue.text) || [...cue.text].some(character => character !== '\n' && character.charCodeAt(0) < 32)
        ? 'Usa texto simple, sin etiquetas, llaves, barras invertidas ni caracteres de control.' : '',
  };
}

export function validateCaptionCues(cues: readonly Schema<'SubtitleCueDto'>[], start: number, end: number): Schema<'SubtitleCueDto'>[] {
  if (!cues.length || cues.length > 200) throw new Error('Añade entre 1 y 200 frases para los subtítulos.');
  return cues.map((cue, index) => {
    const issues = captionCueIssues(cue, start, end);
    if (issues.times) throw new Error(`Revisa los tiempos de la frase ${index + 1}: ${issues.times}`);
    if (issues.text) throw new Error(`La frase ${index + 1}: ${issues.text}`);
    return { startSeconds: cue.startSeconds, endSeconds: cue.endSeconds, text: cue.text };
  });
}
