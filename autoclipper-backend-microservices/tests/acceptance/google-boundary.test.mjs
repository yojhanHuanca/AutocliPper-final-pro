import {test} from "node:test";
import assert from "node:assert/strict";
import {client} from "../helpers/accounts.mjs";

test("Google HTTP boundary requires CSRF and refuses malformed credentials without creating a session",async () => {
  const c=client();
  const providers=await c.request("/auth/providers");
  assert.equal(providers.status,200);
  assert.equal(typeof providers.value.google.configured,"boolean");
  assert.equal((await c.request("/auth/google/challenge","POST",{purpose:"sign_in"})).status,403);
  await c.request("/auth/csrf");
  const challenge=await c.request("/auth/google/challenge","POST",{purpose:"sign_in"});
  if(!providers.value.google.configured){
    assert.equal(challenge.status,503);
    assert.equal(challenge.value.code,"GOOGLE_NOT_CONFIGURED");
  } else {
    assert.equal(challenge.status,200);
    assert.match(challenge.value.clientId,/\.apps\.googleusercontent\.com$/);
    assert.match(challenge.value.nonce,/^[A-Za-z0-9_-]{43}$/);
    assert.equal(challenge.value.expiresInSeconds,300);
    assert.equal((await c.request("/auth/google/challenge","POST",{purpose:"link"})).status,401);
    const invalid=await c.request("/auth/google","POST",{credential:"deliberately-invalid-credential"});
    assert.equal(invalid.status,401);
    assert.equal(JSON.stringify(invalid.value).includes("deliberately-invalid"),false);
  }
  assert.equal((await c.request("/auth/me")).status,401);
  assert.equal(Boolean(c.jar.get("autoclipper_access")),false);
});
