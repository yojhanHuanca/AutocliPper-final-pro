import type { Schema } from '../../../core/contracts/api-types';

type Cue = Schema<'SubtitleCueDto'>;
export type IndexedCaptionCue = Cue & { index: number };

/** Geometry is clipped to the saved/form clip; timestamps themselves are never rewritten. */
export function layoutCaptionCues(cues: readonly IndexedCaptionCue[], start: number, end: number) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  const visible = cues.filter(cue => Number.isFinite(cue.startSeconds) && Number.isFinite(cue.endSeconds) &&
    cue.endSeconds > cue.startSeconds && cue.endSeconds > start && cue.startSeconds < end)
    .map(cue => ({ ...cue, from: Math.max(start, cue.startSeconds), to: Math.min(end, cue.endSeconds) }))
    .sort((a, b) => a.from - b.from || a.index - b.index);
  const rowEnds: number[] = [];
  return visible.map(cue => {
    let row = rowEnds.findIndex(rowEnd => rowEnd <= cue.from);
    if (row < 0) row = rowEnds.length;
    rowEnds[row] = cue.to;
    const left = (cue.from - start) / (end - start) * 100;
    return { ...cue, row, left, width: Math.min(100 - left, (cue.to - cue.from) / (end - start) * 100) };
  });
}

/** Makes a local user-authored copy. It does not mutate the original transcript. */
export function copyTranscriptCues(segments: readonly Schema<'TranscriptSegmentDto'>[], start: number, end: number): Cue[] {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start)
    throw new Error('Corrige el intervalo del clip antes de copiar la transcripción.');
  if (segments.some(cue => !Number.isFinite(cue.startSeconds) || !Number.isFinite(cue.endSeconds) || cue.startSeconds < 0 || cue.endSeconds <= cue.startSeconds))
    throw new Error('La transcripción contiene tiempos inválidos. Vuelve a consultarla antes de copiarla.');
  const cues = segments.filter(cue => cue.endSeconds > start && cue.startSeconds < end)
    .map(cue => ({ startSeconds: Math.max(start, cue.startSeconds), endSeconds: Math.min(end, cue.endSeconds), text: cue.text }));
  if (!cues.length) throw new Error('No hay frases de la transcripción dentro de este intervalo.');
  if (cues.length > 200) throw new Error('El intervalo contiene más de 200 frases. Elige un intervalo más corto antes de copiarlo.');
  return cues;
}
