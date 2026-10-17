import { afterNextRender, Component, ElementRef, inject, Injector, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EditorState } from '../../state/editor.state';
import type { IndexedCaptionCue } from '../../models/caption-timeline';
import { IconComponent } from '../../../../shared/ui/icon/icon.component';

@Component({
  selector: 'ac-caption-cue-editor',
  imports: [FormsModule, DecimalPipe, IconComponent],
  templateUrl: './caption-cue-editor.component.html',
  styleUrl: './caption-cue-editor.component.css',
})
export class CaptionCueEditorComponent {
  readonly vm = inject(EditorState);
  readonly context = input<'timeline' | 'panel'>('panel');
  private readonly element: ElementRef<HTMLElement> = inject(ElementRef);
  private readonly injector = inject(Injector);
  id(part: string): string { return 'cue-' + this.context() + '-' + part; }
  contextName(): string { return this.context() === 'timeline' ? 'línea de tiempo' : 'panel de subtítulos'; }
  time(value: number): string { return Number.isFinite(value) ? String(value) : 'sin tiempo válido'; }
  label(cue: IndexedCaptionCue): string {
    return 'Frase ' + (cue.index + 1) + ' · ' + this.time(cue.startSeconds) + '–' + this.time(cue.endSeconds) + ' s · ' + (cue.text.slice(0, 70) || 'Sin texto');
  }
  showTimeControls(cue: IndexedCaptionCue): boolean {
    const { startSeconds: start, endSeconds: end } = this.vm.timeline();
    return this.vm.clipRangeUsable() &&
      Number.isFinite(cue.startSeconds) && Number.isFinite(cue.endSeconds) &&
      cue.startSeconds >= start && cue.startSeconds <= end && cue.endSeconds >= start && cue.endSeconds <= end;
  }
  remove(index: number): void {
    if (!this.vm.canChangeCaptions() || this.vm.captionSource !== 'user') return;
    this.vm.removeCue(index);
    afterNextRender(() => this.element.nativeElement.querySelector<HTMLElement>('[data-cue-focus]')?.focus(), { injector: this.injector });
  }
}
