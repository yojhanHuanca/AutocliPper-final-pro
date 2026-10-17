export function consumptionStageLabel(stage: string): string {
  return ({ audio: 'Audio', analysis: 'Transcripción', render: 'Renderizado' } as Record<string, string>)[stage] ?? stage;
}

export function consumptionKindLabel(kind: string): string {
  return ({ reserve: 'Reserva', consume: 'Consumo', release: 'Liberación' } as Record<string, string>)[kind] ?? kind;
}

export function pipelineShortId(id: string): string {
  return id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

export function consumptionPlanLabel(
  plan: { kind: string; label: string } | null | undefined,
): string {
  if (!plan) return "Sin asignación de desarrollo";
  return plan.kind === "development"
    ? "Asignación local de desarrollo"
    : plan.label;
}

export function consumptionQuotaTotal(usage: {
  consumedSeconds: number;
  reservedSeconds: number;
  availableSeconds: number;
}): number {
  return Math.max(
    0,
    usage.consumedSeconds + usage.reservedSeconds + usage.availableSeconds,
  );
}

export function consumptionQuotaProgress(usage: {
  consumedSeconds: number;
  reservedSeconds: number;
  availableSeconds: number;
}): number {
  const total = consumptionQuotaTotal(usage);
  if (!total) return 0;
  const accounted = usage.consumedSeconds + usage.reservedSeconds;
  return Math.max(0, Math.min(100, (accounted / total) * 100));
}
