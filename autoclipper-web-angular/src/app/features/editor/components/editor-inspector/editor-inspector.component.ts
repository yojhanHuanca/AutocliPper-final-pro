import { EditorCaptionsComponent } from "../editor-captions/editor-captions.component";
import { RevisionHistoryComponent } from "../revision-history/revision-history.component";
import { ReviewPanelComponent } from "../review-panel/review-panel.component";
import { ExportListComponent } from "../export-list/export-list.component";
import { ViewEncapsulation, Component, inject } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { DatePipe, DecimalPipe } from "@angular/common";
import { RouterLink } from "@angular/router";
import { IconComponent } from "../../../../shared/ui/icon/icon.component";
import { EditorState } from "../../state/editor.state";
@Component({
  encapsulation: ViewEncapsulation.None,
  selector: "ac-editor-inspector",
  imports: [
    FormsModule,
    DecimalPipe,
    IconComponent,
    EditorCaptionsComponent,
    RevisionHistoryComponent,
    ReviewPanelComponent,
    ExportListComponent,
  ],
  templateUrl: "./editor-inspector.component.html",
  styleUrl: "./editor-inspector.component.css",
})
export class EditorInspectorComponent {
  readonly vm = inject(EditorState);
}
