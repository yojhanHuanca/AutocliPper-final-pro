import { Component, ViewEncapsulation, inject, signal } from "@angular/core";
import { WorkspaceSetupComponent } from '../../workspaces/components/workspace-setup/workspace-setup.component';
import { RouterLink } from "@angular/router";
import { DESIGN_MODE } from "../../../core/config/design-mode.token";
import { SessionStore } from "../../../core/auth/session.store";
import { WorkspaceStore } from "../../workspaces/data-access/workspace.store";
import { ProjectCollectionComponent } from "../../projects/components/project-collection/project-collection.component";
import { IconComponent } from "../../../shared/ui/icon/icon.component";
import { workspaceRoleLabel } from "../../../core/labels/workspace-role-label";
@Component({
  selector: "ac-dashboard",
  imports: [RouterLink, IconComponent, ProjectCollectionComponent, WorkspaceSetupComponent],
  templateUrl: "./dashboard.component.html",
  styleUrl: "./dashboard.component.css",
  encapsulation: ViewEncapsulation.None,
})
export class DashboardComponent {
  readonly design = inject(DESIGN_MODE);
  readonly session = inject(SessionStore);
  readonly workspace = inject(WorkspaceStore);
  readonly projectsCount = signal<number | null>(null);
  nextClipLabel(): string {
    if (this.design) return "Empieza con un proyecto";
    if (this.projectsCount() === null) return "Consultando proyectos…";
    return this.projectsCount() === 0 ? "Crea tu primer proyecto" : "Abre un proyecto";
  }
  nextClipDescription(): string {
    if (this.design) return "Los videos y borradores aparecen dentro de cada proyecto.";
    if (this.projectsCount() === null) return "El siguiente paso aparecerá al cargar la lista.";
    return this.projectsCount() === 0 ? "Ponle nombre y carga tu primer video." : "Elige un video para continuar con tu clip.";
  }
  roleLabel(): string {
    if (this.design) return "Tu rol aparecerá aquí";
    const role = this.workspace.workspaces().find((w) => w.id === this.workspace.workspaceId())?.role;
    return role ? workspaceRoleLabel(role) : "Sin espacio";
  }
}
