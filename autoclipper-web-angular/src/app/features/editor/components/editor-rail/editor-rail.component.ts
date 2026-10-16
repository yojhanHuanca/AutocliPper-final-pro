import { ViewEncapsulation, Component, inject } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { DatePipe, DecimalPipe } from "@angular/common";
import { RouterLink } from "@angular/router";
import { IconComponent } from "../../../../shared/ui/icon/icon.component";
import { EditorState } from "../../state/editor.state";
@Component({
  encapsulation: ViewEncapsulation.None,
  selector: "ac-editor-rail",
  imports: [RouterLink, IconComponent],
  templateUrl: "./editor-rail.component.html",
  styleUrl: "./editor-rail.component.css",
})
export class EditorRailComponent {
  readonly vm = inject(EditorState);
}
