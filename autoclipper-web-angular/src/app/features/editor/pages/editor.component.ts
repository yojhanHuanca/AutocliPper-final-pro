import { DecimalPipe } from '@angular/common';
import { ConfirmationService } from '../../../shared/ui/confirmation/confirmation.service';
import { DatePipe } from "@angular/common";
import { ViewEncapsulation, Component, inject } from "@angular/core";
import { IconComponent } from "../../../shared/ui/icon/icon.component";
import { RouterLink } from '@angular/router';
import { EditorState } from "../state/editor.state";
import { EditorRailComponent } from "../components/editor-rail/editor-rail.component";
import { EditorPreviewComponent } from "../components/editor-preview/editor-preview.component";
import { EditorInspectorComponent } from "../components/editor-inspector/editor-inspector.component";
import { EditorTimelineComponent } from "../components/editor-timeline/editor-timeline.component";
@Component({
  encapsulation: ViewEncapsulation.None,
  selector: "ac-editor",
  host: { '(window:beforeunload)': 'beforeUnload($event)' },
  providers: [EditorState],
  imports: [
    RouterLink,
    DatePipe,
    DecimalPipe,
    IconComponent,
    EditorRailComponent,
    EditorPreviewComponent,
    EditorInspectorComponent,
    EditorTimelineComponent,
  ],
  templateUrl: "./editor.component.html",
  styleUrl: "./editor.component.css",
})
export class EditorComponent {
  readonly vm = inject(EditorState);
  private readonly confirmation = inject(ConfirmationService);
  async exportRevision(): Promise<void> {
    if (this.vm.busy()) return;
    if (this.vm.currentRenderPending() && !this.vm.dirty()) { await this.vm.render(); return; }
    const approved = await this.confirmation.ask({
      title: this.vm.dirty() ? 'Guardar y exportar el clip' : 'Exportar esta revisión',
      message: `Se generará un MP4 de ${(this.vm.spec.endSeconds - this.vm.spec.startSeconds).toFixed(1)} segundos con el encuadre y los subtítulos de esta revisión. Podrás descargarlo o revisarlo antes de compartir.`,
      confirmLabel: this.vm.dirty() ? 'Guardar y exportar' : 'Generar MP4',
    });
    if (!approved || this.vm.busy()) return;
    if (this.vm.dirty()) await this.vm.saveAndRender(); else await this.vm.render();
  }
  beforeUnload(event: BeforeUnloadEvent): void {
    if (this.vm.dirty()) {
      event.preventDefault();
      event.returnValue = '';
    }
  }
}
