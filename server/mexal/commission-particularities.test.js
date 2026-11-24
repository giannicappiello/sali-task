import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateCommissions} from './commission-engine.js';
import {particularityPercentage,loadCommissionParticularities} from './commission-particularities.js';
import {buildRootMatrixRows} from './order-documents.js';
const customer={codice_cliente:'501.00001',categoria_provvigionale_mexal:1};
const product={codice_articolo:'IT0058',categoria_provvigionale_mexal:4,codice_iva_mexal:'22,0'};
const generic={id:'generic-rule',attiva:true,categoria_cliente:1,categoria_prodotto:4,percentuale:15};
const particularity={id:8171,tipo_part:'V',is_active:true,tp_dato_conto:'N',id_cat_conto:1,tp_dato_art:'A',cod_articolo:'IT0058',data_inizio:'2026-10-27',part_1:[[4,'10,00']],tipo_pr_1:[[4,'%']],part_2:[[9,'10,00']],tipo_pr_2:[[9,'%']]};
const calculate=(overrides={})=>calculateCommissions({order:{codice_agente_mexal:'602.00060',data_ordine:'2026-11-24'},customer,lines:[{id:'line',codice_articolo:'IT0058',quantita:1,quantita_documento:1}],products:[product],rules:[generic],particularities:[particularity],...overrides})[0];

test('IT0058 uses the active 10% article exception instead of the 15% category rule, including outbound Mexal matrices',()=>{
 const line=calculate();assert.equal(line.provvigione_percentuale,10);assert.equal(line.provvigione_regola_id,null);assert.equal(line.provvigione_dettaglio_calcolo.particolarita_id,8171);assert.equal(line.provvigione_dettaglio_calcolo.origine,'mexal_particolarita_provvigioni');
 const payload=buildRootMatrixRows([line],5,'602.00060','OCM');assert.deepEqual(payload.perc_provv,[[1,10]]);assert.deepEqual(payload.formula_pr,[[1,1,'10']]);assert.deepEqual(payload.calc_formula_pr,[[1,1,10]]);
});
test('date bounds are inclusive and expired, future, inactive or other-client/article rules never override the category rule',()=>{
 assert.equal(calculate({order:{data_ordine:'2026-10-26'}}).provvigione_percentuale,15);assert.equal(calculate({order:{data_ordine:'2026-10-27'}}).provvigione_percentuale,10);
 for(const rule of [{...particularity,is_active:false},{...particularity,data_fine:'2026-11-23'},{...particularity,id_cat_conto:4},{...particularity,cod_articolo:'IT0001'}])assert.equal(calculate({particularities:[rule]}).provvigione_percentuale,15);
 assert.equal(calculate({particularities:[{...particularity,data_fine:'2026-11-24'}]}).provvigione_percentuale,10);
});
test('specific customer precedes category; exact article precedes product category; statistical categories use their own fields',()=>{
 const category={...particularity,id:62,tp_dato_art:'T',id_cat_art:4,part_1:[[4,'15']],part_2:[[9,'15']]};
 assert.equal(calculate({particularities:[category,particularity]}).provvigione_percentuale,10);
 const client={...category,id:60,tp_dato_conto:'C',codice_conto:customer.codice_cliente,part_1:[[4,'7']],part_2:[[9,'7']]};
 assert.equal(calculate({particularities:[particularity,client]}).provvigione_percentuale,7);
 const statistical={...category,id:64,tp_dato_conto:'S',id_catsta_conto:9,part_1:[[4,'10']],part_2:[[9,'10']]};
 assert.equal(calculate({customer:{...customer,dati_mexal:{nr_cat_sta:9}},particularities:[statistical]}).provvigione_percentuale,10);
 assert.equal(calculate({particularities:[statistical]}).provvigione_percentuale,15);
});
test('0% exceptions are honored, repeated matrices are not summed, and a specific article does not require a product category',()=>{
 assert.equal(particularityPercentage(particularity),10);
 assert.equal(calculate({particularities:[{...particularity,part_1:[[4,'0']],part_2:[[9,'0']]}]}).provvigione_percentuale,0);
 assert.equal(calculate({products:[{codice_articolo:'IT0058'}]}).provvigione_percentuale,10);
 assert.equal(calculate({particularities:[]}).provvigione_percentuale,15);
});
test('ambiguous rates, conditional commissions and unsupported formulas cannot silently fall back to 15%',()=>{
 for(const rule of [{...particularity,part_2:[[9,'20']]},{...particularity,tipo_pr_1:[[4,'EUR']]},{...particularity,scaglione1:[[1,10]]},{...particularity,cod_agente_1:[[4,'602.00060']]},{...particularity,part_1:[[4,'-1']]}])assert.throws(()=>calculate({particularities:[rule]}),/Provvigione non calcolabile/);
 const duplicate={...particularity,id:888,part_1:[[4,'12']],part_2:[[9,'12']]};assert.throws(()=>calculate({particularities:[particularity,duplicate]}),/stessa priorità/);
});
test('imported raw Mexal fields work, shipping stays commission-free, and input records remain unchanged',()=>{
 const before=structuredClone(particularity);assert.equal(calculate({particularities:[{id:8171,is_active:true,dati_mexal:particularity}]}).provvigione_percentuale,10);assert.deepEqual(particularity,before);
 assert.equal(calculate({lines:[{riga_spedizione:true,codice_articolo:'IT0058'}]}).provvigione_percentuale,null);
});
test('the V rule loader pages the complete active archive and returns database failures',async()=>{
 let calls=0;const db={from(table){assert.equal(table,'ordini_particolarita');const q={select(){return q;},eq(key,v){assert.ok((key==='tipo_part'&&v==='V')||(key==='is_active'&&v===true));return q;},order(){return q;},async range(from,to){calls++;assert.equal(to-from,499);return{data:from===0?Array.from({length:500},(_,id)=>({id})):[{id:500}],error:null};}};return q;}};
 assert.equal((await loadCommissionParticularities(db)).data.length,501);assert.equal(calls,2);
 const bad={from(){return{select(){return this;},eq(){return this;},order(){return this;},async range(){return {data:null,error:{message:'offline'}};}};}};assert.equal((await loadCommissionParticularities(bad)).error.message,'offline');
});


test('reconciliation preserves historical rates and never guesses a missing commission for an existing Mexal document',()=>{
 const detail={origine:'mexal_provvigioni_listini',regola_id:'generic-rule'};
 const historic={codice_articolo:'IT0058',provvigione_percentuale:15,provvigione_regola_id:'generic-rule',provvigione_dettaglio_calcolo:detail};
 const line=calculate({lines:[historic],preserveExisting:true});assert.deepEqual(line,historic);assert.equal(line.provvigione_percentuale,15);
 assert.equal(calculate({preserveExisting:true}).provvigione_percentuale,null);
 assert.equal(calculate({preserveExisting:false}).provvigione_percentuale,10);
});
