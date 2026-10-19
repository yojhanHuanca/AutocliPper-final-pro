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
import { workspaceRoleLabel } from "../../../../core/labels/workspace-role-label";

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
  private createdProjectReceipt: { id: string; request: string } | null = null;
  projectName = "";
  search = "";
  private generation = 0;
  private creationKey = "";
  private creationBody = "";
  constructor() {
    if (!this.design && this.route.snapshot.queryParamMap?.get("new") === "1") this.newProject.set(true);
    effect(() => {
      const id = this.workspace.workspaceId();
      if (!this.design && id) void this.load(id);
    });
  }
  canEdit(): boolean {
    if (!this.workspace.loaded()) return false;
    return ["owner", "admin", "editor"].includes(
      this.workspace
        .workspaces()
        .find((w) => w.id === this.workspace.workspaceId())?.role ?? "",
    );
  }
  roleLabel(): string {
    if (this.design) return "Tu rol aparecerá aquí";
    if (!this.workspace.loaded()) return "Comprobando acceso…";
    const role = this.workspace.workspaces().find((w) => w.id === this.workspace.workspaceId())?.role;
    return role ? workspaceRoleLabel(role) : "Sin acceso confirmado";
  }
  roleNotice(): string {
    if (this.design) return "";
    if (!this.workspace.loaded()) return "Comprobando el rol del espacio antes de habilitar cambios…";
    const role = this.workspace.workspaces().find((w) => w.id === this.workspace.workspaceId())?.role;
    if (!role) return "No se encontró un rol para este espacio. La creación de proyectos permanece deshabilitada.";
    if (role === "reader") return "Tienes acceso de lectura. Para crear proyectos necesitas un rol de editor o superior.";
    return "";
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
    if (this.design || !this.projectName.trim() || this.busy() || !this.canEdit()) return;
    this.busy.set(true);
    this.error.set("");
    const workspaceId = this.workspace.workspaceId();
    const serialized = JSON.stringify([
      workspaceId,
      this.projectName.trim(),
    ]);
    if (this.createdProjectReceipt?.request === serialized) {
      try {
        const navigated = await this.router.navigate(["/app/projects", this.createdProjectReceipt.id]);
        if (!navigated) this.error.set("El proyecto ya está creado, pero no se pudo abrir. Vuelve a intentarlo; no se creará otro.");
      } catch {
        this.error.set("El proyecto ya está creado, pero no se pudo abrir. Vuelve a intentarlo; no se creará otro.");
      } finally { this.busy.set(false); }
      return;
    }
    if (serialized !== this.creationBody) {
      this.creationBody = serialized;
      this.creationKey = crypto.randomUUID();
    }
    try {
      const result = await this.api.create(
        {
          workspaceId,
          name: this.projectName.trim(),
        },
        this.creationKey,
      );
      this.creationKey = "";
      if (workspaceId !== this.workspace.workspaceId()) return;
      this.createdProjectReceipt = { id: result.id, request: serialized };
      const navigated = await this.router.navigate(["/app/projects", result.id]);
      if (!navigated) this.error.set("El proyecto ya está creado, pero no se pudo abrir. Vuelve a intentarlo; no se creará otro.");
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
  hasCreatedProjectForCurrentInput(): boolean {
    return this.createdProjectReceipt?.request === JSON.stringify([this.workspace.workspaceId(), this.projectName.trim()]);
  }
  clearSearch(): void {
    this.search = "";
    void this.load();
  }
}
