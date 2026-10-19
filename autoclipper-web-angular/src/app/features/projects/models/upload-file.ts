import type { Schema } from '../../../core/contracts/api-types';

export type UploadPhase = 'hashing' | 'reserving' | 'transferring' | 'confirming';

export function uploadContentType(file: Pick<File, 'type' | 'name' | 'size'>): Schema<'UploadDto'>['contentType'] {
  if (!file.size || file.size > 100 * 1024 * 1024) throw new Error('El video debe pesar entre 1 byte y 100 MiB.');
  const formats: Record<string, Schema<'UploadDto'>['contentType']> = {
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska',
  };
  const type = file.type || formats[file.name.split('.').at(-1)?.toLowerCase() ?? ''];
  if (!Object.values(formats).includes(type as Schema<'UploadDto'>['contentType'])) {
    throw new Error('Formato no admitido. Usa MP4, WebM, MOV o MKV con su tipo de archivo correcto.');
  }
  return type as Schema<'UploadDto'>['contentType'];
}
