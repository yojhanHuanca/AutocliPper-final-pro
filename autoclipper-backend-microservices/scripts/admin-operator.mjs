import 'reflect-metadata';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {adminGrant} from '@autoclipper/api-contracts';
import {z} from 'zod';

// Operator-only Identity owner connection. Never accepts a password, factor,
// email address, SQL fragment or database URL in command arguments.
async function run(){
  const [action,...args]=process.argv.slice(2);
  if(!['grant','revoke'].includes(action)||args.length%2)throw Error('Use grant/revoke with --user-id, --operator-reference, and grant --permissions --workspaces');
  const allowed=action==='grant'?['--user-id','--operator-reference','--permissions','--workspaces']:['--user-id','--operator-reference'];
  const values={};for(let i=0;i<args.length;i+=2){if(!allowed.includes(args[i])||values[args[i]]!==undefined)throw Error('Invalid operator arguments');values[args[i]]=args[i+1];}
  const reference=z.string().regex(/^[A-Za-z0-9_-]{1,64}$/u).parse(values['--operator-reference']),userId=z.uuid().parse(values['--user-id']);
  const grant=action==='grant'?adminGrant.parse({userId,operatorReference:reference,permissions:values['--permissions']?.split(','),workspaceIds:values['--workspaces']==='global'?null:values['--workspaces']?.split(',')}):null;
  if(!process.env.MIGRATION_DATABASE_URL)throw Error('Identity owner MIGRATION_DATABASE_URL required');
  const pool=new pg.Pool({connectionString:process.env.MIGRATION_DATABASE_URL,max:1,connectionTimeoutMillis:3000,statement_timeout:5000});
  const client=await pool.connect();
  try{
    const role=(await client.query('SELECT current_user AS name,current_database() AS database')).rows[0];if(role.name!=='autoclipper_identity_owner'||role.database!=='autoclipper_identity')throw Error('Identity owner role and database required');
    await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`admin-grant:${userId}`]);
    let record;
    if(grant){
      const user=(await client.query('SELECT u.id FROM users u JOIN user_mfa m ON m.user_id=u.id WHERE u.id=$1 AND u.verified_at IS NOT NULL AND m.enabled=true FOR SHARE OF u,m',[userId])).rows[0];if(!user)throw Error('Verified user with enabled MFA required');
      record=(await client.query('INSERT INTO admin_grants(user_id,permissions,workspace_ids) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET permissions=EXCLUDED.permissions,workspace_ids=EXCLUDED.workspace_ids,revision=admin_grants.revision+1,revoked_at=NULL,updated_at=now() RETURNING revision,permissions,workspace_ids',[userId,[...new Set(grant.permissions)].sort(),grant.workspaceIds===null?null:[...new Set(grant.workspaceIds)].sort()])).rows[0];
    }else{
      record=(await client.query('UPDATE admin_grants SET revoked_at=now(),revision=revision+1,updated_at=now() WHERE user_id=$1 RETURNING revision,permissions,workspace_ids',[userId])).rows[0];if(!record)throw Error('No operator grant exists');
    }
    await client.query('INSERT INTO admin_access_audit(id,subject_user_id,outcome,correlation_id,operator_reference,grant_revision,grant_permissions,grant_workspace_ids) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[randomUUID(),userId,action,randomUUID(),reference,record.revision,record.permissions,record.workspace_ids]);await client.query('COMMIT');console.log(JSON.stringify({action,userId,revision:record.revision,permissions:grant?.permissions??[],workspaceIds:grant?.workspaceIds??null}));
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();await pool.end();}
}
run().catch(()=>{console.error('ADMIN_OPERATOR_FAILED: invalid arguments, identity owner connection, verified MFA user or grant required. No change committed.');process.exitCode=1;});
