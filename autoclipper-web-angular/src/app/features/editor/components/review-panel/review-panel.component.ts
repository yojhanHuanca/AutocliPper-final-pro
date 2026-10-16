import { Component, inject } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { DatePipe } from "@angular/common";
import { IconComponent } from "../../../../shared/ui/icon/icon.component";
import { EditorState } from "../../state/editor.state";
@Component({
  selector: "ac-review-panel",
  imports: [FormsModule, DatePipe],
  templateUrl: "./review-panel.component.html",
})
export class ReviewPanelComponent {
  readonly vm = inject(EditorState);
}
