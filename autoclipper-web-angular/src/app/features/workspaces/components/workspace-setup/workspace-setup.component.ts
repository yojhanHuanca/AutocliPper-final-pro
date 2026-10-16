import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { WorkspaceStore } from '../../data-access/workspace.store';
import { errorMessage } from '../../../../core/http/api-error';
import { IconComponent } from '../../../../shared/ui/icon/icon.component';
@Component({
  selector: 'ac-workspace-setup',
  imports: [FormsModule, IconComponent],
  templateUrl: './workspace-setup.component.html',
})
export class WorkspaceSetupComponent {
  private readonly workspace = inject(WorkspaceStore);
  name = '';
  readonly busy = signal(false);
  readonly error = signal('');
  async create(): Promise<void> {
    if (this.busy() || !this.name.trim()) return;
    this.busy.set(true); this.error.set('');
    try { await this.workspace.createPersonal(this.name.trim()); }
    catch (error) { this.error.set(errorMessage(error)); }
    finally { this.busy.set(false); }
  }
}
