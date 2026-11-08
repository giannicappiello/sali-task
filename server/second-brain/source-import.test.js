import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceImport} from './source-import.js';
import {importTree,verifyImportProof} from '../../integrations/second-brain-progre/src/source-import-proof.mjs';
import {createReceipt,verifyReceipt} from './handler.js';
const user='11111111-1111-4111-8111-111111111111';
const entry=i=>({title:'GRE 2026 '+i,content:'COPIA STORICA — codice conto originale 100.001',source:'second-brain:MEXAL_FINANCE_READ',sourceDate:'2026-11-08T10:00:00Z',sourceKey:'source:test:'+i,scope:'personal',kind:'historical'});
const security={createReceipt,verifyReceipt,key:'test-only'};
function mock(){const writes=[];return {writes,auth:{profile:{id:user,nome:'Uno',ruoli:{amministratore_workspace:true}},capabilities:{internal_data:true,role_ai_level:'conferma'},scoped:{rpc:async(name,args)=>{if(name==='workspace_user_is_admin')return {data:true};if(name==='workspace_data_scope')return {data:{mode:'tutti'}};if(name==='second_brain_import_history'){writes.push(args.p_entries);return {data:args.p_entries.length};}throw Error('Unexpected RPC '+name);}}}};}
test('Merkle commitment covers all entries, odd leaves and order',()=>{for(const n of [1,2,3,5,20000]){const a=Array.from({length:n},(_,i)=>entry(i)),t=importTree(a);for(const i of [0,n-1]){assert(t.proof(i).length<=15);assert(verifyImportProof(a[i],t.proof(i),t.root));assert(!verifyImportProof({...a[i],content:'changed'},t.proof(i),t.root));}}});
test('source review does not write; exact signed batch uses caller invoker service',async()=>{
 const {auth,writes}=mock(),entries=[entry(1),entry(2),entry(3)],tree=importTree(entries);
 const prepared=await sourceImport(auth,{action:'source_import_confirmation',manifest:{root:tree.root,entries:3}},security);
 assert.equal(writes.length,0);assert.equal(prepared.identity.id,user);
 const result=await sourceImport(auth,{action:'source_import_batch',receipt:prepared.receipt,entries,proofs:entries.map((_,i)=>tree.proof(i))},security);
 assert.equal(result.imported,3);assert.deepEqual(writes,[entries]);
});
test('tampering, altered scope, forged receipts and another user fail before any write',async()=>{
 const {auth,writes}=mock(),entries=[entry(1)],tree=importTree(entries);
 const prepared=await sourceImport(auth,{action:'source_import_confirmation',manifest:{root:tree.root,entries:1}},security);
 const body={action:'source_import_batch',receipt:prepared.receipt,entries,proofs:[tree.proof(0)]};
 await assert.rejects(sourceImport(auth,{...body,entries:[{...entries[0],content:'altered'}]},security),/diverso/);
 await assert.rejects(sourceImport(auth,{...body,entries:[{...entries[0],scope:'company'}]},security),/personali/);
 await assert.rejects(sourceImport(auth,{...body,receipt:prepared.receipt+'bad'},security),/non valida/);
 await assert.rejects(sourceImport({...auth,profile:{...auth.profile,id:'22222222-2222-4222-8222-222222222222'}},body,security),/altro utente/);
 assert.equal(writes.length,0);
});
test('admin and live role checks remain mandatory for preview and batches',async()=>{
 const {auth,writes}=mock(),manifest={root:'a'.repeat(64),entries:1};
 await assert.rejects(sourceImport({...auth,profile:{...auth.profile,ruoli:{}}},{action:'source_import_confirmation',manifest},security),/amministratore/);
 await assert.rejects(sourceImport({...auth,capabilities:{...auth.capabilities,role_ai_level:'analisi'}},{action:'source_import_confirmation',manifest},security),/non abilitata/);
 assert.equal(writes.length,0);
});

