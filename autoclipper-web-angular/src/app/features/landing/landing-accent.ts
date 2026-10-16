export const LANDING_ACCENTS = [
  { color: '#2354BB', hover: '#183E90', tint: '#EDF2FC' },
  { color: '#A32359', hover: '#841B47', tint: '#FCEFF5' },
  { color: '#6E3CA3', hover: '#542C80', tint: '#F4EFFB' },
] as const;

/** Owns one timer; pausing preserves the current accent. */
export function createAccentCycle(
  update: (index: number) => void,
  schedule: (tick: () => void, milliseconds: number) => () => void,
) {
  let index = 0;
  let cancel: (() => void) | undefined;
  let destroyed = false;
  return {
    configure(paused: boolean, reduced: boolean) {
      cancel?.();
      cancel = undefined;
      if (destroyed) return;
      if (reduced) { index = 0; update(index); }
      if (!paused && !reduced) cancel = schedule(() => {
        index = (index + 1) % LANDING_ACCENTS.length;
        update(index);
      }, 3000);
    },
    destroy() { destroyed = true; cancel?.(); cancel = undefined; },
  };
}
