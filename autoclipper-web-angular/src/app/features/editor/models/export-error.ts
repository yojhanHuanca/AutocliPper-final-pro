/** Keep internal processor error codes out of creator-facing messages. */
export function exportFailureMessage(_errorCode: string | null | undefined): string {
  return 'La exportación no se completó. Si es la revisión actual, puedes solicitar otro intento.';
}
