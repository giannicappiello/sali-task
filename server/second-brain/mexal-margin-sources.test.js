import test from 'node:test';import assert from 'node:assert/strict';
import {mexalMarginSourceTools} from './mexal-margin-sources.js';
const admin={profile:{id:'personal',ruoli:{amministratore_workspace:true}},capabilities:{internal_data:true},scoped:{rpc:async n=>({data:n==='workspace_user_is_admin'?true:{mode:'tutti'}})}};
const input={dataset:'SL',from:'2026-01-01',to:'2026-10-31'};
test('denied identity never contacts source',async()=>{
 assert.deepEqual(mexalMarginSourceTools({...admin,capabilities:{}}),{});
 const t=mexalMarginSourceTools({...admin,scoped:{rpc:async()=>({data:false})}},{clientForYear:()=>assert.fail()}).MEXAL_MARGIN_SOURCES_READ;
 await assert.rejects(t.execute(input));
});
test('reads exact original SL documents and requires snapshot for remaining pages',async()=>{
 const a={sigla:'SL',serie:1,numero:1,cod_conto:'501.00995',data_documento:'20260901'},b={...a,numero:2};const calls=[];
 const client={azienda:'GRE',getJson:async path=>{calls.push(path);if(path==='/help')return [{method:'GET',regexp:'^/documenti/movimenti-magazzino(?:/SL\\+1\\+[12]\\+501\\.00995)?$'}];
 if(path.startsWith('/documenti/movimenti-magazzino?'))return {dati:[a,b,{...a,sigla:'FT'}]};
 return {...(path.includes('+2+')?b:a),tot_documento:[[1,122]],tot_iva:[[1,22]]};}};
 const tool=mexalMarginSourceTools(admin,{clientForYear:()=>client,now:()=>Date.parse('2026-11-09')}).MEXAL_MARGIN_SOURCES_READ;
 const first=await tool.execute({...input,limit:1});assert.equal(first.pagination.total,2);assert.equal(first.complete,false);assert.equal(first.documents[0].tot_documento[0][1],122);
 await assert.rejects(tool.execute({...input,offset:1,limit:1}));
 const second=await tool.execute({...input,offset:1,limit:1,snapshot:first.pagination.snapshot});assert.equal(second.documents[0].numero,2);assert.equal(second.complete,true);
 await assert.rejects(tool.execute({...input,snapshot:'f'.repeat(64)}));assert(calls.every(p=>!p.includes('ricerca')));
});
test('does not accept arbitrary paths or unadvertised accounting sources',async()=>{
 const tool=mexalMarginSourceTools(admin,{clientForYear:()=>({azienda:'GRE',getJson:async()=>[]}),now:()=>Date.parse('2026-11-09')}).MEXAL_MARGIN_SOURCES_READ;
 await assert.rejects(tool.execute({...input,dataset:'accounting'}));await assert.rejects(tool.execute({...input,path:'/unknown'}));
});
