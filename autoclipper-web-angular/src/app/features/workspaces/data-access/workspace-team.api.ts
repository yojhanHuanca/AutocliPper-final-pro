import { Injectable, inject } from "@angular/core";
import { ApiTransport } from "../../../core/http/api-transport.service";
import type { Schema } from "../../../core/contracts/api-types";

@Injectable({ providedIn: "root" })
export class WorkspaceTeamApi {
  private readonly api = inject(ApiTransport);

  members(workspaceId: string) {
    return this.api.get<Schema<"MemberListDto">>(`/workspaces/${encodeURIComponent(workspaceId)}/members`);
  }
  invite(workspaceId: string, body: Schema<"InvitationDto">, idempotencyKey: string) {
    return this.api.post<void>(`/workspaces/${encodeURIComponent(workspaceId)}/invitations`, body, idempotencyKey);
  }
  setRole(workspaceId: string, userId: string, role: Schema<"RoleDto">["role"]) {
    return this.api.patch<void>(`/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(userId)}`, { role });
  }
  remove(workspaceId: string, userId: string) {
    return this.api.delete<void>(`/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(userId)}`);
  }
  transfer(workspaceId: string, userId: string) {
    return this.api.post<void>(`/workspaces/${encodeURIComponent(workspaceId)}/ownership`, { userId });
  }
  acceptInvitation(token: string) {
    return this.api.post<void>("/workspaces/invitations/accept", { token });
  }
}
