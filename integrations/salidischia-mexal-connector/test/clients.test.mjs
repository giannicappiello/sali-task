import test from 'node:test';
import assert from 'node:assert/strict';
import { wooClient, mexalReader, mexalTransport } from '../src/clients.mjs';
const env = { WOO_URL:'https://shop.example.invalid',WOO_CONSUMER_KEY:'test-key',WOO_CONSUMER_SECRET:'test-secret',
  MEXAL_BASE_URL:'https://mexal.example.invalid',MEXAL_USERNAME:'test-user',MEXAL_PASSWORD:'test-password',MEXAL_AZIENDA:'TEST',MEXAL_ANNO:'2026',MEXAL_MAGAZZINO:'5' };
test('WooCommerce: lettura singolo ordine, segreti solo in header e redirect vietati',async()=>{
  let call;const client=wooClient(env,async(url,options)=>{call={url,options};return new Response(JSON.stringify({id:123}));});
  assert.equal((await client.order(123)).id,123);
  assert.equal(call.url,'https://shop.example.invalid/wp-json/wc/v3/orders/123');
  assert.equal(call.options.method,'GET');assert.equal(call.options.redirect,'error');assert.ok(!call.url.includes('test-key'));
  await assert.rejects(client.order('../123'),/ID/);
});
test('Mexal: solo help di risorse previste, coordinate e autenticazione Passepartout',async()=>{
  let call;const client=mexalReader(env,async(url,options)=>{call={url,options};return new Response('{}');});
  await client.help('clienti');assert.equal(call.options.headers['Coordinate-Gestionale'],'Azienda=TEST Anno=2026 Magazzino=5');
  assert.match(call.options.headers.Authorization,/^Passepartout /);assert.equal(call.options.method,'GET');
  await assert.rejects(client.help('../altro'),/Risorsa/);
});
test('nessun uso di HTTP per inviare credenziali',()=>{
  assert.throws(()=>wooClient({...env,WOO_URL:'http://shop.example.invalid'}),/HTTPS/);
  assert.throws(()=>mexalReader({...env,MEXAL_BASE_URL:'http://mexal.example.invalid'}),/HTTPS/);
});
test('errori API non divulgano corpi di risposta o credenziali',async()=>{
  const client=wooClient(env,async()=>new Response('test-secret',{status:401}));
  await assert.rejects(client.order(123),error=>error.message==='Lettura API non riuscita (HTTP 401).');
});

test('errore Mexal conserva codice e campo senza pubblicare valori cliente',async()=>{
 const body={error:{'response-detail':'6001 - errore gestionale [cod_alternativo valore privato non valido]'}};
 const api=mexalTransport(env,async()=>new Response(JSON.stringify(body),{status:400}));
 await assert.rejects(api.request('/clienti'),error=>error.status===400&&error.message.includes('Mexal 6001, campo cod_alternativo')&&!error.message.includes('privato')&&Boolean(error.apiDetails.error));
});
test('ID restituito diverso e risposta troppo grande sono bloccati',async()=>{
  await assert.rejects(wooClient(env,async()=>new Response('{"id":124}')).order(123),/diverso/);
  await assert.rejects(wooClient(env,async()=>new Response('{}',{headers:{'content-length':'99999999'}})).order(123),/troppo grande/);
});
test('trasporto scritture: disabilitato per default e compatibile con 204 senza corpo',async()=>{
  let calls=0;const fetcher=async()=>{calls++;return new Response(null,{status:204});};
  await assert.rejects(mexalTransport(env,fetcher).request('/clienti/501.1',{method:'PUT',payload:{}}),/disabilitate/);
  assert.equal(calls,0);
  const result=await mexalTransport(env,fetcher,{enableWrites:true}).request('/clienti/501.1',{method:'PUT',payload:{}});
  assert.equal(result.status,204);assert.equal(result.data,null);
});
