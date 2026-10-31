export function consumptionStageLabel(stage: string): string {
  return ({ audio: 'Audio', analysis: 'Transcripción', render: 'Renderizado' } as Record<string, string>)[stage] ?? stage;
}

export function consumptionKindLabel(kind: string): string {
  return ({ reserve: 'Reserva', consume: 'Consumo', release: 'Liberación' } as Record<string, string>)[kind] ?? kind;
}

export type ConsumptionStageFilter = 'all' | 'audio' | 'analysis' | 'render';
export type ConsumptionKindFilter = 'all' | 'reserve' | 'consume' | 'release';

export function filterLedgerByStage<T extends { stage: string }>(
  entries: readonly T[],
  stage: ConsumptionStageFilter,
): T[] {
  return stage === 'all' ? [...entries] : entries.filter((entry) => entry.stage === stage);
}

export function filterLedger<T extends { stage: string; kind: string }>(
  entries: readonly T[],
  stage: ConsumptionStageFilter,
  kind: ConsumptionKindFilter,
): T[] {
  return entries.filter((entry) =>
    (stage === 'all' || entry.stage === stage) &&
    (kind === 'all' || entry.kind === kind),
  );
}

export function consumptionLedgerStageCount(
  entries: readonly { stage: string }[],
  stage: ConsumptionStageFilter,
): number {
  return stage === 'all' ? entries.length : entries.filter((entry) => entry.stage === stage).length;
}

export function consumptionLedgerKindCount(
  entries: readonly { kind: string }[],
  kind: ConsumptionKindFilter,
): number {
  return kind === 'all' ? entries.length : entries.filter((entry) => entry.kind === kind).length;
}

export function consumptionLedgerEmptyStateMessage(
  busy: boolean,
  accessDenied: boolean,
  hasError: boolean,
  hasWorkspace = true,
  workspacesLoaded = true,
  hasAvailableWorkspace = false,
): string | null {
  if (!hasWorkspace) {
    if (!workspacesLoaded) return 'Consultando espacios…';
    return hasAvailableWorkspace
      ? 'Selecciona un espacio de trabajo en la barra lateral para consultar sus movimientos.'
      : 'No hay espacios disponibles para consultar.';
  }
  if (busy) return 'Consultando movimientos…';
  if (accessDenied) return 'Sin acceso confirmado a los movimientos.';
  if (hasError) return null;
  return 'No hay movimientos registrados en este espacio.';
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
  plan?: { kind: string; processingSecondsPerMonth: number } | null;
}): number {
  if (usage.plan?.kind === 'development') {
    return Math.max(0, usage.plan.processingSecondsPerMonth);
  }
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
