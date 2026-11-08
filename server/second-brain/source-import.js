/* global Buffer */
import {requireFinanceAdmin} from './mexal-finance.js';
import {brainProposalSchemas} from './memory-activities.js';
import {validateInput,objectSchema} from './schema.js';
import {hasCredentials} from './credential-guard.js';
import {verifyImportProof} from '../../integrations/second-brain-progre/src/source-import-proof.mjs';
const fail=(message,status=400)=>Object.assign(Error(message),{status});
export async function sourceImport(auth,body,{createReceipt,verifyReceipt,key}) {
 await requireFinanceAdmin(auth);
 if(!['bozza','conferma'].includes(auth.capabilities.role_ai_level))throw fail('Conferma operativa non abilitata.',403);
 if(body.action==='source_import_confirmation'){
  validateInput(objectSchema({root:{type:'string',pattern:'^[a-f0-9]{64}$'},entries:{type:'integer',minimum:1,maximum:20000}},['root','entries']),body.manifest);
  return {identity:{id:auth.profile.id,name:auth.profile.nome},receipt:createReceipt({userId:auth.profile.id,kind:'source-import',root:body.manifest.root,entries:body.manifest.entries,expires:Date.now()+3600000},key)};
 }
 const receipt=verifyReceipt(body.receipt,key,auth.profile.id);
 if(receipt.kind!=='source-import')throw fail('Conferma importazione non valida.',403);
 if(!Array.isArray(body.entries)||!body.entries.length||body.entries.length>4||!Array.isArray(body.proofs)||body.proofs.length!==body.entries.length||body.entries.length>receipt.entries||Buffer.byteLength(JSON.stringify(body.entries))>70000)throw fail('Lotto importazione non valido.');
 for(let i=0;i<body.entries.length;i++){
  const e=body.entries[i];validateInput(brainProposalSchemas.MEMORY_SAVE,e);
  if(e.kind!=='historical'||e.scope!=='personal'||e.departmentId||e.projectId||e.source!=='second-brain:MEXAL_FINANCE_READ'||!e.sourceKey.startsWith('source:')||hasCredentials(e))throw fail('Solo copie storiche personali da Mexal, senza credenziali.',403);
  if(!verifyImportProof(e,body.proofs[i],receipt.root))throw fail('Contenuto diverso dall’archivio in revisione.',409);
 }
 // Existing SECURITY INVOKER service: caller RLS, MEMORY_SAVE validation,
 // per-entry proposals/audit and source-key deduplication remain in force.
 const {data,error}=await auth.scoped.rpc('second_brain_import_history',{p_entries:body.entries});
 if(error)throw fail('Lotto non concluso. Verificare lo stato prima di riprendere.',502);
 return {imported:data,scope:'personal',root:receipt.root};
}
