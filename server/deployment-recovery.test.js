import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverStaleModule, loadModuleWithRecovery } from '../src/deployment-recovery.js';
test('missing deployment chunk requests user action without automatic reload',()=>{
 let notified=0;
 assert.equal(recoverStaleModule({payload:Error('Failed to fetch dynamically imported module: old.js')},()=>notified++),true);
 assert.equal(notified,1);
 assert.equal(recoverStaleModule({payload:Error('Validation failed')},()=>assert.fail()),false);
});
test('lazy loading waits for explicit retry and then resolves',async()=>{
 let release, attempts=0;
 const pending=loadModuleWithRecovery(async()=>{if(++attempts===1)throw Error('Failed to fetch dynamically imported module'); return {default:'loaded'};},()=>new Promise(r=>release=r));
 await new Promise(r=>setImmediate(r)); assert.equal(attempts,1); release();
 assert.deepEqual(await pending,{default:'loaded'}); assert.equal(attempts,2);
});
test('unrelated module errors are not swallowed',async()=>{
 await assert.rejects(loadModuleWithRecovery(async()=>{throw Error('syntax');},()=>assert.fail()),/syntax/);
});
