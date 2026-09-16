import test from 'node:test';
import assert from 'node:assert/strict';
import { matchFile, normalizePath, allowedLots, visibleDocuments, linkRow, syncLots, synchronizeNas, rows, catalogue } from './private-documents-store.js';
import { documentsOnlyArticle, filterDocumentArticles, readCachedArticle, cacheArticle } from '../src/pages/Documentation/private-documents-catalogue.js';
const articles=[{articleCode:'MP2022',articleType:'MateriaPrima'},{articleCode:'MP2025',articleType:'MateriaPrima'}];
const lots=[{articleCode:'MP2022',lotCode:'12345'},{articleCode:'MP2025',lotCode:'67890'}];
test('MP generale e lotto esatto: case insensitive, nessun collegamento incrociato',()=>{
  const match=name=>matchFile({path:'produzione/Documentazione Mp/mp2022/'+name},articles,lots);
  assert.deepEqual(match('mp2022_sds.pdf'),{articleCode:'MP2022',lotCode:''});
  assert.deepEqual(match('MP2022.pdf'),{articleCode:'MP2022',lotCode:''});
  assert.deepEqual(match('12345_sds.pdf'),{articleCode:'MP2022',lotCode:'12345'});
  assert.equal(match('123456_sds.pdf').lotCode,'');
  assert.deepEqual(match('67890_sds.pdf'),{articleCode:'MP2022',lotCode:''});
  assert.equal(matchFile({path:'produzione/COA PROGRE/12345_sds.pdf'},articles,lots).articleCode,undefined);
});
test('lotti con underscore e prefissi ambigui non vengono confusi',()=>{
  const extended=[...lots,{articleCode:'MP2022',lotCode:'12345_0065'}];
  assert.equal(matchFile({path:'produzione/Documentazione MP/MP2022/12345_0065.pdf'},articles,extended).lotCode,'12345_0065');
  assert.equal(matchFile({path:'produzione/Documentazione MP/MP2022/12345_0065_sds.pdf'},articles,extended).articleCode,undefined);
});
test('percorsi esterni o traversal rifiutati',()=>{
  for(const p of ['../secret','a/../secret','/secret','C:/secret','a//b']) assert.throws(()=>normalizePath(p));
});
test('cliente vede solo i propri lotti, file generali e documenti dei lotti autorizzati',()=>{
  const archive={lots:[{articleCode:'MP2022',lotCode:'12345',customerCode:'A'},{articleCode:'MP2022',lotCode:'99999',customerCode:'B'}],
    documents:['','12345','99999'].map((lot,i)=>({external_id:String(i),codice_articolo:'MP2022',codice_lotto:lot,attivo:true,percorso_nas:'f'+i})),
    files:[0,1,2].map(i=>({path:'f'+i,active:true}))};
  assert.equal(allowedLots(archive,'MP2022',['A']).length,1);
  assert.deepEqual(visibleDocuments(archive,'MP2022',['A']).map(d=>d.external_id),['0','1']);
  assert.deepEqual(visibleDocuments(archive,'MP2022',['C']),[]);
  assert.equal(visibleDocuments(archive,'MP2022',['*']).length,3);
  archive.files[1].active=false;
  assert.deepEqual(visibleDocuments(archive,'MP2022',['A']).map(d=>d.external_id),['0']);
});
test('collegamenti idempotenti, generalità articolo valida anche per lotti futuri',()=>{
  const f={path:'Produzione/Documentazione MP/MP2022/MP2022_sds.pdf',name:'MP2022_sds.pdf'};
  const a=linkRow(f,{articleCode:'MP2022',lotCode:''});
  assert.equal(a.external_id,linkRow({...f,path:f.path.toLowerCase()},{articleCode:'mp2022',lotCode:''}).external_id);
  assert.equal(a.tipo_associazione,'Articolo');
  assert.equal(a.codice_lotto,'');
});
test('lettura lotti percorre tutte le pagine e conserva numeri come stringhe',async()=>{
  const saved=[],paths=[];
  const admin={from:()=>({upsert:async r=>{saved.push(...r);return {};}})};
  const client={getJson:async p=>{paths.push(p);return paths.length===1?{dati:[{id:1,cod_articolo:'MP2022',cod_ute_lotto:'00123'}],next:'abc'}:{dati:[{id:2,cod_articolo:'MP2022',cod_ute_lotto:'12345'}]};}};
  assert.equal(await syncLots(admin,{client}),2);
  assert.match(paths[1],/next=abc/);
  assert.equal(saved[0].lot_code,'00123');
});
test('manifest incompleto non scrive inventario o collegamenti e libera il lock',async()=>{
  const calls=[];
  const admin={rpc:async()=>({data:true}),from:t=>{calls.push(t);return {update:()=>({eq:()=>({eq:async()=>({})})})};}};
  await assert.rejects(synchronizeNas(admin,{fetchManifest:async()=>({files:[],complete:false})}),/incompleto/);
  assert.deepEqual(calls,['workspace_private_document_sync']);
});

test('ogni nome file nella cartella MP o Altro è generale salvo il lotto esatto',()=>{
  const catalog=[...articles,{articleCode:'TAP01',articleType:'Packaging'}];
  for(const name of ['Scheda sicurezza.pdf','Certificazione fornitore.pdf','S.T..pdf']) {
    assert.deepEqual(matchFile({path:'Produzione/Documentazione MP/MP2022/'+name},catalog,lots),{articleCode:'MP2022',lotCode:''});
    assert.deepEqual(matchFile({path:'Produzione/Documentazione MP/TAP01/'+name},catalog,lots),{articleCode:'TAP01',lotCode:''});
  }
  assert.equal(matchFile({path:'Produzione/Documentazione MP/SCONOSCIUTO/Scheda.pdf'},catalog,lots).articleCode,undefined);
  assert.equal(documentsOnlyArticle(catalog[0]),true);
  assert.equal(documentsOnlyArticle(catalog[2]),true);
  for(const articleType of ['ProdottoFinito','Semilavorato']) assert.equal(documentsOnlyArticle({articleType}),false);
});

test('indici vuoti non causano scansioni di tutti i lotti per ogni articolo',()=>{
  const archive={articles:[{articleCode:'MP0000',articleType:'MateriaPrima',description:'Prova'}],
    lotsByArticle:new Map(),documentsByArticle:new Map(),activeFiles:new Set(),
    get lots(){throw new Error('Scansione completa non consentita');},get documents(){throw new Error('Scansione completa non consentita');}};
  assert.deepEqual(allowedLots(archive,'MP0000',['*']),[]);
  assert.deepEqual(visibleDocuments(archive,'MP0000',['*']),[]);
  assert.equal(catalogue(archive,['*'])[0].lotCount,0);
});

test('ricerca locale indicizza solo i documenti e lotti autorizzati',()=>{
  const archive={articles:[{articleCode:'MP2022',description:'Collagene',articleType:'MateriaPrima'}],
    lots:[{articleCode:'MP2022',lotCode:'LOT-A',customerCode:'A'},{articleCode:'MP2022',lotCode:'LOT-B',customerCode:'B'}],
    documents:[{codice_articolo:'MP2022',codice_lotto:'LOT-A',attivo:true,percorso_nas:'a',titolo:'Sicurezza'},
      {codice_articolo:'MP2022',codice_lotto:'LOT-B',attivo:true,percorso_nas:'b',titolo:'Riservato B'}],
    files:[{path:'a',active:true},{path:'b',active:true}]};
  const catalog=catalogue(archive,['A']);
  for(const term of ['MP2022','collagene','LOT-A','sicurezza']) assert.equal(filterDocumentArticles(catalog,term).length,1);
  for(const term of ['LOT-B','Riservato B']) assert.equal(filterDocumentArticles(catalog,term).length,0);
});

test('cache dettaglio scade ed è limitata, refresh può invalidarla subito',()=>{
  const cache=new Map();cacheArticle(cache,'MP2022',{documents:[1]},0);
  assert.deepEqual(readCachedArticle(cache,'MP2022',29999),{documents:[1]});
  assert.equal(readCachedArticle(cache,'MP2022',30000),null);
  for(let i=0;i<40;i++) cacheArticle(cache,String(i),{},0);
  assert.equal(cache.size,30);cache.clear();assert.equal(readCachedArticle(cache,'39',1),null);
});

test('paginazione ordinata e parallela non perde righe oltre la soglia 1000',async()=>{
  const calls=[],data=Array.from({length:6200},(_,id)=>({id}));let active=0,peak=0;
  const admin={from:()=>({select:()=>({order:column=>({range:async(from,to)=>{
    calls.push({from,to,column});active++;peak=Math.max(peak,active);
    await new Promise(resolve=>setTimeout(resolve,2));active--;
    return {data:data.slice(from,to+1),count:data.length};
  }})})})};
  assert.deepEqual(await rows(admin,'documenti_workspace'),data);
  assert.equal(calls.length,7);assert.equal(peak,4);assert.ok(calls.every(c=>c.column==='id'));
});
