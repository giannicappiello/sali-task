import test from 'node:test';import assert from 'node:assert/strict';
import {acquireRunLock} from '../src/run-lock.mjs';
test('esecuzione manuale e servizio non possono acquisire lo stesso blocco',async()=>{
 const path=`.private/test-run-lock-${process.pid}`;
 const release=await acquireRunLock(path);
 try{await assert.rejects(acquireRunLock(path),/già in esecuzione/);}finally{await release();}
 const second=await acquireRunLock(path);await second();
});
