import {existsSync} from 'node:fs';
import {readFile,writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
const run=promisify(execFile),root=resolve(fileURLToPath(new URL('../..',import.meta.url))),local=join(root,'.local','native-login'),statePath=join(local,'state.json');
if(!existsSync(statePath)){console.log('No native login state found.');process.exit(0);}
const state=JSON.parse(await readFile(statePath,'utf8'));
for(const[name,relative]of[['gateway','apps/autoclipper-api-gateway/dist/main.js'],['identity','apps/autoclipper-identity-service/dist/main.js'],['redis','scripts/native-login/redis-compat.mjs']]){
  const pid=state[name];if(!Number.isInteger(pid)||pid<1)continue;
  const {stdout}=await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',`(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}' -ErrorAction SilentlyContinue).CommandLine`],{timeout:30000});
  if(stdout.toLowerCase().includes(join(root,...relative.split('/')).toLowerCase())){try{process.kill(pid);}catch(error){if(error.code!=='ESRCH')throw error;}}
}
const pgBin=process.env.AUTOCLIPPER_PG_BIN??'C:\\Program Files\\PostgreSQL\\18\\bin',pgCtl=join(pgBin,'pg_ctl.exe'),dataDir=join(local,'postgres');
if(existsSync(join(dataDir,'PG_VERSION'))&&existsSync(pgCtl)){
  const running=await run(pgCtl,['-D',dataDir,'status'],{timeout:10000}).then(()=>true,()=>false);
  if(running)await run(pgCtl,['-D',dataDir,'-m','fast','-w','stop'],{timeout:30000});
}
await writeFile(statePath,JSON.stringify({...state,stoppedAt:new Date().toISOString()},null,2));
console.log('Isolated native login processes stopped; local test data remains in .local/native-login.');
