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
  private pendingCreated: { id: string; name: string; kind: "personal" | "team" } | null = null;
  private loadVersion = 0;
  async createPersonal(name: string): Promise<void> {
    await this.create(name, "personal");
  }
  async createTeam(name: string): Promise<void> {
    await this.create(name, "team");
  }
  private async create(name: string, kind: "personal" | "team"): Promise<void> {
    const selectedBeforeCreate = this.workspaceId();
    const pending = this.pendingCreated;
    if (pending) {
      try { await this.loadWorkspaces(); }
      catch { throw new Error("El espacio ya se creó, pero no pudimos actualizar la lista. Reintenta; no enviaremos otra creación."); }
      if (!this.workspaces().some((workspace) => workspace.id === pending.id))
        throw new Error("El servidor aceptó el espacio, pero todavía no aparece en la lista. Reintenta para volver a consultarla sin crear otro.");
      this.pendingCreated = null;
      if (pending.name === name && pending.kind === kind) {
        if ((!selectedBeforeCreate || this.workspaceId() === selectedBeforeCreate) && this.workspaces().some((workspace) => workspace.id === pending.id))
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
    this.creationKey = "";
    this.pendingCreated = { id: created.id, name, kind };
    try { await this.loadWorkspaces(); }
    catch { throw new Error("El servidor aceptó la creación, pero no pudimos actualizar la lista. Reintenta; no se creará otro espacio."); }
    if (!this.workspaces().some((workspace) => workspace.id === created.id))
      throw new Error("El servidor aceptó la creación, pero el espacio aún no aparece en la lista. Reintenta para volver a consultarla.");
    this.pendingCreated = null;
    if (
      (!selectedBeforeCreate || this.workspaceId() === selectedBeforeCreate) &&
      this.workspaces().some((workspace) => workspace.id === created.id)
    ) {
      this.workspaceId.set(created.id);
    }
  }
  async loadWorkspaces(): Promise<void> {
    const version = ++this.loadVersion;
    const result =
      await this.api.get<Schema<"WorkspaceListDto">>("/workspaces");
    if (version !== this.loadVersion) return;
    this.workspaces.set(result.items);
    this.loaded.set(true);
    if (!result.items.some((w) => w.id === this.workspaceId()))
      this.workspaceId.set(result.items[0]?.id ?? "");
  }

  async acceptInvitation(token: string): Promise<void> {
    await this.api.post<void>("/workspaces/invitations/accept", { token });
  }

  clear(): void {
    this.loadVersion += 1;
    this.workspaces.set([]);
    this.workspaceId.set("");
    this.loaded.set(false);
  }
}
