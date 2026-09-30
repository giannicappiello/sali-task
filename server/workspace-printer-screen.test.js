import test from 'node:test';
import assert from 'node:assert/strict';
import { ensurePrinterScreen, PRINTER_SCREEN } from './workspace-printer-screen.js';
function database({existing=null,deleted=null,module=true}={}) {
 const writes=[];
 return {writes,from(table){return {
  select(){const q={eq(){return q;},async maybeSingle(){return {data:table==='workspace_schermate'?existing:table==='workspace_catalog_deletions'?deleted:module?{codice:'impostazioni_mes'}:null};}};return q;},
  upsert(row){writes.push({table,row});return {async select(){return {data:[{codice:row.codice}]};}};}
 };}};
}
test('registers the MES printer screen and its initial module association',async()=>{const db=database();await ensurePrinterScreen(db);assert.equal(db.writes.length,2);assert.equal(db.writes[0].row.percorso,'/produzione/progremes.Stampanti');assert.equal(db.writes[1].row.modulo_codice,'impostazioni_mes');});
test('existing screen and manually changed associations are untouched',async()=>{const db=database({existing:{codice:'custom'}});await ensurePrinterScreen(db);assert.equal(db.writes.length,0);});
test('permanently deleted screen is not recreated',async()=>{const db=database({deleted:{code:PRINTER_SCREEN.codice}});await ensurePrinterScreen(db);assert.equal(db.writes.length,0);});
test('missing module stays deleted and screen remains assignable',async()=>{const db=database({module:false});await ensurePrinterScreen(db);assert.equal(db.writes.length,1);});
