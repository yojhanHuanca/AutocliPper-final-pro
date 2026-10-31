export const LANDING_ACCENTS = [
  { color: '#315EFF', hover: '#2347D0', tint: '#E4EAFF' },
  { color: '#C72670', hover: '#A61D5B', tint: '#FBE1ED' },
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
