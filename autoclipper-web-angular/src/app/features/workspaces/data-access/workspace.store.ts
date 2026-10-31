import { Injectable, inject, signal } from "@angular/core";
import { ApiTransport } from "../../../core/http/api-transport.service";
import type { Schema } from "../../../core/contracts/api-types";
@Injectable({ providedIn: "root" })
export class WorkspaceStore {
  private readonly api = inject(ApiTransport);
  readonly workspaces = signal<Schema<"WorkspaceSummaryDto">[]>([]);
  readonly workspaceId = signal("");
  readonly loaded = signal(false);
  private creationKey = "";
  private creationName = "";
  private creationKind: "personal" | "team" = "personal";
  private pendingCreated: { id: string; name: string; kind: "personal" | "team"; selectedWorkspaceId: string } | null = null;
  private pendingInvitationRefresh: { userId: string; previousWorkspaceIds: readonly string[]; selectedWorkspaceId: string } | null = null;
  private loadVersion = 0;
  private sessionVersion = 0;
  async createPersonal(name: string): Promise<void> {
    await this.create(name, "personal");
  }
  async createTeam(name: string): Promise<void> {
    await this.create(name, "team");
  }
  private async create(name: string, kind: "personal" | "team"): Promise<void> {
    const sessionVersion = this.sessionVersion;
    const selectedBeforeCreate = this.workspaceId();
    const pending = this.pendingCreated;
    if (pending) {
      try { await this.loadWorkspaces({ selectFirst: false }); }
      catch { throw new Error("El espacio ya se creó, pero no pudimos actualizar la lista. Reintenta; no enviaremos otra creación."); }
      if (sessionVersion !== this.sessionVersion) throw new Error("La sesión cambió mientras se creaba el espacio. Actualiza la lista con la cuenta actual.");
      if (!this.workspaces().some((workspace) => workspace.id === pending.id))
        throw new Error("El servidor aceptó el espacio, pero todavía no aparece en la lista. Reintenta para volver a consultarla sin crear otro.");
      this.pendingCreated = null;
      if (pending.name === name && pending.kind === kind) {
        if (this.workspaceId() === pending.selectedWorkspaceId && this.workspaces().some((workspace) => workspace.id === pending.id))
          this.workspaceId.set(pending.id);
        this.creationKey = "";
        return;
      }
    }
    if (name !== this.creationName || kind !== this.creationKind || !this.creationKey) {
      this.creationName = name;
      this.creationKind = kind;
      this.creationKey = crypto.randomUUID();
    }
    const created = await this.api.post<Schema<"CreatedWorkspaceDto">>(
      "/workspaces",
      { name, kind },
      this.creationKey,
    );
    if (sessionVersion !== this.sessionVersion) throw new Error("La sesión cambió mientras se creaba el espacio. Actualiza la lista con la cuenta actual.");
    this.creationKey = "";
    this.pendingCreated = { id: created.id, name, kind, selectedWorkspaceId: selectedBeforeCreate };
    try { await this.loadWorkspaces({ selectFirst: false }); }
    catch { throw new Error("El servidor aceptó la creación, pero no pudimos actualizar la lista. Reintenta; no se creará otro espacio."); }
    if (!this.workspaces().some((workspace) => workspace.id === created.id))
      throw new Error("El servidor aceptó la creación, pero el espacio aún no aparece en la lista. Reintenta para volver a consultarla.");
    this.pendingCreated = null;
    if (
      this.workspaceId() === selectedBeforeCreate &&
      this.workspaces().some((workspace) => workspace.id === created.id)
    ) {
      this.workspaceId.set(created.id);
    }
  }
  async loadWorkspaces(options: { selectFirst?: boolean } = {}): Promise<boolean> {
    const version = ++this.loadVersion;
    const result =
      await this.api.get<Schema<"WorkspaceListDto">>("/workspaces");
    if (version !== this.loadVersion) return false;
    this.workspaces.set(result.items);
    this.loaded.set(true);
    if (!result.items.some((w) => w.id === this.workspaceId()))
      this.workspaceId.set(options.selectFirst === false ? "" : result.items[0]?.id ?? "");
    return true;
  }

  async acceptInvitation(token: string, previousWorkspaceIds: readonly string[], userId: string): Promise<void> {
    if (!userId) throw new Error("Inicia sesión con la cuenta que recibió la invitación.");
    const sessionVersion = this.sessionVersion;
    let pending = this.pendingInvitationRefresh;
    if (pending && pending.userId !== userId) {
      throw new Error("La invitación ya se aceptó con otra cuenta. Entra con esa misma cuenta para actualizar sus espacios.");
    }
    if (!pending) {
      await this.api.post<void>("/workspaces/invitations/accept", { token });
      if (sessionVersion !== this.sessionVersion) throw new Error("La sesión cambió mientras se aceptaba la invitación. Inicia sesión con la cuenta correcta para actualizar el acceso.");
      pending = { userId, previousWorkspaceIds: [...previousWorkspaceIds], selectedWorkspaceId: this.workspaceId() };
      this.pendingInvitationRefresh = pending;
    }
    try {
      const refreshed = await this.loadWorkspaces({ selectFirst: false });
      if (sessionVersion !== this.sessionVersion) throw new Error("La sesión cambió mientras se actualizaban los espacios.");
      if (!refreshed) throw new Error("Otra consulta de espacios reemplazó esta respuesta.");
    } catch {
      throw new Error("La invitación se aceptó, pero no pudimos actualizar tus espacios. Reintenta para consultar el acceso; no volveremos a enviar el token.");
    }
    const existing = new Set(pending.previousWorkspaceIds);
    const added = this.workspaces().filter((workspace) => !existing.has(workspace.id));
    if (added.length === 1 && this.workspaceId() === pending.selectedWorkspaceId) this.workspaceId.set(added[0].id);
    this.pendingInvitationRefresh = null;
  }

  clear(): void {
    this.sessionVersion += 1;
    this.loadVersion += 1;
    this.creationKey = "";
    this.creationName = "";
    this.creationKind = "personal";
    this.pendingCreated = null;
    this.pendingInvitationRefresh = null;
    this.workspaces.set([]);
    this.workspaceId.set("");
    this.loaded.set(false);
  }
}
