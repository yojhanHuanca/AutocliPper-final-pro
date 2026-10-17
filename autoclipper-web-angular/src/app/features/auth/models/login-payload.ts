import type { Schema } from "../../../core/contracts/api-types";

export function buildLoginPayload(
  email: string,
  password: string,
  factor = "",
): Schema<"LoginDto"> {
  return {
    email: email.trim(),
    password,
    ...(factor.trim() ? { factor: factor.trim() } : {}),
  };
}
