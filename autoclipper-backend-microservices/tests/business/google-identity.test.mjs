import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, randomUUID } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import { URI } from "otpauth";
import { configureHttp } from "@autoclipper/observability";
import { AppModule } from "../../apps/autoclipper-identity-service/dist/app.module.js";
import { IdentityService } from "../../apps/autoclipper-identity-service/dist/application/identity.service.js";
import { client, emailToken, password } from "../helpers/accounts.mjs";

test("Google integration with explicit local signing fixture, real PostgreSQL Redis SMTP and HTTP (not external Google acceptance)", {timeout:90000}, async t => {
  Object.assign(process.env,{
    NODE_ENV:"test", HOST:"127.0.0.1",PORT:"3102",COOKIE_AUTH:"true",CORS_ORIGIN:"http://localhost:4200",
    DATABASE_URL:process.env.IDENTITY_DATABASE_URL,
    GOOGLE_CLIENT_ID:"123456-integration-fixture.apps.googleusercontent.com",
  });
  const app=await NestFactory.create(AppModule,{logger:false});
  const service=app.get(IdentityService);
  const key=generateKeyPairSync("rsa",{modulusLength:2048});
  // This fixture is confined to this in-process test application. No test key
  // configuration exists in the shipped service or its production adapter.
  service.google.client.getFederatedSignonCertsAsync=async()=>({certs:{fixture:key.publicKey.export({type:"spki",format:"pem"})},format:"PEM"});
  configureHttp(app,service.config,"identity-google-test");
  await app.listen(0,"127.0.0.1");
  const base=await app.getUrl();
  // Give each run a documentation-only IPv6 address through the trusted gateway
  // headers. Repeated local runs must not consume another run's rate-limit keys.
  const fixtureIp=`2001:db8:${randomUUID().replaceAll("-","").match(/.{4}/g).slice(0,6).join(":")}`;
  const gatewayHeaders={"x-service-token":service.config.INTERNAL_TOKEN,"x-client-ip":fixtureIp};
  const c=client(base,gatewayHeaders), stranger=client(base,gatewayHeaders), passwordAccount=client(base,gatewayHeaders);
  const subject=`fixture-${randomUUID()}`,email=`google-${randomUUID()}@gmail.com`;
  const credential=(nonce,overrides={})=>{
    const now=Math.floor(Date.now()/1000);
    const payload={sub:subject,email,email_verified:true,name:"Explicit Google test fixture",nonce,iat:now,exp:now+300,aud:process.env.GOOGLE_CLIENT_ID,iss:"https://accounts.google.com",...overrides};
    const parts=[Buffer.from(JSON.stringify({alg:"RS256",kid:"fixture"})).toString("base64url"),Buffer.from(JSON.stringify(payload)).toString("base64url")].join(".");
    return `${parts}.${sign("RSA-SHA256",Buffer.from(parts),key.privateKey).toString("base64url")}`;
  };
  const challenge=async(c,purpose="sign_in")=>{
    const response=await c.request("/auth/google/challenge","POST",{purpose});
    assert.equal(response.status,200);
    return response.value.nonce;
  };
  let id,recovery;
  const fixtureIds=[];
  try {
    await c.request("/auth/csrf");await stranger.request("/auth/csrf");
    await t.test("registration creates a stable external identity; nonce and credential cannot be replayed",async()=>{
      const nonce=await challenge(c);
      const token=credential(nonce);
      const response=await c.request("/auth/google","POST",{credential:token});
      assert.equal(response.status,200);assert.ok(response.value.user);
      id=response.value.user.id;fixtureIds.push(id);
      assert.equal((await c.request("/auth/me")).value.id,id);
      assert.equal((await c.request("/auth/google","POST",{credential:token})).status,401);
      const linked=await service.pool.query("SELECT subject,user_id FROM external_identities WHERE user_id=$1",[id]);
      assert.equal(linked.rows[0].subject,subject);
      const changed=await c.request("/auth/google","POST",{credential:credential(await challenge(c),{email:`changed-${randomUUID()}@gmail.com`})});
      assert.equal(changed.value.user.id,id);assert.equal(changed.value.user.email,email);
    });
    await t.test("email collision requires explicit linking and link requires password with a user-bound nonce",async()=>{
      const collision=await stranger.request("/auth/google","POST",{credential:credential(await challenge(stranger),{sub:`other-${randomUUID()}`})});
      assert.equal(collision.status,409);assert.equal(collision.value.code,"ACCOUNT_LINK_REQUIRED");
      assert.equal((await stranger.request("/auth/me")).status,401);
      // Set a local password through the actual recovery flow, not direct SQL.
      await c.request("/auth/password/forgot","POST",{email});
      const token=await emailToken(email,"reset");
      assert.equal((await c.request("/auth/password/reset","POST",{token,password})).status,200);
      assert.equal((await c.request("/auth/login","POST",{email,password})).status,200);
      const nonce=await challenge(c,"link");
      assert.equal((await c.request("/auth/google/link","POST",{password:"wrong",credential:credential(nonce)})).status,401);
      assert.equal((await c.request("/auth/google/link","POST",{password,credential:credential(await challenge(c,"link"))})).status,200);
      const mismatch=await challenge(c,"sign_in");
      assert.equal((await c.request("/auth/google/link","POST",{password,credential:credential(mismatch)})).status,401);
    });
    await t.test("Google login honors local 2FA and recovery replay rules",async()=>{
      const setup=await c.request("/auth/2fa/setup","POST",{password});
      assert.equal(setup.status,200);
      const code=URI.parse(setup.value.otpauthUri).generate();
      const enabled=await c.request("/auth/2fa/enable","POST",{password,code});
      assert.equal(enabled.status,200);recovery=enabled.value.recoveryCodes;
      assert.equal((await c.request("/auth/google","POST",{credential:credential(await challenge(c))})).status,401);
      assert.equal((await c.request("/auth/google","POST",{credential:credential(await challenge(c)),factor:recovery[0]})).status,200);
      assert.equal((await c.request("/auth/google","POST",{credential:credential(await challenge(c)),factor:recovery[0]})).status,401);
    });
    await t.test("third-party email requires independent SMTP verification before issuing a session",async()=>{
      const thirdEmail=`google-${randomUUID()}@example.test`,thirdSubject=`fixture-${randomUUID()}`;
      const proof={email:thirdEmail,sub:thirdSubject};
      const result=await stranger.request("/auth/google","POST",{credential:credential(await challenge(stranger),proof)});
      assert.equal(result.status,200);assert.equal(result.value.verificationRequired,true);
      assert.equal((await stranger.request("/auth/me")).status,401);
      const token=await emailToken(thirdEmail,"verify");
      assert.equal((await stranger.request("/auth/verify","POST",{token})).status,200);
      const login=await stranger.request("/auth/google","POST",{credential:credential(await challenge(stranger),proof)});
      assert.equal(login.status,200);fixtureIds.push(login.value.user.id);
      assert.equal((await stranger.request("/auth/me")).value.id,login.value.user.id);
      const conflicting=await stranger.request("/auth/google/link","POST",{password,credential:credential(await challenge(stranger,"link"))});
      assert.equal(conflicting.status,401);
    });
    await t.test("an existing verified password account links explicitly; another account cannot take its Google identity",async()=>{
      const existingEmail=`password-${randomUUID()}@example.test`,linkedSubject=`fixture-${randomUUID()}`;
      await passwordAccount.request("/auth/csrf");
      assert.equal((await passwordAccount.request("/auth/register","POST",{email:existingEmail,password,name:"Password account fixture"})).status,202);
      assert.equal((await passwordAccount.request("/auth/verify","POST",{token:await emailToken(existingEmail,"verify")})).status,200);
      const initial=await passwordAccount.request("/auth/login","POST",{email:existingEmail,password});
      assert.equal(initial.status,200);fixtureIds.push(initial.value.user.id);
      const proof={sub:linkedSubject,email:existingEmail};
      assert.equal((await passwordAccount.request("/auth/google/link","POST",{password,credential:credential(await challenge(passwordAccount,"link"),proof)})).status,200);
      const federated=await passwordAccount.request("/auth/google","POST",{credential:credential(await challenge(passwordAccount),proof)});
      assert.equal(federated.status,200);assert.equal(federated.value.user.id,initial.value.user.id);
      assert.equal((await c.request("/auth/google/link","POST",{password,factor:recovery[1],credential:credential(await challenge(c,"link"),proof)})).status,409);
      const bound=await challenge(passwordAccount,"link");
      c.jar.set("autoclipper_google_nonce",passwordAccount.jar.get("autoclipper_google_nonce"));
      assert.equal((await c.request("/auth/google/link","POST",{password,factor:recovery[1],credential:credential(bound,proof)})).status,401);
    });
  } finally {
    if(fixtureIds.length)await service.pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])",[fixtureIds]);
    await app.close();
  }
});
