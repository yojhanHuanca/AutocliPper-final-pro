import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGatewayConfig, loadMediaConfig } from '@autoclipper/configuration';
import {loadServiceConfig} from '@autoclipper/http-security';

test('configuration rejects ambiguous booleans and invalid ports', () => {
  assert.equal(loadGatewayConfig({ ENABLE_DOCS: 'false' }).ENABLE_DOCS, false);
  assert.equal(loadGatewayConfig({ ENABLE_DOCS: 'true' }).ENABLE_DOCS, true);
  assert.throws(() => loadGatewayConfig({ ENABLE_DOCS: 'yes' }));
  assert.throws(() => loadGatewayConfig({ PORT: '0' }));
});
test('configuration errors do not expose credential values', () => {
  const password = 'SENSITIVE_CONFIGURATION_VALUE';
  assert.throws(() => loadMediaConfig({ DATABASE_URL: password }), error => !error.message.includes(password) && error.message.includes('DATABASE_URL'));
});

test('processing admission defaults to development and accepts only an explicit server mode',()=>{
  const keys=['DATABASE_URL','INTERNAL_TOKEN','CSRF_SIGNING_KEY','PROCESSING_ADMISSION_MODE'];
  const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  try{
    process.env.DATABASE_URL='postgresql://fixture:fixture@localhost/fixture';
    process.env.INTERNAL_TOKEN='a'.repeat(32);process.env.CSRF_SIGNING_KEY='b'.repeat(32);
    delete process.env.PROCESSING_ADMISSION_MODE;
    assert.equal(loadServiceConfig().PROCESSING_ADMISSION_MODE,'development');
    process.env.PROCESSING_ADMISSION_MODE='commercial';assert.equal(loadServiceConfig().PROCESSING_ADMISSION_MODE,'commercial');
    for(const mode of ['production','false','','DEVELOPMENT']){
      process.env.PROCESSING_ADMISSION_MODE=mode;
      assert.throws(()=>loadServiceConfig(),error=>error.message==='Invalid configuration: PROCESSING_ADMISSION_MODE');
    }
  }finally{for(const key of keys)if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}
});
