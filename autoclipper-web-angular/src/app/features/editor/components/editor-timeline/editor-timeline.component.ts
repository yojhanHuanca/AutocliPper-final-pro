import { ViewEncapsulation, Component, inject } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { DatePipe, DecimalPipe } from "@angular/common";
import { RouterLink } from "@angular/router";
import { IconComponent } from "../../../../shared/ui/icon/icon.component";
import { EditorState } from "../../state/editor.state";
@Component({
  encapsulation: ViewEncapsulation.None,
  selector: "ac-editor-timeline",
  imports: [DecimalPipe, IconComponent],
  templateUrl: "./editor-timeline.component.html",
  styleUrl: "./editor-timeline.component.css",
})
export class EditorTimelineComponent {
  readonly vm = inject(EditorState);
}
