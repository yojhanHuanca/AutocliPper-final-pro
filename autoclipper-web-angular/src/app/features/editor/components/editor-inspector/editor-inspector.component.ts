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
type EditorToolTab = "composition" | "captions" | "format";
const editorToolTabs: readonly EditorToolTab[] = ["composition", "captions", "format"];

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

  isToolTab(tab: string): boolean {
    return editorToolTabs.includes(tab as EditorToolTab);
  }

  inspectorTabId(tab: string): string {
    return `editor-inspector-tab-${tab}`;
  }

  onToolTabKeydown(event: KeyboardEvent): void {
    const current = editorToolTabs.indexOf(this.vm.tab() as EditorToolTab);
    if (current < 0) return;
    let next = current;
    if (event.key === "ArrowRight") next = (current + 1) % editorToolTabs.length;
    else if (event.key === "ArrowLeft") next = (current - 1 + editorToolTabs.length) % editorToolTabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = editorToolTabs.length - 1;
    else return;
    event.preventDefault();
    const tab = editorToolTabs[next];
    if (!tab) return;
    this.vm.tab.set(tab);
    requestAnimationFrame(() => document.getElementById(this.inspectorTabId(tab))?.focus());
  }
}
