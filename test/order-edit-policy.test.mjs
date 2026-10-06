import test from 'node:test';
import assert from 'node:assert/strict';
import { canEditOrderDraft } from '../src/modules/orders/services/orderEditPolicy.js';
const draft={stato:'bozza',stato_sincronizzazione:'non_avviato',versione_conferma:0};
test('all modules can edit only unsent drafts',()=>{
 for(const modulo_ordini of ['prof','ph','private']){
  assert.equal(canEditOrderDraft({...draft,modulo_ordini}),true);
  for(const stato_sincronizzazione of ['non_avviato','non_inviato','errore','arrestato','annullato','completato']){
   assert.equal(canEditOrderDraft({...draft,modulo_ordini,stato:'aperto',stato_sincronizzazione}),false);
  }
 }
});
test('previously sent orders cannot be reopened through a draft status',()=>{
 assert.equal(canEditOrderDraft({...draft,confermato_at:'2026-10-06T12:00:00Z'}),false);
 assert.equal(canEditOrderDraft({...draft,versione_conferma:1}),false);
});
test('document numbers, registry documents and running sync block even draft edits',()=>{
 for(const key of ['numero_ocm','numero_ocx','numero_oci','numero_oct']) assert.equal(canEditOrderDraft({...draft,[key]:'1'}),false);
 assert.equal(canEditOrderDraft(draft,{hasMexalDocument:true}),false);
 assert.equal(canEditOrderDraft({...draft,stato_sincronizzazione:'in_corso'}),false);
 assert.equal(canEditOrderDraft({...draft,origine:'mexal_oct'}),false);
});
