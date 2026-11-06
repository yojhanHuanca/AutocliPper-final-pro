import { ViewEncapsulation, Component, inject } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { DatePipe, DecimalPipe } from "@angular/common";
import { IconComponent } from "../../../../shared/ui/icon/icon.component";
import { EditorState } from "../../state/editor.state";
@Component({
  encapsulation: ViewEncapsulation.None,
  selector: "ac-editor-rail",
  imports: [IconComponent],
  templateUrl: "./editor-rail.component.html",
  styleUrl: "./editor-rail.component.css",
})
export class EditorRailComponent {
  readonly vm = inject(EditorState);
  selectTab(tab: string): void {
    this.vm.tab.set(tab);
    requestAnimationFrame(() => document.getElementById("editor-inspector-panel")?.focus());
  }
}
