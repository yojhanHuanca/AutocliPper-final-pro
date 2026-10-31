import { ViewEncapsulation, Component, ElementRef, effect, inject, signal, viewChild } from "@angular/core";
import { DecimalPipe } from "@angular/common";
import { IconComponent } from "../../../../shared/ui/icon/icon.component";
import { EditorState } from "../../state/editor.state";
@Component({
  encapsulation: ViewEncapsulation.None,
  selector: "ac-editor-preview",
  imports: [IconComponent, DecimalPipe],
  templateUrl: "./editor-preview.component.html",
  styleUrl: "./editor-preview.component.css",
})
export class EditorPreviewComponent {
  readonly vm = inject(EditorState);
  readonly video = viewChild<ElementRef<HTMLVideoElement>>('renderVideo');
  readonly sourceVideo = viewChild<ElementRef<HTMLVideoElement>>('sourceVideo');
  readonly playingSelection = signal(false);
  readonly draggingFrame = signal(false);
  private framePointerOffsetX = 0;
  private framePointerOffsetY = 0;
  private consumedSeek = 0;
  private consumedSourceSeek = 0;
  constructor() {
    effect(() => {
      const request = this.vm.previewSeek();
      const video = this.video()?.nativeElement;
      if (!request || !video || request.sequence <= this.consumedSeek) return;
      this.consumedSeek = request.sequence;
      if (!this.vm.previewSyncReady() || request.token !== this.vm.previewSession()?.token) return;
      try {
        video.currentTime = request.seconds;
        this.vm.previewTimeChanged(request.token, video.currentTime);
      } catch { this.vm.previewFailed(request.token); }
    });
    effect(() => {
      const request = this.vm.sourceSeek();
      const video = this.sourceVideo()?.nativeElement;
      if (!request || !video || request.sequence <= this.consumedSourceSeek) return;
      this.consumedSourceSeek = request.sequence;
      if (request.token !== this.vm.sourcePlaybackSession()?.token) return;
      try { video.currentTime = request.seconds; this.vm.sourceTimeChanged(request.token, video.currentTime); }
      catch { this.vm.sourcePlaybackFailed(request.token); }
    });
  }

  async toggleSelectionPlayback(token: number): Promise<void> {
    const video = this.sourceVideo()?.nativeElement;
    const session = this.vm.sourcePlaybackSession();
    if (!video || !session || session.token !== token || !this.vm.clipRangeUsable()) return;
    if (this.playingSelection()) {
      video.pause();
      this.playingSelection.set(false);
      return;
    }
    const { startSeconds, endSeconds } = this.vm.spec;
    if (video.currentTime < startSeconds || video.currentTime >= endSeconds) video.currentTime = startSeconds;
    try {
      await video.play();
      this.playingSelection.set(!video.paused);
    } catch {
      this.playingSelection.set(false);
    }
  }

  sourceTimeUpdate(token: number, video: HTMLVideoElement): void {
    const session = this.vm.sourcePlaybackSession();
    if (!session || session.token !== token) return;
    if (this.playingSelection() && video.currentTime >= this.vm.spec.endSeconds) {
      video.pause();
      video.currentTime = this.vm.spec.endSeconds;
      this.playingSelection.set(false);
    }
    this.vm.sourceTimeChanged(token, video.currentTime);
  }

  sourcePlaybackPaused(): void { this.playingSelection.set(false); }

  sourcePlaybackFailed(token: number): void {
    this.playingSelection.set(false);
    this.vm.sourcePlaybackFailed(token);
  }

  startFrameDrag(event: PointerEvent, canvas: HTMLElement): void {
    if (event.button !== 0 || !this.canMoveFrame()) return;
    event.preventDefault();
    const canvasBounds = canvas.getBoundingClientRect();
    if (canvasBounds.width <= 0 || canvasBounds.height <= 0) return;
    const handle = event.currentTarget as HTMLElement;
    const bounds = handle.getBoundingClientRect();
    this.framePointerOffsetX = event.clientX - (bounds.left + bounds.width / 2);
    this.framePointerOffsetY = event.clientY - (bounds.top + bounds.height / 2);
    handle.setPointerCapture(event.pointerId);
    this.vm.beginFormGesture();
    this.draggingFrame.set(true);
  }

  moveFrameDrag(event: PointerEvent, canvas: HTMLElement): void {
    if (!this.draggingFrame() || !this.canMoveFrame()) return;
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const x = (event.clientX - this.framePointerOffsetX - bounds.left) / bounds.width;
    const y = (event.clientY - this.framePointerOffsetY - bounds.top) / bounds.height;
    this.setFrame(x, y);
  }

  endFrameDrag(): void {
    if (this.draggingFrame()) this.vm.endFormGesture();
    this.draggingFrame.set(false);
  }

  frameAnchorKeydown(event: KeyboardEvent): void {
    if (!this.canMoveFrame()) return;
    const step = event.shiftKey ? 0.05 : 0.01;
    let x = Number(this.vm.cropX);
    let y = Number(this.vm.cropY);
    if (event.key === 'ArrowLeft') x -= step;
    else if (event.key === 'ArrowRight') x += step;
    else if (event.key === 'ArrowUp') y -= step;
    else if (event.key === 'ArrowDown') y += step;
    else if (event.key === 'Home') { x = 0.5; y = 0.5; }
    else return;
    event.preventDefault();
    this.setFrame(x, y);
  }

  private canMoveFrame(): boolean { return this.vm.canChangeCaptions() && this.vm.spec.aspect !== 'source'; }

  private setFrame(x: number, y: number): void {
    const nextX = Number(Math.max(0, Math.min(1, x)).toFixed(2));
    const nextY = Number(Math.max(0, Math.min(1, y)).toFixed(2));
    if (nextX === this.vm.cropX && nextY === this.vm.cropY) return;
    this.vm.cropX = nextX;
    this.vm.cropY = nextY;
    this.vm.touchForm();
  }
}
