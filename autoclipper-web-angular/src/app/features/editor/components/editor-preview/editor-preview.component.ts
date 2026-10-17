import { ViewEncapsulation, Component, ElementRef, effect, inject, viewChild } from "@angular/core";
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
  private consumedSeek = 0;
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
  }
}
