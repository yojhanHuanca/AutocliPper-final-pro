import { Injectable, inject } from "@angular/core";
import type { Schema } from "../../../core/contracts/api-types";
import { ApiTransport } from "../../../core/http/api-transport.service";
@Injectable({ providedIn: "root" })
export class ConsumptionApi {
  private readonly api = inject(ApiTransport);
  overview(id: string) {
    return this.api.get<Schema<"ConsumptionDto">>(
      `/consumption/workspaces/${encodeURIComponent(id)}`,
    );
  }
  ledger(id: string, before?: string | null) {
    return this.api.get<Schema<"UsageLedgerDto">>(
      `/consumption/workspaces/${encodeURIComponent(id)}/ledger${before ? "?beforeId=" + encodeURIComponent(before) : ""}`,
    );
  }
}
