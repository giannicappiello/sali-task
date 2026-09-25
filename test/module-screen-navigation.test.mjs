import test from 'node:test';
import assert from 'node:assert/strict';
import {moduleScreenNavigation as nav} from '../src/config/moduleScreenNavigation.js';
const catalog={modules:[{codice:'a',nome:'A',percorso:'/first',attivo:true},{codice:'b',nome:'B',attivo:true}],screens:[{codice:'first',percorso:'/first',attiva:true},{codice:'new',percorso:'/new',attiva:true}],links:[{modulo_codice:'a',schermata_codice:'first',predefinita:true,ordine:1},{modulo_codice:'a',schermata_codice:'new',ordine:2},{modulo_codice:'b',schermata_codice:'new',ordine:1}]};
test('configured new screens are available on initial and sibling pages',()=>{for(const path of ['/first','/new','/new/123'])assert.deepEqual(nav(catalog,path,null,()=>true).items.map(s=>s.codice),['first','new']);});
test('no initial screen means no links, including explicit module context',()=>assert.equal(nav(catalog,'/new','b',()=>true),null));
test('denied and hidden screens stay excluded',()=>{assert.deepEqual(nav(catalog,'/first',null,c=>c!=='new').items.map(s=>s.codice),['first']);assert.equal(nav(catalog,'/first',null,()=>false),null);});
test('removing initial screen removes navigation',()=>assert.equal(nav({...catalog,links:catalog.links.map(l=>({...l,predefinita:false}))},'/first',null,()=>true),null));
