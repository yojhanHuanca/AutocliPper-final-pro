import { OAuth2Client } from "google-auth-library";
import { HttpException, UnauthorizedException } from "@nestjs/common";
import { verifiedGoogleIdentity } from "../domain/google-identity.js";

export class GoogleIdentityAdapter {
  readonly clientId = process.env["GOOGLE_CLIENT_ID"]?.trim() || undefined;
  private readonly client = new OAuth2Client({ transporterOptions: { timeout: 5000, retry: false } });
  constructor() {
    if (this.clientId && !/^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(this.clientId)) throw new Error("Invalid configuration: GOOGLE_CLIENT_ID");
  }
  configuredClientId() {
    if (!this.clientId) throw new HttpException({ code: "GOOGLE_NOT_CONFIGURED" }, 503);
    return this.clientId;
  }
  async verify(credential: string, nonce: string) {
    const audience = this.configuredClientId();
    if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(credential)) throw new UnauthorizedException();
    let identity;
    try {
      const ticket = await this.client.verifyIdToken({ idToken: credential, audience });
      identity = verifiedGoogleIdentity(ticket.getPayload(), nonce, audience);
    } catch (error) {
      // Never expose a credential or SDK diagnostic in the HTTP response/logs.
      if (error instanceof Error && error.name === "GaxiosError") throw new HttpException("Google verification unavailable",503);
      throw new UnauthorizedException();
    }
    if (!identity) throw new UnauthorizedException();
    return identity;
  }
}
