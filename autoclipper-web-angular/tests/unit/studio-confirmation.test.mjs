import '@angular/compiler';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ConfirmationService } from '../../.local/tests/client.mjs';
const options = {title:'Exportar',message:'Generar MP4',confirmLabel:'Continuar'};
test('confirmation cancellation resolves false and releases the pending action',async()=>{
 const service=new ConfirmationService(); const decision=service.ask(options);
 assert.equal(service.pending().title,'Exportar'); service.finish(false);
 assert.equal(await decision,false); assert.equal(service.pending(),null);
});
test('a second request cannot replace or approve an existing confirmation',async()=>{
 const service=new ConfirmationService(); const first=service.ask(options);
 assert.equal(await service.ask({...options,title:'Otra operación'}),false);
 assert.equal(service.pending().title,'Exportar');service.finish(true);
 assert.equal(await first,true);service.finish(false);assert.equal(service.pending(),null);
 const next=service.ask(options);service.finish(false);assert.equal(await next,false);
});
