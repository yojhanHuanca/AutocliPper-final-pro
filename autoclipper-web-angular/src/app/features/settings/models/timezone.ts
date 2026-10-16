export function isValidIanaTimezone(value: string): boolean {
  if (!value.trim()) return false;
  try { new Intl.DateTimeFormat('es-PE', { timeZone: value.trim() }); return true; }
  catch { return false; }
}
