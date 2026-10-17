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
  private loadVersion = 0;
  async createPersonal(name: string): Promise<void> {
    await this.create(name, "personal");
  }
  async createTeam(name: string): Promise<void> {
    await this.create(name, "team");
  }
  private async create(name: string, kind: "personal" | "team"): Promise<void> {
    const selectedBeforeCreate = this.workspaceId();
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
    await this.loadWorkspaces();
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
