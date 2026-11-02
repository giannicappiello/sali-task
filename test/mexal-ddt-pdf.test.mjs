import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMexalClient } from '../server/mexal/sync-products.js';

test('BCF PDF uses the print-only service and rejects invalid references before the request', async () => {
  const names = ['MEXAL_BASE_URL','MEXAL_USERNAME','MEXAL_PASSWORD','MEXAL_AZIENDA','MEXAL_ANNO','MEXAL_MAGAZZINO'];
  const before = names.map(n=>process.env[n]);
  names.forEach((n,i)=>{process.env[n]=['https://mexal.test','test','test','DEM','2026','5'][i];});
  try {
    const calls=[];
    const client=buildMexalClient({request:async request=>{calls.push(request);return {status:200,headers:{'content-type':'application/pdf'},body:Buffer.from('%PDF-test')};}});
    const input={sigla:'BC',serie:1,numero:12,cod_conto:'501.00001',cod_modulo:'F'};
    await client.printMovementPdf(input);
    assert.equal(calls[0].url,'https://mexal.test/webapi/servizi');
    assert.equal(calls[0].binary,true);
    assert.deepEqual(JSON.parse(calls[0].body),{cmd:'stampa_movimento_magazzino',dati:{...input,cod_modulo:'S'}});
    await assert.rejects(client.printMovementPdf({...input,cod_modulo:'S'}));
    assert.equal(calls.length,1);
  } finally {names.forEach((n,i)=>{if(before[i]===undefined)delete process.env[n];else process.env[n]=before[i];});}
});
