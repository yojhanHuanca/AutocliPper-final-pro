import type { CanDeactivateFn } from '@angular/router';
import type { EditorState } from './state/editor.state';

export const editorChangesGuard: CanDeactivateFn<{ vm: EditorState }> = component => component.vm.confirmDiscard();
