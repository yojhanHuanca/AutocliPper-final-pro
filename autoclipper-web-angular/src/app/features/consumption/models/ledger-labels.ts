export function consumptionStageLabel(stage: string): string {
  return ({ audio: 'Audio', analysis: 'Transcripción', render: 'Renderizado' } as Record<string, string>)[stage] ?? stage;
}

export function consumptionKindLabel(kind: string): string {
  return ({ reserve: 'Reserva', consume: 'Consumo', release: 'Liberación' } as Record<string, string>)[kind] ?? kind;
}

export function pipelineShortId(id: string): string {
  return id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}
