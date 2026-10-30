import { ConsumptionApi } from "../data-access/consumption-api.service";
import { WorkspaceStore } from "../../workspaces/data-access/workspace.store";
import {
  ViewEncapsulation,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  signal,
} from "@angular/core";
import { DatePipe, DecimalPipe } from "@angular/common";
import type { Schema } from "../../../core/contracts/api-types";
import { SessionStore } from "../../../core/auth/session.store";
import { errorMessage } from "../../../core/http/api-error";
import { IconComponent } from "../../../shared/ui/icon/icon.component";
import {
  consumptionKindLabel,
  consumptionLedgerStageCount,
  consumptionLedgerEmptyStateMessage,
  consumptionPlanLabel,
  consumptionQuotaProgress,
  consumptionQuotaTotal,
  consumptionStageLabel,
  filterLedgerByStage,
  pipelineShortId,
  type ConsumptionStageFilter,
} from "../models/ledger-labels";

export function loadConsumptionSections(
  api: Pick<ConsumptionApi, "overview" | "ledger">,
  workspaceId: string,
) {
  return Promise.allSettled([
    api.overview(workspaceId),
    api.ledger(workspaceId),
  ]);
}

const consumptionStageFilters = [
  { id: "all", label: "Todas" },
  { id: "audio", label: "Audio" },
  { id: "analysis", label: "Transcripción" },
  { id: "render", label: "Renderizado" },
] as const;

@Component({
  encapsulation: ViewEncapsulation.None,
  selector: "ac-consumption",
  imports: [DatePipe, DecimalPipe, IconComponent],
  templateUrl: "./consumption.component.html",
  styleUrl: "./consumption.component.css",
})
export class ConsumptionComponent {
  readonly stageFilters = consumptionStageFilters;
  readonly stageLabel = consumptionStageLabel;
  readonly kindLabel = consumptionKindLabel;
  readonly ledgerEmptyStateMessage = consumptionLedgerEmptyStateMessage;
  readonly planLabel = consumptionPlanLabel;
  readonly quotaProgress = consumptionQuotaProgress;
  readonly quotaTotal = consumptionQuotaTotal;
  readonly shortPipelineId = pipelineShortId;
  readonly workspace = inject(WorkspaceStore);

  private readonly api = inject(ConsumptionApi);
  private readonly destroy = inject(DestroyRef);
  readonly session = inject(SessionStore);
  readonly consumption = signal<Schema<"ConsumptionDto"> | null>(null);
  readonly ledger = signal<Schema<"UsageLedgerEntryDto">[]>([]);
  readonly stageFilter = signal<ConsumptionStageFilter>("all");
  readonly visibleLedger = computed(() => {
    return filterLedgerByStage(this.ledger(), this.stageFilter());
  });
  readonly nextId = signal<string | null>(null);
  readonly overviewError = signal("");
  readonly ledgerError = signal("");
  readonly busy = signal(false);
  readonly loadingMore = signal(false);
  readonly accessDenied = signal(false);
  private generation = 0;
  private loadedWorkspaceId = "";
  private seenLedgerCursors = new Set<string>();
  stageCount(stage: ConsumptionStageFilter): number {
    return consumptionLedgerStageCount(this.ledger(), stage);
  }
  constructor() {
    effect(() => {
      const id = this.workspace.workspaceId();
      void this.load(id);
    });
    this.destroy.onDestroy(() => { this.generation += 1; });
  }
  async load(id = this.workspace.workspaceId()): Promise<void> {
    const generation = ++this.generation;
    this.loadingMore.set(false);
    this.accessDenied.set(false);
    if (id !== this.loadedWorkspaceId) {
      this.loadedWorkspaceId = id;
      this.seenLedgerCursors.clear();
      this.loadingMore.set(false);
      this.consumption.set(null);
      this.ledger.set([]);
      this.nextId.set(null);
    }
    this.overviewError.set("");
    this.ledgerError.set("");
    this.seenLedgerCursors.clear();
    if (!id) { this.busy.set(false); return; }
    this.busy.set(true);
    try {
      const [usage, page] = await loadConsumptionSections(this.api, id);
      if (generation === this.generation && id === this.workspace.workspaceId()) {
        if ([usage, page].some(result => result.status === "rejected" && this.denied(result.reason))) {
          this.clearDenied();
          return;
        }
        if (usage.status === "fulfilled") {
          if (usage.value.workspaceId === id) this.consumption.set(usage.value);
          else this.overviewError.set("El resumen no corresponde al espacio seleccionado.");
        } else this.overviewError.set(errorMessage(usage.reason));
        if (page.status === "fulfilled") {
          this.ledger.set(page.value.items);
          this.nextId.set(page.value.nextBeforeId);
        } else this.ledgerError.set(errorMessage(page.reason));
      }
    } finally {
      if (generation === this.generation) this.busy.set(false);
    }
  }
  async loadMore(): Promise<void> {
    if (!this.nextId() || this.busy() || this.loadingMore()) return;
    const generation = this.generation;
    const id = this.workspace.workspaceId();
    if (!id || id !== this.loadedWorkspaceId) return;
    const cursor = this.nextId();
    this.seenLedgerCursors ??= new Set<string>();
    this.loadingMore.set(true);
    this.ledgerError.set("");
    try {
      const page = await this.api.ledger(id, cursor);
      if (generation === this.generation && id === this.workspace.workspaceId()) {
        const knownIds = new Set(this.ledger().map((item) => item.id));
        const freshItems = page.items.filter((item) => {
          if (knownIds.has(item.id)) return false;
          knownIds.add(item.id);
          return true;
        });
        this.ledger.update((items) => [...items, ...freshItems]);
        if (cursor) this.seenLedgerCursors.add(cursor);
        if (page.nextBeforeId && this.seenLedgerCursors.has(page.nextBeforeId)) {
          this.nextId.set(null);
          this.ledgerError.set("La consulta devolvió un cursor repetido. Se detuvo la paginación para evitar repetir movimientos.");
        } else {
          this.nextId.set(page.nextBeforeId);
        }
      }
    } catch (error) {
      if (generation === this.generation && id === this.workspace.workspaceId()) {
        if (this.denied(error)) this.clearDenied();
        else this.ledgerError.set(errorMessage(error));
      }
    } finally {
      if (generation === this.generation) this.loadingMore.set(false);
    }
  }
  private denied(error: unknown): boolean {
    return typeof error === "object" && error !== null && "status" in error && [401, 403, 404].includes(Number(error.status));
  }
  private clearDenied(): void {
    this.consumption.set(null);
    this.ledger.set([]);
    this.nextId.set(null);
    this.accessDenied.set(true);
    this.overviewError.set("");
    this.ledgerError.set("");
  }
}
