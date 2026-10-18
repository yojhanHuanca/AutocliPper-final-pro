import { Component, ViewEncapsulation, computed, effect, inject } from "@angular/core";
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
  readonly canCreate = computed(() => !this.design && !this.vm.denied() && this.workspace.loaded() && !!this.activeWorkspace() && hasWorkspaceLevel(this.activeWorkspace()!.role, "editor"));
  readonly resumeDraft = computed(() => this.vm.drafts()[0] ?? null);
  readonly resumeProject = computed(() => this.vm.projects()[0] ?? null);
  readonly quotaProgress = consumptionQuotaProgress;
  readonly base = this.design ? "/design" : "/app";
  constructor() {
    effect(() => {
      if (this.design) return;
      const active = this.activeWorkspace();
      void this.vm.load(this.workspace.loaded() && active ? active.id : "");
    });
  }
  refresh(): void { if (!this.design && this.activeWorkspace()) void this.vm.load(this.activeWorkspace()!.id); }
  roleLabel(): string { const role = this.activeWorkspace()?.role; return !this.vm.denied() && role ? workspaceRoleLabel(role) : "Acceso pendiente"; }
  sourceLabel(source: HomeSource): string {
    if (source.state === "aborted") return "Carga cancelada";
    if (source.state === "pending") return "Sin confirmar";
    return ({ succeeded: "Inspeccionado", failed: "Inspección rechazada", queued: "En espera", running: "Inspeccionando" } as Record<string, string>)[source.inspection?.status ?? ""] ?? "Inspección pendiente";
  }
}
