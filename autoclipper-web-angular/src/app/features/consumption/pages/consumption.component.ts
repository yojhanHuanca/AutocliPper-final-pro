import { ConsumptionApi } from "../data-access/consumption-api.service";
import { WorkspaceStore } from "../../workspaces/data-access/workspace.store";
import {
  ViewEncapsulation,
  Component,
  effect,
  inject,
  signal,
} from "@angular/core";
import { DatePipe, DecimalPipe } from "@angular/common";
import type { Schema } from "../../../core/contracts/api-types";
import { SessionStore } from "../../../core/auth/session.store";
import { errorMessage } from "../../../core/http/api-error";
import { IconComponent } from "../../../shared/ui/icon/icon.component";
import { consumptionKindLabel, consumptionStageLabel, pipelineShortId } from '../models/ledger-labels';

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
  readonly shortPipelineId = pipelineShortId;
  readonly workspace = inject(WorkspaceStore);

  private readonly api = inject(ConsumptionApi);
  readonly session = inject(SessionStore);
  readonly consumption = signal<Schema<"ConsumptionDto"> | null>(null);
  readonly ledger = signal<Schema<"UsageLedgerEntryDto">[]>([]);
  readonly nextId = signal<string | null>(null);
  readonly error = signal("");
  readonly busy = signal(false);
  private generation = 0;
  constructor() {
    effect(() => {
      const id = this.workspace.workspaceId();
      if (id) void this.load(id);
    });
  }
  async load(id = this.workspace.workspaceId()): Promise<void> {
    const generation = ++this.generation;
    this.error.set("");
    this.busy.set(true);
    this.consumption.set(null);
    this.ledger.set([]);
    this.nextId.set(null);
    try {
      const [usage, page] = await Promise.all([
        this.api.overview(id),
        this.api.ledger(id),
      ]);
      if (generation === this.generation) {
        this.consumption.set(usage);
        this.ledger.set(page.items);
        this.nextId.set(page.nextBeforeId);
      }
    } catch (error) {
      if (generation === this.generation) this.error.set(errorMessage(error));
    } finally {
      if (generation === this.generation) this.busy.set(false);
    }
  }
  async loadMore(): Promise<void> {
    if (!this.nextId() || this.busy()) return;
    const generation = this.generation;
    const id = this.workspace.workspaceId();
    this.busy.set(true);
    try {
      const page = await this.api.ledger(id, this.nextId());
      if (generation === this.generation) {
        this.ledger.update((items) => [...items, ...page.items]);
        this.nextId.set(page.nextBeforeId);
      }
    } catch (error) {
      if (generation === this.generation) this.error.set(errorMessage(error));
    } finally {
      if (generation === this.generation) this.busy.set(false);
    }
  }
}
