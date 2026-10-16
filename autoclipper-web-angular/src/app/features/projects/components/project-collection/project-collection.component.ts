import { DESIGN_MODE } from "../../../../core/config/design-mode.token";
import { ProjectsApi } from "../../data-access/projects-api.service";
import { WorkspaceStore } from "../../../workspaces/data-access/workspace.store";
import {
  ViewEncapsulation,
  Component,
  effect,
  inject,
  signal,
  input,
  output,
} from "@angular/core";
import { DatePipe } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import type { Schema } from "../../../../core/contracts/api-types";
import { SessionStore } from "../../../../core/auth/session.store";
import { errorMessage } from "../../../../core/http/api-error";
import { IconComponent } from "../../../../shared/ui/icon/icon.component";

@Component({
  encapsulation: ViewEncapsulation.None,
  selector: "ac-project-collection",
  imports: [RouterLink, FormsModule, DatePipe, IconComponent],
  templateUrl: "./project-collection.component.html",
  styleUrl: "./project-collection.component.css",
})
export class ProjectCollectionComponent {
  readonly workspace = inject(WorkspaceStore);

  readonly session = inject(SessionStore);
  private readonly api = inject(ProjectsApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly design = inject(DESIGN_MODE);
  readonly compact = input(false);
  readonly loadedCount = output<number | null>();
  readonly projects = signal<Schema<"ProjectSummaryDto">[]>([]);
  readonly busy = signal(false);
  readonly loaded = signal(false);
  readonly error = signal("");
  readonly newProject = signal(false);
  projectName = "";
  search = "";
  private generation = 0;
  private creationKey = "";
  private creationBody = "";
  constructor() {
    effect(() => {
      const id = this.workspace.workspaceId();
      if (!this.design && id) void this.load(id);
    });
  }
  canEdit(): boolean {
    return ["owner", "admin", "editor"].includes(
      this.workspace
        .workspaces()
        .find((w) => w.id === this.workspace.workspaceId())?.role ?? "",
    );
  }
  roleLabel(): string {
    return this.design
      ? "Tu rol aparecerá aquí"
      : (this.workspace
          .workspaces()
          .find((w) => w.id === this.workspace.workspaceId())?.role ??
          "Sin espacio");
  }
  async load(id = this.workspace.workspaceId()): Promise<void> {
    if (this.design || !id) return;
    const generation = ++this.generation;
    this.busy.set(true);
    this.error.set("");
    this.loaded.set(false);
    this.projects.set([]);
    this.loadedCount.emit(null);
    try {
      const result = await this.api.list(id, this.search);
      if (generation === this.generation) {
        this.projects.set(result.items);
        this.loaded.set(true);
        this.loadedCount.emit(result.items.length);
      }
    } catch (error) {
      if (generation === this.generation) this.error.set(errorMessage(error));
    } finally {
      if (generation === this.generation) this.busy.set(false);
    }
  }
  async create(): Promise<void> {
    if (this.design || !this.projectName.trim() || this.busy()) return;
    this.busy.set(true);
    this.error.set("");
    const serialized = JSON.stringify([
      this.workspace.workspaceId(),
      this.projectName.trim(),
    ]);
    if (serialized !== this.creationBody) {
      this.creationBody = serialized;
      this.creationKey = crypto.randomUUID();
    }
    try {
      const result = await this.api.create(
        {
          workspaceId: this.workspace.workspaceId(),
          name: this.projectName.trim(),
        },
        this.creationKey,
      );
      this.creationKey = "";
      await this.router.navigate(["/app/projects", result.id]);
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
