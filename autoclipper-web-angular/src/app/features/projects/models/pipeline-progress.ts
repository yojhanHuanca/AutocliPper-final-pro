export type PipelineProgressStatus =
  | "queued"
  | "audio"
  | "analysis"
  | "render"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "stopping";

export type PipelineStageState = "pending" | "current" | "complete" | "failed" | "cancelled";

const stages = [
  { id: "queued", label: "En cola" },
  { id: "audio", label: "Preparar audio" },
  { id: "analysis", label: "Transcribir" },
  { id: "render", label: "Crear clip" },
] as const;

export function pipelineProgress(
  status: PipelineProgressStatus,
  events: readonly { status: string }[] = [],
): { id: string; label: string; state: PipelineStageState }[] {
  if (status === "succeeded")
    return stages.map((stage) => ({ ...stage, state: "complete" }));

  const latestObservedStage = events.reduce((latest, event) => {
    const index = stages.findIndex((stage) => stage.id === event.status);
    return index >= 0 ? index : latest;
  }, -1);
  const activeIndex = Math.max(
    0,
    ({ queued: 0, audio: 1, analysis: 2, render: 3 } as Record<string, number>)[status]
      ?? latestObservedStage,
  );

  return stages.map((stage, index) => {
    if (status === "failed" && index === activeIndex)
      return { ...stage, state: "failed" };
    if (status === "cancelled" && index === activeIndex)
      return { ...stage, state: "cancelled" };
    if (index < activeIndex) return { ...stage, state: "complete" };
    if (index === activeIndex && status !== "failed" && status !== "cancelled")
      return { ...stage, state: "current" };
    return { ...stage, state: "pending" };
  });
}
