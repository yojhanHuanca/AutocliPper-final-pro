import { ConsumptionApi } from "../data-access/consumption-api.service";
import { WorkspaceStore } from "../../workspaces/data-access/workspace.store";
import {
  ViewEncapsulation,
  Component,
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
  consumptionPlanLabel,
  consumptionQuotaProgress,
  consumptionQuotaTotal,
  consumptionStageLabel,
  pipelineShortId,
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

@Component({
  encapsulation: ViewEncapsulation.None,
  selector: "ac-consumption",
  imports: [DatePipe, DecimalPipe, IconComponent],
  templateUrl: "./consumption.component.html",
  styleUrl: "./consumption.component.css",
})
export class ConsumptionComponent {
  readonly stageLabel = consumptionStageLabel;
  readonly kindLabel = consumptionKindLabel;
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
  readonly nextId = signal<string | null>(null);
  readonly overviewError = signal("");
  readonly ledgerError = signal("");
  readonly busy = signal(false);
  readonly loadingMore = signal(false);
  readonly accessDenied = signal(false);
  private generation = 0;
  private loadedWorkspaceId = "";
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
      this.loadingMore.set(false);
      this.consumption.set(null);
      this.ledger.set([]);
      this.nextId.set(null);
    }
    this.overviewError.set("");
    this.ledgerError.set("");
    if (!id) { this.busy.set(false); return; }
    this.busy.set(true);
    try {
      const [usage, page] = await loadConsumptionSections(this.api, id);
      if (generation === this.generation && id === this.workspace.workspaceId()) {
        if ([usage, page].some(result => result.status === "rejected" && this.denied(result.reason))) {
          this.clearDenied();
          return;
        }
        if (usage.status === "fulfilled") this.consumption.set(usage.value);
        else this.overviewError.set(errorMessage(usage.reason));
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
    this.loadingMore.set(true);
    this.ledgerError.set("");
    try {
      const page = await this.api.ledger(id, this.nextId());
      if (generation === this.generation && id === this.workspace.workspaceId()) {
        this.ledger.update((items) => [...items, ...page.items]);
        this.nextId.set(page.nextBeforeId);
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
    this.overviewError.set("El servidor no confirmó acceso al consumo de este espacio. Actualiza tus espacios o vuelve a iniciar sesión.");
    this.ledgerError.set("");
  }
}
