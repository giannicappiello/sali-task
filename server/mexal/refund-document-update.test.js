/* global process */
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMexalClient} from './sync-products.js';

test('an uncertain COX update is sent once to the same resource, without retry or document POST',async()=>{
 const env={MEXAL_BASE_URL:'https://mexal.example',MEXAL_USERNAME:'user',MEXAL_PASSWORD:'private',MEXAL_AZIENDA:'TEST',MEXAL_ANNO:'2026',MEXAL_MAGAZZINO:'4'};
 const previous=Object.fromEntries(Object.keys(env).map(key=>[key,process.env[key]]));Object.assign(process.env,env);
 try{
  const calls=[];
  const client=buildMexalClient({request:async args=>{calls.push(args);throw Error('Response lost after update');}});
  const payload={sigla:'CO',cod_modulo:'X',serie:1,numero:900,quantita:[[1,-1]]};
  await assert.rejects(()=>client.putJson('/documenti/movimenti-magazzino/CO+1+900+501.02156',payload),/Response lost/);
  assert.equal(calls.length,1);assert.equal(calls[0].method,'PUT');assert.equal(JSON.parse(calls[0].body).numero,900);
  assert.match(calls[0].url,/CO\+1\+900\+501\.02156$/);
 }finally{for(const [key,value] of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;}
});
