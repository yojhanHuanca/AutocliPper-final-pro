import { Component, inject } from "@angular/core";
import { ProjectCollectionComponent } from "../components/project-collection/project-collection.component";
import { WorkspaceSetupComponent } from "../../workspaces/components/workspace-setup/workspace-setup.component";
import { WorkspaceStore } from "../../workspaces/data-access/workspace.store";
import { IconComponent } from "../../../shared/ui/icon/icon.component";
import { DESIGN_MODE } from "../../../core/config/design-mode.token";
@Component({
  selector: "ac-projects",
  imports: [ProjectCollectionComponent, WorkspaceSetupComponent, IconComponent],
  templateUrl: "./projects.component.html",
  styleUrl: "./projects.component.css",
})
export class ProjectsComponent {
  readonly workspace = inject(WorkspaceStore);
  readonly design = inject(DESIGN_MODE);
}
