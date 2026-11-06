import { Injectable, signal } from '@angular/core';
export type ConfirmationOptions = { title: string; message: string; confirmLabel: string; danger?: boolean };
@Injectable({ providedIn: 'root' })
export class ConfirmationService {
  readonly pending = signal<ConfirmationOptions | null>(null);
  private resolve?: (approved: boolean) => void;
  ask(options: ConfirmationOptions): Promise<boolean> {
    if (this.pending()) return Promise.resolve(false);
    this.pending.set(options);
    return new Promise(resolve => { this.resolve = resolve; });
  }
  finish(approved: boolean): void {
    const resolve = this.resolve;
    this.resolve = undefined;
    this.pending.set(null);
    resolve?.(approved);
  }
}
