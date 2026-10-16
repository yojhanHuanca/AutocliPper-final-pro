import { Component, inject } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { DatePipe } from "@angular/common";
import { IconComponent } from "../../../../shared/ui/icon/icon.component";
import { EditorState } from "../../state/editor.state";
@Component({
  selector: "ac-editor-captions",
  imports: [FormsModule, IconComponent],
  templateUrl: "./editor-captions.component.html",
  styleUrl: './editor-captions.component.css',
})
export class EditorCaptionsComponent {
  readonly vm = inject(EditorState);
}
