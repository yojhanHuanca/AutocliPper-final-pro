import { DatePipe } from "@angular/common";
import { ViewEncapsulation, Component, inject } from "@angular/core";
import { IconComponent } from "../../../shared/ui/icon/icon.component";
import { RouterLink } from '@angular/router';
import { EditorState } from "../state/editor.state";
import { EditorPreviewComponent } from "../components/editor-preview/editor-preview.component";
import { EditorInspectorComponent } from "../components/editor-inspector/editor-inspector.component";
import { EditorTimelineComponent } from "../components/editor-timeline/editor-timeline.component";
@Component({
  encapsulation: ViewEncapsulation.None,
  selector: "ac-editor",
  host: { '(window:beforeunload)': 'beforeUnload($event)' },
  providers: [EditorState],
  imports: [
    RouterLink,
    DatePipe,
    IconComponent,
    EditorPreviewComponent,
    EditorInspectorComponent,
    EditorTimelineComponent,
  ],
  templateUrl: "./editor.component.html",
  styleUrl: "./editor.component.css",
})
export class EditorComponent {
  readonly vm = inject(EditorState);
  beforeUnload(event: BeforeUnloadEvent): void {
    if (this.vm.dirty()) {
      event.preventDefault();
      event.returnValue = '';
    }
  }
}
