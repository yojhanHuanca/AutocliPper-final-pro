import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { GoogleIdentityAdapter } from "../apps/autoclipper-identity-service/dist/infrastructure/google.js";
import { verifiedGoogleIdentity } from "../apps/autoclipper-identity-service/dist/domain/google-identity.js";

const clientId = "123456-unit-test.apps.googleusercontent.com";
const nonce = "explicit-unit-test-nonce";
const now = Math.floor(Date.now() / 1000);
const claims = {sub:"unit-subject",email:"unit@gmail.com",email_verified:true,name:"Unit test",nonce,iat:now,exp:now+300,aud:clientId,iss:"https://accounts.google.com"};

test("Google SDK verifies local test signatures, audience, issuer and nonce", async () => {
  const old = process.env.GOOGLE_CLIENT_ID;
  try {
    process.env.GOOGLE_CLIENT_ID=clientId;
    const adapter = new GoogleIdentityAdapter();
    const key = generateKeyPairSync("rsa",{modulusLength:2048});
    // Explicit unit-only certificate fixture; production always fetches Google's keys.
    adapter.client.getFederatedSignonCertsAsync = async () => ({certs:{fixture:key.publicKey.export({type:"spki",format:"pem"})},format:"PEM"});
    const jwt = (payload, signingKey=key.privateKey) => {
      const parts = [Buffer.from(JSON.stringify({alg:"RS256",kid:"fixture"})).toString("base64url"),Buffer.from(JSON.stringify(payload)).toString("base64url")].join(".");
      return `${parts}.${sign("RSA-SHA256",Buffer.from(parts),signingKey).toString("base64url")}`;
    };
    assert.equal((await adapter.verify(jwt(claims),nonce)).subject,"unit-subject");
    for (const altered of [{aud:"different-client"},{iss:"https://attacker.test"},{exp:now-1},{nonce:"different-nonce"},{email_verified:false},{azp:"different-client"}]) {
      await assert.rejects(adapter.verify(jwt({...claims,...altered}),nonce),error=>error.getStatus()===401);
    }
    const foreign=generateKeyPairSync("rsa",{modulusLength:2048});
    await assert.rejects(adapter.verify(jwt(claims,foreign.privateKey),nonce),error=>error.getStatus()===401);
    await assert.rejects(adapter.verify("invalid-token",nonce),error=>error.getStatus()===401);
    delete process.env.GOOGLE_CLIENT_ID;
    assert.throws(()=>new GoogleIdentityAdapter().configuredClientId(),error=>error.getStatus()===503);
  } finally {
    if(old===undefined)delete process.env.GOOGLE_CLIENT_ID;else process.env.GOOGLE_CLIENT_ID=old;
  }
});

test("Google email authority requires Gmail or verified Workspace; stale nonce credentials are rejected", () => {
  assert.equal(verifiedGoogleIdentity(claims,nonce,clientId).authoritativeEmail,true);
  assert.equal(verifiedGoogleIdentity({...claims,email:"unit@example.test"},nonce,clientId).authoritativeEmail,false);
  assert.equal(verifiedGoogleIdentity({...claims,email:"unit@example.test",hd:"example.test"},nonce,clientId).authoritativeEmail,true);
  assert.equal(verifiedGoogleIdentity({...claims,iat:now-601},nonce,clientId),undefined);
});
