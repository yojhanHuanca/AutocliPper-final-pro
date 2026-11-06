import { Component, ViewEncapsulation, computed, effect, inject, signal } from "@angular/core";
import { DatePipe, DecimalPipe } from "@angular/common";
import { RouterLink } from "@angular/router";
import { DESIGN_MODE } from "../../../core/config/design-mode.token";
import { SessionStore } from "../../../core/auth/session.store";
import { WorkspaceStore } from "../../workspaces/data-access/workspace.store";
import { WorkspaceSetupComponent } from "../../workspaces/components/workspace-setup/workspace-setup.component";
import { hasWorkspaceLevel } from "../../workspaces/models/workspace-permissions";
import { consumptionQuotaProgress } from "../../consumption/models/ledger-labels";
import { IconComponent } from "../../../shared/ui/icon/icon.component";
import { workspaceRoleLabel } from "../../../core/labels/workspace-role-label";
import { DashboardState, type HomeSource } from "../state/dashboard.state";
import { errorMessage } from "../../../core/http/api-error";
@Component({
  selector: "ac-dashboard",
  imports: [RouterLink, DatePipe, DecimalPipe, IconComponent, WorkspaceSetupComponent],
  providers: [DashboardState],
  templateUrl: "./dashboard.component.html",
  styleUrl: "./dashboard.component.css",
  encapsulation: ViewEncapsulation.None,
})
export class DashboardComponent {
  readonly design = inject(DESIGN_MODE);
  readonly session = inject(SessionStore);
  readonly workspace = inject(WorkspaceStore);
  readonly vm = inject(DashboardState);
  readonly activeWorkspace = computed(() => this.workspace.workspaces().find(item => item.id === this.workspace.workspaceId()) ?? null);
  readonly activeWorkspaceId = computed(() => this.activeWorkspace()?.id ?? "");
  readonly workspaceRefreshBusy = signal(false);
  readonly workspaceRefreshError = signal("");
  workspaceSelectionRequired(): boolean {
    return !this.design && this.workspace.loaded() && this.workspace.workspaces().length > 0 && !this.activeWorkspace();
  }
  readonly canCreate = computed(() => !this.design && !this.vm.denied() && this.workspace.loaded() && !!this.activeWorkspace() && hasWorkspaceLevel(this.activeWorkspace()!.role, "editor"));
  readonly resumeProcessing = computed(() => this.vm.processing().find(item => item.status === "queued" || item.status === "running") ?? null);
  readonly resumeDraft = computed(() => this.vm.drafts()[0] ?? null);
  readonly resumeProject = computed(() => this.vm.projects()[0] ?? null);
  readonly quotaProgress = consumptionQuotaProgress;
  readonly base = this.design ? "/design" : "/app";
  constructor() {
    effect(() => {
      if (this.design) return;
      const activeId = this.activeWorkspaceId();
      void this.vm.load(this.workspace.loaded() ? activeId : "");
    });
  }
  createClipsDestination(): string[] {
    if (!this.vm.projectsLoaded() || this.vm.error()) return ["/app/projects"];
    const project = this.resumeProject();
    return project ? ["/app/projects", project.id] : ["/app/projects"];
  }
  editorDestination(draftId: string): string[] {
    // Design mode has no account-backed drafts. Never route a draft action into the synthetic editor demo.
    return this.design ? ["/app/projects"] : ["/app/edits", draftId];
  }
  projectDestination(projectId: string): string[] {
    return [this.base + "/projects", projectId];
  }
  createClipsDestinationQueryParams(): { createClips: "1" } | null {
    return this.hasConfirmedRecentProject() && this.canCreate() ? { createClips: "1" } : null;
  }
  createClipsLabel(): string {
    if (!this.canCreate()) return "Ver proyectos";
    if (!this.vm.projectsLoaded() || this.vm.error()) return "Consultar proyectos";
    return this.resumeProject() ? "Crear clips" : "Crear proyecto";
  }
  hasConfirmedRecentProject(): boolean {
    return this.vm.projectsLoaded() && !this.vm.error() && !!this.resumeProject();
  }
  createClipsQueryParams(): { new: "1" } | null {
    if (this.resumeProject() || !this.canCreate() || !this.vm.projectsLoaded() || this.vm.error()) return null;
    return this.vm.projects().length === 0 ? { new: "1" } : null;
  }
  refresh(): void {
    if (!this.design && this.activeWorkspaceId()) void this.vm.load(this.activeWorkspaceId());
  }
  async refreshWorkspaceAccess(): Promise<void> {
    if (this.design || this.workspaceRefreshBusy()) return;
    const selectedId = this.workspace.workspaceId();
    this.workspaceRefreshBusy.set(true);
    this.workspaceRefreshError.set("");
    try {
      const refreshed = await this.workspace.loadWorkspaces();
      if (!refreshed) throw new Error("Otra actualización de espacios reemplazó esta consulta. Inténtalo otra vez.");
      // A role change may leave the selected ID unchanged. Recheck its project data
      // explicitly; if selection changed, the workspace effect already starts that load.
      if (selectedId === this.activeWorkspaceId() && selectedId) await this.vm.load(selectedId);
    } catch (error) {
      this.workspaceRefreshError.set(`No se pudieron actualizar tus espacios. ${errorMessage(error)}`);
    } finally {
      this.workspaceRefreshBusy.set(false);
    }
  }
  async retry(): Promise<void> {
    if (this.vm.denied()) { await this.refreshWorkspaceAccess(); return; }
    this.refresh();
  }
  roleLabel(): string { const role = this.activeWorkspace()?.role; return !this.vm.denied() && role ? workspaceRoleLabel(role) : "Acceso pendiente"; }
  sourceLabel(source: HomeSource): string {
    if (source.state === "aborted") return "Carga cancelada";
    if (source.state === "pending") return "Sin confirmar";
    return ({ succeeded: "Inspeccionado", failed: "Inspección rechazada", queued: "En espera", running: "Inspeccionando" } as Record<string, string>)[source.inspection?.status ?? ""] ?? "Inspección pendiente";
  }
  processingLabel(status: string): string {
    return ({ queued: "En cola", running: "Procesando", succeeded: "Completado", failed: "Falló", cancelled: "Cancelado" } as Record<string, string>)[status] ?? "Estado no disponible";
  }
  processingSummary(item: import("../state/dashboard.state").HomeProcessing): string {
    return item.spec.kind === "clip" && Number.isFinite(item.spec.startSeconds) && Number.isFinite(item.spec.endSeconds)
      ? `Clip · ${item.spec.startSeconds}–${item.spec.endSeconds} s${item.spec.aspect ? ` · ${item.spec.aspect}` : ""}`
      : item.spec.kind === "audio" ? "Audio de trabajo" : "Render guardado";
  }
}
