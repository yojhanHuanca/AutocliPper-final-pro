import { Component, inject } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { DatePipe } from "@angular/common";
import { IconComponent } from "../../../../shared/ui/icon/icon.component";
import { EditorState } from "../../state/editor.state";
@Component({
  selector: "ac-export-list",
  imports: [IconComponent],
  templateUrl: "./export-list.component.html",
})
export class ExportListComponent {
  readonly vm = inject(EditorState);
}
