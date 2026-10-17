import { Injectable, inject } from "@angular/core";
import { ApiTransport } from "../../../core/http/api-transport.service";
import type { Schema } from "../../../core/contracts/api-types";

@Injectable({ providedIn: "root" })
export class AdminApi {
  private readonly api = inject(ApiTransport);

  access() {
    return this.api.get<Schema<"AdminAccessDto">>("/admin/access");
  }
  elevate(body: Schema<"AdminReauthDto">) {
    return this.api.post<Schema<"AdminElevatedDto">>("/admin/access", body);
  }
  users(beforeId?: string) {
    return this.api.get<Schema<"AdminUsersPageDto">>(this.pagePath("users", beforeId));
  }
  workspaces(beforeId?: string, workspaceId?: string) {
    return this.api.get<Schema<"AdminWorkspacesPageDto">>(this.pagePath("workspaces", beforeId, workspaceId));
  }
  jobs(beforeId?: string, workspaceId?: string) {
    return this.api.get<Schema<"AdminJobsPageDto">>(this.pagePath("jobs", beforeId, workspaceId));
  }
  consumption(beforeId?: string, workspaceId?: string) {
    return this.api.get<Schema<"AdminConsumptionPageDto">>(this.pagePath("consumption", beforeId, workspaceId));
  }
  private pagePath(section: string, beforeId?: string, workspaceId?: string): string {
    const query = new URLSearchParams({ limit: "25" });
    if (beforeId) query.set("beforeId", beforeId);
    if (workspaceId) query.set("workspaceId", workspaceId);
    return `/admin/${section}?${query.toString()}`;
  }
}
