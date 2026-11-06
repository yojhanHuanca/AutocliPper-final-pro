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
  users(beforeId?: string, verified?: boolean, mfaEnabled?: boolean) {
    const query = new URLSearchParams({ limit: "25" });
    if (beforeId) query.set("beforeId", beforeId);
    if (verified !== undefined) query.set("verified", String(verified));
    if (mfaEnabled !== undefined) query.set("mfaEnabled", String(mfaEnabled));
    return this.api.get<Schema<"AdminUsersPageDto">>(`/admin/users?${query.toString()}`);
  }
  workspaces(beforeId?: string, workspaceId?: string) {
    return this.api.get<Schema<"AdminWorkspacesPageDto">>(this.pagePath("workspaces", beforeId, workspaceId));
  }
  jobs(beforeId?: string, workspaceId?: string, kind?: string, status?: string) {
    const query = new URLSearchParams({ limit: "25" });
    if (beforeId) query.set("beforeId", beforeId);
    if (workspaceId) query.set("workspaceId", workspaceId);
    if (kind) query.set("kind", kind);
    if (status) query.set("status", status);
    return this.api.get<Schema<"AdminJobsPageDto">>(`/admin/jobs?${query.toString()}`);
  }
  consumption(beforeId?: string, workspaceId?: string) {
    return this.api.get<Schema<"AdminConsumptionPageDto">>(this.pagePath("consumption", beforeId, workspaceId));
  }
  audit(beforeId?: string) {
    return this.api.get<Schema<"AdminAuditPageDto">>(this.pagePath("audit", beforeId));
  }
  grants(beforeId?: string) {
    return this.api.get<Schema<"AdminGrantsPageDto">>(this.pagePath("grants", beforeId));
  }
  private pagePath(section: string, beforeId?: string, workspaceId?: string): string {
    const query = new URLSearchParams({ limit: "25" });
    if (beforeId) query.set("beforeId", beforeId);
    if (workspaceId) query.set("workspaceId", workspaceId);
    return `/admin/${section}?${query.toString()}`;
  }
}
