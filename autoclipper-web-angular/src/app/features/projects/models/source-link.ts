/** Syntax feedback only: this never establishes provider support or fetch safety. */
export function sourceLinkFeedback(value: string): { valid: boolean; message: string } {
  const text = value.trim();
  if (!text) return { valid: false, message: '' };
  if (text.length > 2048) return { valid: false, message: 'El enlace es demasiado largo (máximo 2048 caracteres).' };
  try {
    const url = new URL(text);
    if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password)
      return { valid: false, message: 'Usa un enlace completo http o https, sin credenciales.' };
    return { valid: true, message: 'El formato del enlace es válido. La importación todavía no está disponible.' };
  } catch {
    return { valid: false, message: 'Incluye el enlace completo, empezando por https://.' };
  }
}
