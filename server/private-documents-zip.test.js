import test from 'node:test';
import assert from 'node:assert/strict';
import PizZip from 'pizzip';
import {Buffer} from 'node:buffer';
import {createDocumentArchive,archiveDocuments} from '../src/pages/Documentation/private-documents-zip.js';
import {readPrivateDocumentChunk} from './private-documents.js';

const d=(id,lot='')=>({externalId:id,articleId:'MP2025',lotCode:lot,originalFileName:'scheda.pdf',downloadContext:{articleCode:'FP1',lotCode:'L1'}});
test('ZIP conserva byte, contesto e nomi omonimi senza duplicare documenti',async()=>{
  const calls=[];
  const docs=archiveDocuments({general:[d('a')],specific:[d('a')],materials:[{documents:[d('b','1407'),d('c','1407')]}]});
  assert.equal(docs.length,3);
  const zip= new PizZip(await createDocumentArchive(docs,async path=>{
    calls.push(path);const url=new URL(path,'https://test/');
    assert.equal(url.searchParams.get('articleCode'),'FP1');assert.equal(url.searchParams.get('lotCode'),'L1');
    const offset=Number(url.searchParams.get('offset'));
    return {base64:Buffer.from(offset?'second':'first').toString('base64'),nextOffset:offset?null:5};
  }));
  const files=Object.values(zip.files).filter(f=>!f.dir);
  assert.equal(files.length,3);assert.equal(calls.length,6);
  assert.ok(files.every(f=>f.asText()==='firstsecond'));
  assert.equal(new Set(files.map(f=>f.name)).size,3);
});
test('ZIP non viene restituito quando manca un file o un frammento è invalido',async()=>{
  await assert.rejects(createDocumentArchive([d('a')],async()=>{throw new Error('NAS non disponibile');}),/NAS/);
  await assert.rejects(createDocumentArchive([d('a')],async()=>({base64:'YQ==',nextOffset:0})),/incompleto/);
});
test('proxy legge frammenti bounded e rileva risposte troncate',async()=>{
  const chunk=await readPrivateDocumentChunk('https://nas.test',0,async(url,options)=>{
    assert.equal(options.headers.Range,'bytes=0-1048575');
    return new Response('abc',{status:206,headers:{'content-range':'bytes 0-2/6'}});
  });
  assert.deepEqual(chunk,{base64:'YWJj',nextOffset:3});
  await assert.rejects(readPrivateDocumentChunk('https://nas.test',0,async()=>new Response('a',{status:206,headers:{'content-range':'bytes 0-2/3'}})),/incompleto/);
  await assert.rejects(readPrivateDocumentChunk('https://nas.test',0,async()=>new Response('a',{status:200})),/incompleta/);
});
