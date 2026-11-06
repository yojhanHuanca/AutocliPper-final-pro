import type { PipelineSpec } from "@autoclipper/api-contracts";

export const PIPELINE_AUDIO_RESERVATION_BYTES = 134217728;
export const PIPELINE_RENDER_RESERVATION_BYTES = 68157440;

export function pipelineStorageReservation(spec: PipelineSpec) {
  const renders = spec.version === 1 ? 1 : spec.clipCount;
  return PIPELINE_AUDIO_RESERVATION_BYTES + PIPELINE_RENDER_RESERVATION_BYTES * renders;
}

export type ClipRenderState = "queued" | "running" | "succeeded" | "failed" | "cancelled";

/** Returns a terminal aggregate only when every requested child has settled. */
export function aggregateClipOutcome(requested: number, states: readonly ClipRenderState[]) {
  if (states.length !== requested || states.some(state => state === "queued" || state === "running")) return undefined;
  const succeeded = states.filter(state => state === "succeeded").length;
  if (succeeded === requested) return "succeeded" as const;
  if (succeeded > 0) return "partial_failed" as const;
  if (states.every(state => state === "cancelled")) return "cancelled" as const;
  return "failed" as const;
}
