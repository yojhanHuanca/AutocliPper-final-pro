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
  async createPersonal(name: string): Promise<void> {
    if (name !== this.creationName || !this.creationKey) {
      this.creationName = name;
      this.creationKey = crypto.randomUUID();
    }
    await this.api.post(
      "/workspaces",
      { name, kind: "personal" },
      this.creationKey,
    );
    this.creationKey = "";
    await this.loadWorkspaces();
  }
  async loadWorkspaces(): Promise<void> {
    const result =
      await this.api.get<Schema<"WorkspaceListDto">>("/workspaces");
    this.workspaces.set(result.items);
    this.loaded.set(true);
    if (!result.items.some((w) => w.id === this.workspaceId()))
      this.workspaceId.set(result.items[0]?.id ?? "");
  }

  clear(): void {
    this.workspaces.set([]);
    this.workspaceId.set("");
    this.loaded.set(false);
  }
}
