import { Component, inject } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { DatePipe } from "@angular/common";
import { IconComponent } from "../../../../shared/ui/icon/icon.component";
import { EditorState } from "../../state/editor.state";
@Component({
  selector: "ac-revision-history",
  imports: [DatePipe, IconComponent],
  templateUrl: "./revision-history.component.html",
})
export class RevisionHistoryComponent {
  readonly vm = inject(EditorState);
}
