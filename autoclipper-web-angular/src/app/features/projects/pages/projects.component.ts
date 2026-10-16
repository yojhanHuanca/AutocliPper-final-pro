import { Component } from "@angular/core";
import { ProjectCollectionComponent } from "../components/project-collection/project-collection.component";
@Component({
  selector: "ac-projects",
  imports: [ProjectCollectionComponent],
  templateUrl: "./projects.component.html",
})
export class ProjectsComponent {}
