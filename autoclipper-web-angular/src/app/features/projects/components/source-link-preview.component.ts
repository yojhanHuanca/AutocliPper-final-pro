import { Component, computed, output, signal } from '@angular/core';
import { sourceLinkFeedback } from '../models/source-link';

@Component({
  selector: 'ac-source-link-preview',
  template: `
    <div class="source-link-preview">
      <div class="source-link-heading"><span class="source-kick-label">Plataformas previstas</span><span class="source-pending">Aún no disponible</span></div>
      <h3>Tu video también empieza con un enlace.</h3>
      <p>Estamos preparando los enlaces de YouTube, Kick y Twitch. Por ahora, sube un archivo de video para crear tu clip.</p>
      <ul class="source-provider-status" aria-label="Disponibilidad por plataforma"><li><strong>YouTube</strong><span>Pendiente de conexión</span></li><li><strong>Kick</strong><span>Pendiente de conexión</span></li><li><strong>Twitch</strong><span>Pendiente de conexión</span></li></ul><label for="source-video-link">Enlace del video</label>
      <input id="source-video-link" type="url" autocomplete="off" spellcheck="false" placeholder="https://…" maxlength="2049"
        [value]="value()" (input)="update($event)" aria-describedby="source-link-help source-link-feedback"
        [attr.aria-invalid]="value().trim() && !feedback().valid ? 'true' : null" />
      <p id="source-link-help" class="source-link-help">Puedes comprobar el formato. El enlace no se envía ni se guarda; no inicia una importación.</p>
      <p id="source-link-feedback" class="source-link-feedback" [class.invalid]="value().trim() && !feedback().valid" aria-live="polite">{{ feedback().message }}</p>
      <div class="source-link-footer"><span>¿Tienes el video en tu equipo?</span><button class="button" type="button" (click)="useFile.emit()">Subir un archivo</button></div>
    </div>
  `,
})
export class SourceLinkPreviewComponent {
  readonly useFile = output<void>();
  readonly value = signal('');
  readonly feedback = computed(() => sourceLinkFeedback(this.value()));
  update(event: Event): void { this.value.set((event.target as HTMLInputElement).value); }
}
