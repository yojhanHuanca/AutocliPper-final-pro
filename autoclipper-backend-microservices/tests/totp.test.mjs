import { test } from "node:test";
import assert from "node:assert/strict";
import { totpStep } from "../apps/autoclipper-identity-service/dist/domain/totp.js";
test("TOTP matches the RFC 6238 SHA-1 vector and rejects an expired/reformatted code", () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  assert.equal(totpStep(secret, "287082", 59000), 1);
  assert.equal(totpStep(secret, "287082", 119000), null);
  assert.equal(totpStep(secret, "0287082", 59000), null);
});
