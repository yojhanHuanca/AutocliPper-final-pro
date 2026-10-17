import { Component, inject } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { DecimalPipe } from "@angular/common";
import { IconComponent } from "../../../../shared/ui/icon/icon.component";
import { EditorState } from "../../state/editor.state";
import { CaptionCueEditorComponent } from "../caption-cue-editor/caption-cue-editor.component";
@Component({
  selector: "ac-editor-captions",
  imports: [FormsModule, IconComponent, DecimalPipe, CaptionCueEditorComponent],
  templateUrl: "./editor-captions.component.html",
  styleUrl: './editor-captions.component.css',
})
export class EditorCaptionsComponent {
  readonly vm = inject(EditorState);
}
