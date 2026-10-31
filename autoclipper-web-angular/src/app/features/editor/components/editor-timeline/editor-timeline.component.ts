import { afterNextRender, Component, ElementRef, inject, Injector, signal } from "@angular/core";
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
  readonly zoomPercent = signal(100);
  private readonly element: ElementRef<HTMLElement> = inject(ElementRef);
  private readonly injector = inject(Injector);
  private activeRangeHandle: 'start' | 'end' | null = null;
  private activeSelectionMove = false;
  private rangePointerOffsetX = 0;
  private selectionPointerStartX = 0;
  private selectionStartSeconds = 0;
  private selectionEndSeconds = 0;
  cueTabIndex(index: number): number {
    const cues = this.vm.timelineCues();
    const selected = this.vm.selectedCue()?.index;
    return index === (cues.some(cue => cue.index === selected) ? selected : cues[0]?.index) ? 0 : -1;
  }
  changeZoom(delta: -25 | 25): void { this.zoomPercent.update(value => Math.max(50, Math.min(200, value + delta))); }
  startRangeDrag(event: PointerEvent, handle: 'start' | 'end', track: HTMLElement): void {
    if (event.button !== 0 || !this.vm.canChangeCaptions()) return;
    event.preventDefault();
    this.activeRangeHandle = handle;
    this.vm.beginFormGesture();
    const handleBounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.rangePointerOffsetX = event.clientX - (handleBounds.left + handleBounds.width / 2);
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.updateRangeFromPointer(event.clientX - this.rangePointerOffsetX, track, handle);
  }
  moveRangeDrag(event: PointerEvent, track: HTMLElement): void {
    if (this.activeRangeHandle) this.updateRangeFromPointer(event.clientX - this.rangePointerOffsetX, track, this.activeRangeHandle);
    else if (this.activeSelectionMove) this.moveSelectionFromPointer(event.clientX, track);
  }
  startSelectionDrag(event: PointerEvent): void {
    if (event.button !== 0 || !this.vm.canChangeCaptions()) return;
    event.preventDefault();
    this.activeSelectionMove = true;
    this.vm.beginFormGesture();
    this.selectionPointerStartX = event.clientX;
    this.selectionStartSeconds = this.vm.spec.startSeconds;
    this.selectionEndSeconds = this.vm.spec.endSeconds;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }
  moveSelectionKeydown(event: KeyboardEvent): void {
    if (!this.vm.canChangeCaptions()) return;
    const duration = this.vm.sourceDuration();
    if (duration === null) return;
    const length = this.vm.spec.endSeconds - this.vm.spec.startSeconds;
    const step = event.shiftKey ? 1 : 0.1;
    const start = event.key === 'Home' ? 0
      : event.key === 'End' ? duration - length
      : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? this.vm.spec.startSeconds - step
      : event.key === 'ArrowRight' || event.key === 'ArrowUp' ? this.vm.spec.startSeconds + step : null;
    if (start === null) return;
    event.preventDefault();
    this.vm.setTimelineRange(start, start + length);
  }
  endRangeDrag(): void {
    if (this.activeRangeHandle || this.activeSelectionMove) this.vm.endFormGesture();
    this.activeRangeHandle = null;
    this.activeSelectionMove = false;
  }
  rangeHandleKeydown(event: KeyboardEvent, handle: 'start' | 'end'): void {
    const duration = this.vm.sourceDuration();
    if (!this.vm.canChangeCaptions() || duration === null) return;
    const minimum = handle === 'start' ? this.vm.timelineStartMin() : this.vm.timelineEndMin();
    const maximum = handle === 'start' ? this.vm.timelineStartMax() : this.vm.timelineEndMax();
    const current = handle === 'start' ? this.vm.spec.startSeconds : this.vm.spec.endSeconds;
    const next = event.key === 'Home' ? minimum : event.key === 'End' ? maximum
      : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? current - 0.1
      : event.key === 'ArrowRight' || event.key === 'ArrowUp' ? current + 0.1 : null;
    if (next === null) return;
    event.preventDefault();
    if (handle === 'start') this.vm.setTimelineStart(next);
    else this.vm.setTimelineEnd(next);
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
  private updateRangeFromPointer(clientX: number, track: HTMLElement, handle: 'start' | 'end'): void {
    const duration = this.vm.sourceDuration();
    const bounds = track.getBoundingClientRect();
    if (duration === null || bounds.width <= 0) return;
    const fraction = Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width));
    const seconds = fraction * duration;
    if (handle === 'start') this.vm.setTimelineStart(seconds);
    else this.vm.setTimelineEnd(seconds);
  }
  private moveSelectionFromPointer(clientX: number, track: HTMLElement): void {
    const duration = this.vm.sourceDuration();
    const bounds = track.getBoundingClientRect();
    if (duration === null || bounds.width <= 0) return;
    const delta = (clientX - this.selectionPointerStartX) / bounds.width * duration;
    const length = this.selectionEndSeconds - this.selectionStartSeconds;
    const start = Math.max(0, Math.min(duration - length, this.selectionStartSeconds + delta));
    this.vm.setTimelineRange(start, start + length);
  }
}
