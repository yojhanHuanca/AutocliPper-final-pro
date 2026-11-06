// Starts an isolated login-only development stack in the repository's ignored .local directory.
import {existsSync,closeSync,openSync} from 'node:fs';
import {mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import net from 'node:net';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import pg from 'pg';
import argon2 from 'argon2';
import {drizzle} from 'drizzle-orm/node-postgres';
import {migrate} from 'drizzle-orm/node-postgres/migrator';

const run=promisify(execFile),root=resolve(fileURLToPath(new URL('../..',import.meta.url))),local=join(root,'.local','native-login'),dataDir=join(local,'postgres'),configPath=join(local,'config.json'),statePath=join(local,'state.json');
const pgBin=process.env.AUTOCLIPPER_PG_BIN??'C:\\Program Files\\PostgreSQL\\18\\bin',initdb=join(pgBin,'initdb.exe'),pgCtl=join(pgBin,'pg_ctl.exe');
const selectedPort=(name,fallback)=>{const value=Number(process.env[name]??fallback);if(!Number.isInteger(value)||value<1024||value>65535)throw new Error(`Invalid ${name}`);return value;};
const pgPort=selectedPort('AUTOCLIPPER_NATIVE_PG_PORT',55432),redisPort=selectedPort('AUTOCLIPPER_NATIVE_REDIS_PORT',16379),identityPort=selectedPort('AUTOCLIPPER_NATIVE_IDENTITY_PORT',3002),gatewayPort=selectedPort('AUTOCLIPPER_NATIVE_GATEWAY_PORT',3000);
const secret=()=>randomBytes(32).toString('hex');
const url=(role,password,database='autoclipper_identity')=>`postgresql://${role}:${encodeURIComponent(password)}@127.0.0.1:${pgPort}/${database}`;
async function reachable(address){try{const response=await fetch(address,{signal:AbortSignal.timeout(900)});return response.status;}catch{return 0;}}
async function waitHttp(address){for(let attempt=0;attempt<360;attempt++){const status=await reachable(address);if(status===200)return;await new Promise(resolve=>setTimeout(resolve,500));}throw new Error(`Native login service did not become ready: ${address}`);}
async function portOpen(port){return new Promise(resolve=>{const socket=net.connect({host:'127.0.0.1',port});socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',()=>resolve(false));socket.setTimeout(800,()=>{socket.destroy();resolve(false);});});}
function launch(name,args,env){const log=openSync(join(local,`${name}.log`),'a');const child=spawn(process.execPath,args,{cwd:root,env:{...process.env,...env},detached:true,windowsHide:true,stdio:['ignore',log,log]});child.unref();closeSync(log);return child.pid;}
async function bootPostgres(config){
  if(!existsSync(initdb)||!existsSync(pgCtl))throw new Error('PostgreSQL 18 binaries not found; set AUTOCLIPPER_PG_BIN to their bin directory');
  if(!existsSync(join(dataDir,'PG_VERSION'))){
    if(existsSync(dataDir))throw new Error('Incomplete isolated PostgreSQL directory; inspect .local/native-login/postgres before retrying');
    const passwordFile=join(local,'initdb-password.tmp');await writeFile(passwordFile,config.postgresPassword,{mode:0o600,flag:'wx'});
    try{await run(initdb,['-D',dataDir,'-U','postgres','--auth-host=scram-sha-256','--auth-local=scram-sha-256','--pwfile',passwordFile,'--no-instructions'],{timeout:120000,maxBuffer:1048576});}
    finally{await rm(passwordFile,{force:true});}
  }
  try{await run(pgCtl,['-D',dataDir,'status'],{timeout:5000});}
  catch{await run(pgCtl,['-D',dataDir,'-l',join(local,'postgres.log'),'-o',`-p ${pgPort} -h 127.0.0.1`,'-w','start'],{timeout:30000,maxBuffer:1048576});}
}
async function bootstrap(config){
  const admin=new pg.Client({connectionString:url('postgres',config.postgresPassword,'postgres')});await admin.connect();
  try{
    for(const[role,password]of[['autoclipper_identity_owner',config.ownerPassword],['autoclipper_identity_runtime',config.runtimePassword]]){
      if(!(await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[role])).rows.length)await admin.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${password}'`);
    }
    if(!(await admin.query("SELECT 1 FROM pg_database WHERE datname='autoclipper_identity'")).rows.length)await admin.query('CREATE DATABASE autoclipper_identity OWNER autoclipper_identity_owner');
    await admin.query('REVOKE ALL ON DATABASE autoclipper_identity FROM PUBLIC');
    await admin.query('GRANT CONNECT ON DATABASE autoclipper_identity TO autoclipper_identity_owner,autoclipper_identity_runtime');
  }finally{await admin.end();}
  const schemaAdmin=new pg.Client({connectionString:url('postgres',config.postgresPassword)});await schemaAdmin.connect();
  try{
    await schemaAdmin.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
    await schemaAdmin.query('ALTER SCHEMA public OWNER TO autoclipper_identity_owner');
    await schemaAdmin.query('GRANT USAGE ON SCHEMA public TO autoclipper_identity_runtime');
    await schemaAdmin.query('ALTER DEFAULT PRIVILEGES FOR ROLE autoclipper_identity_owner IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO autoclipper_identity_runtime');
    await schemaAdmin.query('ALTER DEFAULT PRIVILEGES FOR ROLE autoclipper_identity_owner IN SCHEMA public GRANT USAGE,SELECT ON SEQUENCES TO autoclipper_identity_runtime');
  }finally{await schemaAdmin.end();}
  const owner=new pg.Pool({connectionString:url('autoclipper_identity_owner',config.ownerPassword)});
  try{
    await migrate(drizzle(owner),{migrationsFolder:join(root,'apps','autoclipper-identity-service','migrations')});
    const hashed=await argon2.hash(config.testPassword,{type:argon2.argon2id,memoryCost:19456,timeCost:2,parallelism:1});
    await owner.query('INSERT INTO users(id,email,name,password_hash,verified_at) VALUES($1,$2,$3,$4,now()) ON CONFLICT(email) DO NOTHING',[config.testUserId,config.testEmail,'Cuenta local de prueba',hashed]);
  }finally{await owner.end();}
}
async function smoke(config){
  const csrf=await fetch(`http://localhost:${gatewayPort}/v1/auth/csrf`,{headers:{origin:'http://localhost:4200'}});if(csrf.status!==200)throw new Error(`CSRF endpoint returned ${csrf.status}`);
  const token=(await csrf.json()).csrfToken,cookies=csrf.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
  const login=await fetch(`http://localhost:${gatewayPort}/v1/auth/login`,{method:'POST',headers:{origin:'http://localhost:4200','content-type':'application/json','x-csrf-token':token,cookie:cookies},body:JSON.stringify({email:config.testEmail,password:config.testPassword})});
  if(login.status!==200)throw new Error(`Local test login returned ${login.status}`);
}
if(process.platform!=='win32'||process.env.NODE_ENV==='production')throw new Error('This launcher is for local Windows development only');
for(const port of[redisPort,identityPort,gatewayPort])if(await portOpen(port))throw new Error(`Port ${port} is already in use; choose an isolated native port without stopping existing services`);
await mkdir(local,{recursive:true});
let config;
if(existsSync(configPath))config=JSON.parse(await readFile(configPath,'utf8'));
else{config={postgresPassword:secret(),ownerPassword:secret(),runtimePassword:secret(),internalToken:secret(),csrfSigningKey:secret(),authEncryptionKey:secret(),testUserId:randomUUID(),testEmail:`native-${randomUUID()}@example.test`,testPassword:`Native-${secret()}`};await writeFile(configPath,JSON.stringify(config,null,2),{mode:0o600,flag:'wx'});}
await bootPostgres(config);await bootstrap(config);
const state={pgPort,redisPort,identityPort,gatewayPort};
state.redis=launch('redis-compat',[join(root,'scripts','native-login','redis-compat.mjs')],{NODE_ENV:'development',AUTOCLIPPER_NATIVE_LOGIN:'true',NATIVE_REDIS_PORT:String(redisPort)});
const common={NODE_ENV:'development',HOST:'127.0.0.1',CORS_ORIGIN:'http://localhost:4200',COOKIE_AUTH:'true',ENABLE_DOCS:'false',INTERNAL_TOKEN:config.internalToken,IDENTITY_URL:`http://127.0.0.1:${identityPort}`,WORKSPACE_URL:'http://127.0.0.1:3993',PROJECT_URL:'http://127.0.0.1:3994'};
state.identity=launch('identity',[join(root,'apps','autoclipper-identity-service','dist','main.js')],{...common,PORT:String(identityPort),DATABASE_URL:url('autoclipper_identity_runtime',config.runtimePassword),REDIS_URL:`redis://127.0.0.1:${redisPort}/1`,AUTH_ENCRYPTION_KEY:config.authEncryptionKey,CSRF_SIGNING_KEY:config.csrfSigningKey,SMTP_HOST:'127.0.0.1',SMTP_PORT:'1025'});
state.gateway=launch('gateway',[join(root,'apps','autoclipper-api-gateway','dist','main.js')],{...common,PORT:String(gatewayPort)});
await writeFile(statePath,JSON.stringify(state,null,2),{mode:0o600});
await waitHttp(`http://127.0.0.1:${identityPort}/v1/health/ready`);await waitHttp(`http://localhost:${gatewayPort}/v1/health/live`);await smoke(config);
console.log(`Native login ready at http://localhost:${gatewayPort}/v1/ . Test account is stored in .local/native-login/config.json .`);
