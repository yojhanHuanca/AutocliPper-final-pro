import { HttpErrorResponse } from "@angular/common/http";
import type { Schema } from "../contracts/api-types";
export function errorMessage(error: unknown): string {
  if (!(error instanceof HttpErrorResponse))
    return error instanceof Error
      ? error.message
      : "No se pudo completar la operación.";
  if (error.status === 0)
    return "No pudimos conectar con el servidor. Revisa la conexión y vuelve a intentarlo.";
  if (error.status === 412)
    return "Existe una versión más reciente. Recarga antes de guardar; tus cambios siguen en el formulario.";
  if (error.status === 401)
    return "La sesión terminó o las credenciales no son válidas.";
  if (
    error.status === 403 &&
    error.error?.code === "MANUAL_PROCESSING_NOT_ADMITTED"
  )
    return "Este entorno no admite nuevas exportaciones manuales. Tus revisiones y descargas anteriores siguen disponibles. La política la gestiona el servidor.";
  if (error.status === 403)
    return "Tu cuenta no tiene permiso para esta operación.";
  if (error.status === 429)
    return "Demasiadas solicitudes. Espera antes de volver a intentarlo.";
  const body = error.error as Partial<Schema<"ErrorResponse">> | null;
  return `No se pudo completar la operación (${body?.code ?? error.status}).${body?.correlationId ? ` Referencia: ${body.correlationId}` : ""}`;
}
