import test from 'node:test';
import assert from 'node:assert/strict';
import {triggerPrompt} from './commercial-service.js';

test('persistent commercial prompt specifies valid PH/PR filters and product-scoped pagination',()=>{
 const prompt=triggerPrompt({id:'synthetic-batch',period:'2026-10-01',manifest:[{key:'agent:synthetic'}]});
 for(const text of ['orderModule=ph e customerGroup=all','orderModule=prof e customerGroup=regular','prima kind=products','kind=lines con productCode reale','paginando separatamente ogni prodotto','nextOffset=null','Manifest: [{"key":"agent:synthetic"}]'])assert.ok(prompt.includes(text),text);
});
test('recovery is bounded, isolates dependencies, and never bypasses approvals or batch gates',()=>{
 const prompt=triggerPrompt({id:'synthetic-batch',period:'2026-10-01',manifest:[]});
 for(const text of ['registro di avanzamento per artifactKey','prima della RPC','prova una volta','al massimo due retry','idempotenza documentata','Non ritentare denied, 401/403, approval_timeout','ACTION_STATUS non legge il registro delle chiamate CRM','consolidati che dipendono','non autorizza invii parziali','BRAIN_REVIEW richiede conferma umana','Non inviare con altri strumenti','Non usare campioni globali'])assert.ok(prompt.includes(text),text);
 assert.ok(!prompt.includes('Se mancano dati o strumenti, fermati'));
});
