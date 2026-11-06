import { SocialPublishComponent } from "../../../../shared/ui/social-publish/social-publish.component";
import { Component, inject } from "@angular/core";
import { IconComponent } from "../../../../shared/ui/icon/icon.component";
import { EditorState } from "../../state/editor.state";
import { exportFailureMessage } from "../../models/export-error";
@Component({
  selector: "ac-export-list",
  imports: [IconComponent, SocialPublishComponent],
  templateUrl: "./export-list.component.html",
  styleUrl: './export-list.component.css',
})
export class ExportListComponent {
  readonly vm = inject(EditorState);
  readonly exportFailureMessage = exportFailureMessage;
}
