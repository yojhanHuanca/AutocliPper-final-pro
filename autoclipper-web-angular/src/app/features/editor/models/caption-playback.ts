import type { Schema } from '../../../core/contracts/api-types';
import type { IndexedCaptionCue } from './caption-timeline';

// A rendered clip starts at zero; persisted cues retain absolute source times.
export function playbackWindow(spec: Schema<'ProcessingSpecDto'> | undefined, duration: number | null) {
  const start = spec?.startSeconds;
  const end = spec?.endSeconds;
  if (spec?.kind !== 'clip' || typeof start !== 'number' || typeof end !== 'number' ||
      !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end - start < 0.1 || end - start > 120 ||
      duration === null || !Number.isFinite(duration) || duration <= 0 || Math.abs(duration - (end - start)) > 0.25) return null;
  return { start, end, duration: Math.min(duration, end - start) };
}

export function renderedCaptionCues(entries: IndexedCaptionCue[], spec: Schema<'ProcessingSpecDto'> | undefined, duration: number | null) {
  const window = playbackWindow(spec, duration);
  if (!window) return [];
  const rendered = spec?.subtitles?.cues ?? [];
  return entries.flatMap(cue => {
    const from = Math.max(window.start, cue.startSeconds);
    const to = Math.min(window.end, window.start + window.duration, cue.endSeconds);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || !rendered.some(saved =>
      saved.text === cue.text && Math.abs(Math.max(window.start, saved.startSeconds) - from) < 0.001 &&
      Math.abs(Math.min(window.end, window.start + window.duration, saved.endSeconds) - to) < 0.001)) return [];
    return [{ index: cue.index, from: from - window.start, to: to - window.start }];
  });
}
