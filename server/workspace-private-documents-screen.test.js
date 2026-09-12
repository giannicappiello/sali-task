import test from 'node:test';
import assert from 'node:assert/strict';
import { ensurePrivateDocumentsScreen, PRIVATE_DOCUMENTS_SCREEN } from './workspace-private-documents-screen.js';
function database({existing=null,deleted=null,module=true}={}) {
 const writes=[];
 return {writes,from(table){return {
  select(){const q={eq(){return q;},async maybeSingle(){return {data:table==='workspace_schermate'?existing:table==='workspace_catalog_deletions'?deleted:module?{codice:'progremes_formule'}:null};}};return q;},
  upsert(row){writes.push({table,row});return {async select(){return {data:[{codice:row.codice}]};}};}
 };}};
}
test('registers the local screen and its initial module association',async()=>{const db=database();await ensurePrivateDocumentsScreen(db);assert.equal(db.writes.length,2);assert.equal(db.writes[0].row.percorso,'/documentation/private');assert.equal(db.writes[1].row.modulo_codice,'progremes_formule');});
test('existing screen and manually changed associations are untouched',async()=>{const db=database({existing:{codice:'custom'}});await ensurePrivateDocumentsScreen(db);assert.equal(db.writes.length,0);});
test('permanently deleted screen is not recreated',async()=>{const db=database({deleted:{code:PRIVATE_DOCUMENTS_SCREEN.codice}});await ensurePrivateDocumentsScreen(db);assert.equal(db.writes.length,0);});
test('missing module stays deleted and screen remains assignable',async()=>{const db=database({module:false});await ensurePrivateDocumentsScreen(db);assert.equal(db.writes.length,1);});
