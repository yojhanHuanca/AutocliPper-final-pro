import { InjectionToken } from '@angular/core';

export const EDITOR_DISCARD_CONFIRMATION = new InjectionToken<() => boolean>('editorDiscardConfirmation', {
  providedIn: 'root',
  factory: () => () => window.confirm('Hay cambios sin guardar en este clip. ¿Quieres descartarlos y continuar?'),
});
