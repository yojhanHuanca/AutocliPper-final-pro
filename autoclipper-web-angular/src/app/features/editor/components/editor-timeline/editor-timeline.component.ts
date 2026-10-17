import { afterNextRender, Component, ElementRef, inject, Injector } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { DecimalPipe } from "@angular/common";
import { IconComponent } from "../../../../shared/ui/icon/icon.component";
import { EditorState } from "../../state/editor.state";
import { CaptionCueEditorComponent } from "../caption-cue-editor/caption-cue-editor.component";
@Component({
  selector: "ac-editor-timeline",
  imports: [DecimalPipe, FormsModule, IconComponent, CaptionCueEditorComponent],
  templateUrl: "./editor-timeline.component.html",
  styleUrl: "./editor-timeline.component.css",
})
export class EditorTimelineComponent {
  readonly vm = inject(EditorState);
  private readonly element: ElementRef<HTMLElement> = inject(ElementRef);
  private readonly injector = inject(Injector);
  cueTabIndex(index: number): number {
    const cues = this.vm.timelineCues();
    const selected = this.vm.selectedCue()?.index;
    return index === (cues.some(cue => cue.index === selected) ? selected : cues[0]?.index) ? 0 : -1;
  }
  cueKeydown(event: KeyboardEvent, index: number): void {
    const cues = this.vm.timelineCues();
    const position = cues.findIndex(cue => cue.index === index);
    const next = event.key === 'Home' ? cues[0] : event.key === 'End' ? cues.at(-1)
      : event.key === 'ArrowLeft' ? cues[Math.max(0, position - 1)]
      : event.key === 'ArrowRight' ? cues[Math.min(cues.length - 1, position + 1)] : null;
    if (!next) return;
    event.preventDefault();
    this.vm.selectCue(next.index);
    afterNextRender(() => this.element.nativeElement.querySelector<HTMLElement>('[data-cue-index="' + next.index + '"]')?.focus(), { injector: this.injector });
  }
}
