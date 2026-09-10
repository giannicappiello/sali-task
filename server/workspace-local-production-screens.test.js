import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureLocalProductionScreens, LOCAL_PRODUCTION_SCREENS } from './workspace-local-production-screens.js';
function db() {
 const screens=[{codice:'progremes.Ordini.Fabbisogni',percorso:'/produzione/fabbisogni-acquisto',metadati:{custom:true}}];
 const links=[{modulo_codice:'acquisti',schermata_codice:'progremes.Ordini.Fabbisogni'}];
 return {screens,links, from(table){ const rows=table==='workspace_schermate'?screens:links; return {
 select(){return {in:async()=>({data:screens.map(s=>({...s})),error:null})};},
 async upsert(row){const exists=rows.some(r=>table==='workspace_schermate'?r.codice===row.codice:r.modulo_codice===row.modulo_codice&&r.schermata_codice===row.schermata_codice);if(!exists)rows.push({...row});return {};},
 update(patch){return {eq:async(key,value)=>{Object.assign(rows.find(r=>r[key]===value),patch);return {};}};}
 };}};
}
test('registers three selectable local screens and preserves purchasing assignment',async()=>{const d=db();await ensureLocalProductionScreens(d);assert.equal(d.screens.length,3);assert.equal(d.links.length,4);assert.equal(d.screens[0].metadati.custom,true);assert.ok(d.links.some(l=>l.modulo_codice==='acquisti'));});
test('removed associations never return on subsequent visits',async()=>{const d=db();await ensureLocalProductionScreens(d);d.links.splice(1);await ensureLocalProductionScreens(d);assert.equal(d.links.length,1);});
test('manual deactivation and metadata survive subsequent visits',async()=>{const d=db();await ensureLocalProductionScreens(d);d.screens[1].attiva=false;await ensureLocalProductionScreens(d);assert.equal(d.screens[1].attiva,false);});
test('local routes remain distinct from MES screens',()=>{assert.equal(new Set(LOCAL_PRODUCTION_SCREENS.map(s=>s.percorso)).size,3);assert.ok(LOCAL_PRODUCTION_SCREENS.every(s=>s.percorso.startsWith('/produzione/')));});
