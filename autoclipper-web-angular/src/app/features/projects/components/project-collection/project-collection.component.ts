import { DESIGN_MODE } from "../../../../core/config/design-mode.token";
import { ProjectsApi } from "../../data-access/projects-api.service";
import { WorkspaceStore } from "../../../workspaces/data-access/workspace.store";
import {
  ViewEncapsulation,
  Component,
  computed,
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
  readonly pageIndex = signal(0);
  readonly pageSize = 12;
  readonly pageCount = computed(() => Math.max(1, Math.ceil(this.projects().length / this.pageSize)));
  readonly visibleProjects = computed(() => {
    const start = this.pageIndex() * this.pageSize;
    return this.projects().slice(start, start + this.pageSize);
  });
  readonly pageStart = computed(() => this.projects().length ? this.pageIndex() * this.pageSize + 1 : 0);
  readonly pageEnd = computed(() => Math.min(this.projects().length, (this.pageIndex() + 1) * this.pageSize));
  readonly busy = signal(false);
  readonly loaded = signal(false);
  readonly error = signal("");
  readonly confirmedSearch = signal("");
  readonly mutationError = signal("");
  readonly newProject = signal(false);
  readonly projectAction = signal<"rename" | "archive" | null>(null);
  readonly actionProject = signal<Schema<"ProjectSummaryDto"> | null>(null);
  private createdProjectReceipt: { id: string; request: string } | null = null;
  projectName = "";
  renameValue = "";
  search = "";
  private generation = 0;
  private loadedWorkspaceId = "";
  private loadedSearch = "";
  private creationKey = "";
  private creationBody = "";
  private createDialogReturnFocus: HTMLElement | null = null;
  private actionDialogReturnFocus: HTMLElement | null = null;
  constructor() {
    if (!this.design && this.route.snapshot.queryParamMap?.get("new") === "1") {
      this.newProject.set(true);
      this.focusCreateDialogInput();
    }
    effect(() => {
      const id = this.workspace.workspaceId();
      if (!this.design) void this.load(id);
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
    if (!role) return "No se confirmó tu rol en este espacio. Crear, renombrar y mover proyectos a la papelera permanecen deshabilitados.";
    if (role === "reader") return "Tienes acceso de lectura. Para crear, renombrar o archivar proyectos necesitas un rol de editor o superior.";
    return "";
  }
  resultsNeedRefresh(): boolean {
    return this.loaded() && this.confirmedSearch() !== this.search.trim();
  }
  async load(id = this.workspace.workspaceId()): Promise<void> {
    if (this.design || (id && id !== this.workspace.workspaceId())) return;
    const generation = ++this.generation;
    this.error.set("");
    if (id !== this.loadedWorkspaceId) {
      this.loadedWorkspaceId = id;
      this.loaded.set(false);
      this.confirmedSearch.set("");
      this.pageIndex.set(0);
      this.projects.set([]);
      this.loadedCount.emit(null);
      this.closeProjectAction(false);
    }
    if (!id) {
      this.busy.set(false);
      this.loaded.set(false);
      return;
    }
    this.busy.set(true);
    try {
      const search = this.search.trim();
      const result = await this.api.list(id, search);
      if (generation === this.generation && id === this.workspace.workspaceId()) {
        if (result.items.some((project) => project.workspaceId !== id)) {
          this.error.set("La lista recibida no corresponde al espacio seleccionado.");
          return;
        }
        this.projects.set(result.items);
        this.confirmedSearch.set(search);
        this.pageIndex.set(0);
        this.loaded.set(true);
        this.loadedCount.emit(result.items.length);
      }
    } catch (error) {
      if (generation === this.generation && id === this.workspace.workspaceId()) {
        if (this.denied(error)) {
          this.projects.set([]);
          this.loaded.set(false);
          this.confirmedSearch.set("");
          this.pageIndex.set(0);
          this.loadedCount.emit(null);
          this.closeProjectAction(false);
        }
        this.error.set(errorMessage(error));
      }
    } finally {
      if (generation === this.generation && id === this.workspace.workspaceId()) this.busy.set(false);
    }
  }
  private denied(error: unknown): boolean {
    return typeof error === "object" && error !== null && "status" in error && [401, 403, 404].includes(Number(error.status));
  }
  async create(): Promise<void> {
    if (this.design || !this.projectName.trim() || this.busy() || !this.canEdit()) return;
    const generation = this.generation;
    this.busy.set(true);
    this.mutationError.set("");
    const workspaceId = this.workspace.workspaceId();
    const serialized = JSON.stringify([
      workspaceId,
      this.projectName.trim(),
    ]);
    if (this.createdProjectReceipt?.request === serialized) {
      try {
        const navigated = await this.router.navigate(["/app/projects", this.createdProjectReceipt.id]);
        if (!navigated) this.mutationError.set("El proyecto ya está creado, pero no se pudo abrir. Vuelve a intentarlo; no se creará otro.");
      } catch {
        this.mutationError.set("El proyecto ya está creado, pero no se pudo abrir. Vuelve a intentarlo; no se creará otro.");
      } finally { if (generation === this.generation) this.busy.set(false); }
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
      this.createdProjectReceipt = { id: result.id, request: serialized };
      if (workspaceId !== this.workspace.workspaceId()) return;
      const navigated = await this.router.navigate(["/app/projects", result.id]);
      if (!navigated) this.mutationError.set("El proyecto ya está creado, pero no se pudo abrir. Vuelve a intentarlo; no se creará otro.");
    } catch (error) {
      if (workspaceId === this.workspace.workspaceId()) this.mutationError.set(errorMessage(error));
    } finally {
      if (generation === this.generation) this.busy.set(false);
    }
  }
  hasCreatedProjectForCurrentInput(): boolean {
    return this.createdProjectReceipt?.request === JSON.stringify([this.workspace.workspaceId(), this.projectName.trim()]);
  }
  openRename(project: Schema<"ProjectSummaryDto">): void {
    this.openProjectAction("rename", project);
    this.renameValue = project.name;
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => {
      if (this.projectAction() === "rename" && typeof document !== "undefined") document.getElementById("rename-project-name")?.focus();
    });
  }
  openArchive(project: Schema<"ProjectSummaryDto">): void {
    this.openProjectAction("archive", project);
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => {
      if (this.projectAction() === "archive" && typeof document !== "undefined") document.getElementById("project-action-cancel")?.focus();
    });
  }
  private openProjectAction(action: "rename" | "archive", project: Schema<"ProjectSummaryDto">): void {
    if (this.design || !this.canEdit() || this.busy()) return;
    this.actionDialogReturnFocus = typeof document !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    this.actionProject.set(project);
    this.projectAction.set(action);
    this.mutationError.set("");
  }
  closeProjectAction(restoreFocus = true): void {
    this.projectAction.set(null);
    this.actionProject.set(null);
    this.renameValue = "";
    this.mutationError.set("");
    if (restoreFocus && typeof requestAnimationFrame === "function") requestAnimationFrame(() => {
      if (typeof document === "undefined") return;
      const trigger = this.actionDialogReturnFocus?.isConnected ? this.actionDialogReturnFocus : null;
      trigger?.focus();
      this.actionDialogReturnFocus = null;
    });
  }
  async saveRename(): Promise<void> {
    const project = this.actionProject();
    const name = this.renameValue.trim();
    if (this.design || !project || this.projectAction() !== "rename" || !name || name === project.name || this.busy() || !this.canEdit()) return;
    const workspaceId = this.workspace.workspaceId();
    const generation = this.generation;
    this.busy.set(true);
    this.mutationError.set("");
    try {
      const result = await this.api.updateProject(project.id, { name, version: project.version });
      if (workspaceId !== this.workspace.workspaceId() || workspaceId !== this.loadedWorkspaceId) return;
      if (result.id !== project.id || result.workspaceId !== workspaceId) throw new Error("La respuesta de actualización no corresponde al proyecto seleccionado.");
      const confirmedSearch = this.confirmedSearch();
      if (!confirmedSearch) {
        this.projects.update((items) => items.map((item) => item.id === project.id ? { ...item, name: result.name, version: result.version } : item));
        this.closeProjectAction();
      } else {
        this.closeProjectAction(false);
        await this.load(workspaceId);
      }
    } catch (error) {
      if (workspaceId === this.workspace.workspaceId()) {
        const status = typeof error === "object" && error !== null && "status" in error ? Number(error.status) : 0;
        this.mutationError.set(status === 409 || status === 412
          ? "El proyecto cambió desde la última consulta. Actualiza la lista y vuelve a intentar el cambio."
          : errorMessage(error));
      }
    } finally {
      if (generation === this.generation) this.busy.set(false);
    }
  }
  async archiveProject(): Promise<void> {
    const project = this.actionProject();
    if (this.design || !project || this.projectAction() !== "archive" || this.busy() || !this.canEdit()) return;
    const workspaceId = this.workspace.workspaceId();
    const generation = this.generation;
    this.busy.set(true);
    this.mutationError.set("");
    try {
      await this.api.trashProject(project.id);
      if (workspaceId !== this.workspace.workspaceId() || workspaceId !== this.loadedWorkspaceId) return;
      this.removeProject(project.id);
      this.closeProjectAction(false);
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => {
        if (typeof document !== "undefined") document.getElementById("projects-title")?.focus();
      });
    } catch (error) {
      if (workspaceId === this.workspace.workspaceId()) this.mutationError.set(errorMessage(error));
    } finally {
      if (generation === this.generation) this.busy.set(false);
    }
  }
  private removeProject(projectId: string): void {
    this.projects.update((items) => items.filter((item) => item.id !== projectId));
    this.pageIndex.update((page) => Math.min(page, Math.max(0, this.pageCount() - 1)));
    this.loadedCount.emit(this.projects().length);
  }
  onProjectActionKeydown(event: KeyboardEvent): void {
    if (this.busy()) {
      if (event.key === "Escape") event.preventDefault();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      this.closeProjectAction();
      return;
    }
    if (event.key !== "Tab") return;
    const dialog = event.currentTarget as HTMLElement;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
    )).filter(element => element.getClientRects().length > 0 && element.getAttribute("aria-hidden") !== "true");
    if (!focusable.length) { event.preventDefault(); return; }
    if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1)?.focus(); }
    else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0].focus(); }
  }
  openCreateDialog(): void {
    if (this.design || !this.canEdit() || this.busy()) return;
    this.createDialogReturnFocus = typeof document !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    this.newProject.set(true);
    this.mutationError.set("");
    this.focusCreateDialogInput();
  }
  private focusCreateDialogInput(): void {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => {
      if (this.newProject() && typeof document !== "undefined") document.getElementById("project-name")?.focus();
    });
  }
  closeCreateDialog(): void {
    if (this.busy()) return;
    this.newProject.set(false);
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => {
      if (typeof document === "undefined") return;
      const trigger = this.createDialogReturnFocus?.isConnected
        ? this.createDialogReturnFocus
        : document.getElementById("project-create-button") ?? document.getElementById("project-empty-create-button");
      trigger?.focus();
      this.createDialogReturnFocus = null;
    });
  }
  onCreateDialogKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      this.closeCreateDialog();
      return;
    }
    if (event.key !== "Tab") return;
    const dialog = event.currentTarget as HTMLElement;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
    )).filter(element => element.getClientRects().length > 0 && element.getAttribute("aria-hidden") !== "true");
    if (!focusable.length) { event.preventDefault(); return; }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  clearSearch(): void {
    this.search = "";
    void this.load();
  }
  previousPage(): void {
    if (this.busy() || this.pageIndex() <= 0) return;
    this.pageIndex.update((page) => page - 1);
  }
  nextPage(): void {
    if (this.busy() || this.pageIndex() + 1 >= this.pageCount()) return;
    this.pageIndex.update((page) => page + 1);
  }
}
