import test from 'node:test';
import assert from 'node:assert/strict';
import {matchFile,lotDocumentBundle,productionLotDocuments,privateDocumentOperation} from './private-documents-store.js';
import process from 'node:process';

const edge=(code,lot,source,sourceLot)=>({codice_articolo_prodotto:code,lotto_destinazione:lot,
  codice_articolo_materia_prima:source,lotto_origine:sourceLot,quantita:1});
const doc=(id,code,lot='')=>({external_id:id,codice_articolo:code,codice_lotto:lot,attivo:true,
  percorso_nas:id,tipo_associazione:lot?'LottoMateriaPrima':'Articolo'});
const archive=()=>({
  lots:[{articleCode:'IT01',lotCode:'P1',customerCode:'A'},{articleCode:'IT01',lotCode:'P2',customerCode:'B'}],
  genealogy:[edge('IT01','P1','FP01','B1'),edge('FP01','B1','MP01','M1'),edge('IT01','P1','MP01','M1'),
    edge('IT01','P2','MP01','M2'),edge('FP01','B2','MP02','OTHER'),edge('MP01','M1','IT01','P1')],
  documents:[doc('product-general','IT01'),doc('product-P1','IT01','P1'),doc('product-P2','IT01','P2'),
    doc('bulk-general','FP01'),doc('bulk-B1','FP01','B1'),doc('bulk-B2','FP01','B2'),
    doc('raw-general','MP01'),doc('raw-M1','MP01','M1'),doc('raw-M2','MP01','M2'),doc('other','MP02','OTHER')],
  files:['product-general','product-P1','product-P2','bulk-general','bulk-B1','bulk-B2','raw-general','raw-M1','raw-M2','other'].map(path=>({path,active:true}))
});

test('CoaPROGRE associa tutti i nomi generici e solo il lotto dello stesso articolo',()=>{
  const articles=[{articleCode:'FP01',articleType:'Semilavorato'},{articleCode:'IT01',articleType:'ProdottoFinito'}];
  const lots=[{articleCode:'FP01',lotCode:'00123'},{articleCode:'IT01',lotCode:'P1'}];
  for(const a of articles) {
    assert.deepEqual(matchFile({path:`Produzione/CoaPROGRE/${a.articleCode}/Scheda tecnica.pdf`},articles,lots),{articleCode:a.articleCode,lotCode:''});
    const lot=lots.find(l=>l.articleCode===a.articleCode).lotCode;
    assert.deepEqual(matchFile({path:`produzione/coaprogre/${a.articleCode.toLowerCase()}/${lot}_coa.pdf`},articles,lots),{articleCode:a.articleCode,lotCode:lot});
  }
  assert.equal(matchFile({path:'Produzione/CoaPROGRE/IT01/00123_coa.pdf'},articles,lots).articleCode,undefined);
  assert.equal(matchFile({path:'Produzione/Documentazione MP/IT01/Scheda.pdf'},articles,lots).articleCode,undefined);
});

test('lotto PF eredita documenti del bulk e MP esatti senza duplicati o cicli',()=>{
  const result=lotDocumentBundle(archive(),'IT01','P1',['A']);
  assert.deepEqual(result.general.map(d=>d.externalId),['product-general']);
  assert.deepEqual(result.specific.map(d=>d.externalId),['product-P1']);
  assert.deepEqual(result.materials.map(m=>[m.articleCode,m.lotCode]),[['FP01','B1'],['MP01','M1']]);
  assert.deepEqual(result.materials.flatMap(m=>m.documents.map(d=>d.externalId)),['bulk-general','bulk-B1','raw-general','raw-M1']);
  for(const d of result.materials.flatMap(m=>m.documents)) assert.deepEqual(d.downloadContext,{articleCode:'IT01',lotCode:'P1'});
});

test('cliente non accede al lotto altrui, né a materiali senza scarichi',()=>{
  assert.throws(()=>lotDocumentBundle(archive(),'IT01','P2',['A']),/non disponibile/);
  assert.throws(()=>lotDocumentBundle(archive(),'IT01','P1',['B']),/non disponibile/);
  assert.throws(()=>lotDocumentBundle(archive(),'IT01','',['*']),/non disponibile/);
  const data=archive();data.genealogy=[];
  assert.deepEqual(lotDocumentBundle(data,'IT01','P1',['A']).materials,[]);
});

test('file rimossi, documenti inattivi e consumi nulli non entrano nel fascicolo',()=>{
  const data=archive();data.files.find(f=>f.path==='raw-M1').active=false;
  data.documents.find(d=>d.external_id==='bulk-B1').attivo=false;
  data.genealogy.push({...edge('IT01','P1','MP02','OTHER'),quantita:0});
  const ids=lotDocumentBundle(data,'IT01','P1',['A']).materials.flatMap(m=>m.documents.map(d=>d.externalId));
  assert.deepEqual(ids,['bulk-general','raw-general']);
});

test('lettura del fascicolo rifiuta un lotto non autorizzato prima di espandere la genealogia',async()=>{
  const calls=[];
  const admin={from:table=>({select:()=>({eq(){return this;},or(){return this;},order(){return this;},range:async()=>{
    calls.push(table);return {data:[],count:0};
  }})})};
  await assert.rejects(productionLotDocuments(admin,'IT01','P1',['A']),/non disponibile/);
  assert.equal(calls.filter(t=>t==='workspace_sl_genealogy').length,1);
});

function database() {
  const data=archive(),audit=[];
  const tables={ordini_prodotti_cache:[{codice_articolo:'IT01'}],workspace_private_documents:data.documents,
    workspace_sl_genealogy:data.genealogy.map((g,i)=>({...g,mes_id:i})),
    workspace_private_document_lots:data.lots.map(l=>({article_code:l.articleCode,lot_code:l.lotCode,customer_code:l.customerCode})),
    workspace_private_nas_files:data.files};
  const admin={from:table=>{
    let records=[...(tables[table]||[])];
    return {select(){return this;},order(){return this;},
      eq(k,v){records=records.filter(r=>r[k]===v);return this;},
      in(k,values){records=records.filter(r=>values.includes(r[k]));return this;},
      or(expression){
        const pairs=[...expression.matchAll(/and\(codice_articolo_prodotto\.eq\."([^"]+)",lotto_destinazione\.eq\."([^"]+)"\)/g)];
        if(pairs.length) records=records.filter(r=>pairs.some(p=>r.codice_articolo_prodotto===p[1]&&r.lotto_destinazione===p[2]));
        return this;
      },
      async range(from,to){return {data:records.slice(from,to+1),count:records.length};},
      async single(){return {data:records[0]};},
      async maybeSingle(){return {data:records[0]};},
      async insert(row){audit.push(row);return {};}
    };
  }};
  return {admin,audit};
}

test('endpoint carica la catena e firma soltanto download appartenenti al lotto autorizzato',async()=>{
  const {admin,audit}=database();
  const identity={admin,customerCodes:['A'],profile:{id:'user-A'}};
  const result=await privateDocumentOperation(identity,'lots/documents?articleCode=IT01&lotCode=P1');
  assert.deepEqual(result.materials.flatMap(m=>m.documents.map(d=>d.externalId)),['bulk-general','bulk-B1','raw-general','raw-M1']);
  await assert.rejects(privateDocumentOperation(identity,'documents/raw-M2?articleCode=IT01&lotCode=P1'),/non disponibile/);
  await assert.rejects(privateDocumentOperation(identity,'documents/raw-M1?articleCode=IT01&lotCode=P2'),/non disponibile/);
  await assert.rejects(privateDocumentOperation(identity,'documents/raw-M1'),/non disponibile/);
  assert.equal(audit.length,0);
  const oldUrl=process.env.DOCUMENT_GATEWAY_URL,oldSecret=process.env.DOCUMENT_GATEWAY_SECRET;
  process.env.DOCUMENT_GATEWAY_URL='https://nas.example';process.env.DOCUMENT_GATEWAY_SECRET='test-secret-'.repeat(4);
  try {
    const download=await privateDocumentOperation(identity,'documents/raw-M1?articleCode=IT01&lotCode=P1');
    assert.match(download.url,/^https:\/\/nas.example\/files\/raw-M1\?expires=/);
    assert.deepEqual(audit,[{user_id:'user-A',document_id:'raw-M1'}]);
  } finally {
    if(oldUrl===undefined) delete process.env.DOCUMENT_GATEWAY_URL; else process.env.DOCUMENT_GATEWAY_URL=oldUrl;
    if(oldSecret===undefined) delete process.env.DOCUMENT_GATEWAY_SECRET; else process.env.DOCUMENT_GATEWAY_SECRET=oldSecret;
  }
});

test('elenco di tutti i fascicoli mantiene separati lotti e clienti',async()=>{
  const {admin}=database();
  const result=await productionLotDocuments(admin,'IT01',null,['A']);
  assert.deepEqual(result.lots.map(l=>l.lotCode),['P1']);
  assert.ok(!result.lots[0].materials.flatMap(m=>m.documents).some(d=>d.externalId==='raw-M2'));
  const internal=await productionLotDocuments(admin,'IT01',null,['*']);
  assert.deepEqual(internal.lots.map(l=>l.lotCode),['P1','P2']);
  assert.deepEqual(internal.lots[1].materials.flatMap(m=>m.documents.map(d=>d.externalId)),['raw-general','raw-M2']);
});
