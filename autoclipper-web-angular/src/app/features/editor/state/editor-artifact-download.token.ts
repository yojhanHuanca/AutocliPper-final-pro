import { InjectionToken } from '@angular/core';
import { downloadPrivateArtifact } from '../../../core/http/artifact-download';

export const EDITOR_ARTIFACT_DOWNLOAD = new InjectionToken<typeof downloadPrivateArtifact>('EDITOR_ARTIFACT_DOWNLOAD', {
  providedIn: 'root', factory: () => downloadPrivateArtifact,
});
