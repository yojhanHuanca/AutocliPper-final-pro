import { Component, ElementRef, effect, inject, viewChild } from '@angular/core';
import { ConfirmationService } from './confirmation.service';
@Component({
  selector: 'ac-confirmation',
  template: `<dialog #dialog class="studio-dialog" aria-labelledby="studio-confirm-title" aria-describedby="studio-confirm-message" (cancel)="cancel($event)" (click)="backdrop($event)">
    @if (confirmation.pending(); as item) {
      <div class="studio-dialog-symbol" aria-hidden="true">{{ item.danger ? '!' : '↗' }}</div>
      <h2 id="studio-confirm-title">{{ item.title }}</h2>
      <p id="studio-confirm-message">{{ item.message }}</p>
      <div class="studio-dialog-actions"><button class="button" type="button" autofocus (click)="confirmation.finish(false)">Volver</button><button class="button primary" [class.danger]="item.danger" type="button" (click)="confirmation.finish(true)">{{ item.confirmLabel }}</button></div>
    }
  </dialog>`,
})
export class ConfirmationComponent {
  readonly confirmation = inject(ConfirmationService);
  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('dialog');
  constructor() {
    effect(() => {
      const element = this.dialog()?.nativeElement;
      if (!element) return;
      if (this.confirmation.pending() && !element.open) element.showModal();
      else if (!this.confirmation.pending() && element.open) element.close();
    });
  }
  cancel(event: Event) { event.preventDefault(); this.confirmation.finish(false); }
  backdrop(event: MouseEvent) { if (event.target === this.dialog()?.nativeElement) { const r=this.dialog()!.nativeElement.getBoundingClientRect(); if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom) this.confirmation.finish(false); } }
}
