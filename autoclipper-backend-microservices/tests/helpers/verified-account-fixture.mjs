// Permission tests only. This explicit SQL fixture does not claim SMTP/email
// verification; the account-upload and real-ASR suites exercise that real flow.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import argon2 from 'argon2';
import {client,password} from './accounts.mjs';
export async function verifiedAccountFixture(){
  assert.ok(process.env.IDENTITY_DATABASE_URL,'Verified account fixtures require the isolated test database role');const pool=new pg.Pool({connectionString:process.env.IDENTITY_DATABASE_URL,connectionTimeoutMillis:3000}),id=randomUUID(),email=`split-permission-fixture-${randomUUID()}@example.test`;
  try{const hash=await argon2.hash(password,{type:argon2.argon2id,memoryCost:65536,timeCost:3,parallelism:1});await pool.query('INSERT INTO users(id,email,name,password_hash,verified_at) VALUES($1,$2,$3,$4,now())',[id,email,'Explicit verified permission fixture',hash]);}finally{await pool.end();}
  const c=client();assert.equal((await c.request('/auth/csrf')).status,200);const login=await c.request('/auth/login','POST',{email,password});assert.equal(login.status,200);assert.equal(login.value.user.id,id);return{c,email,id};
}
