import { Injectable, inject } from "@angular/core";
import { ApiTransport } from "../../../core/http/api-transport.service";
import type { Schema } from "../../../core/contracts/api-types";
@Injectable({ providedIn: "root" })
export class AuthApi {
  private readonly api = inject(ApiTransport);
  register(body: Schema<"RegistrationDto">) {
    return this.api.post<{ accepted: boolean }>("/auth/register", body);
  }
  verify(token: string) {
    return this.api.post("/auth/verify", { token });
  }
  forgot(email: string) {
    return this.api.post("/auth/password/forgot", { email });
  }
  reset(body: Schema<"ResetDto">) {
    return this.api.post("/auth/password/reset", body);
  }
}
