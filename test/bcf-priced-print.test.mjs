import test from 'node:test';
import assert from 'node:assert/strict';
import {shipmentPreview} from '../server/preparation-dispatch.js';
import {ensureDdtPdf} from '../server/preparation-ddt-pdf.js';

test('new shipment snapshots request the BCF print layout with prices',async()=>{
  const settings={bcf_contract_verified:true,contract_evidence:'Verified BCF',ddt_pdf_path:'mexal:stampa_movimento_magazzino',backoffice_emails:['office@example.test'],email_customers:false,email_agents:false};
  const row={id:'test',source_hash:'test',version:1,source_raw:{},source:{customerCode:'501.00001'}};
  const unexpected=()=>{throw new Error('Unexpected external call');};
  const preview=await shipmentPreview({from:unexpected},{getJson:unexpected},row,settings);
  assert.equal(preview.pdfPrintModule,'1');
  assert.equal(preview.pdfPath,'mexal:stampa_movimento_magazzino');
});

test('a newly archived BC1 print PDF is reused for downloads and reprints without a layout correction',async()=>{
  for(const snapshot of [{dispatch:{pdfPrintModule:'1',pdfPath:'mexal:stampa_movimento_magazzino'}},{pdfPrintModule:'1',dispatch:{pdfPath:'mexal:stampa_movimento_magazzino'}}]) {
    const db={from:()=>({select(){return this;},eq(){return this;},single:async()=>({data:{sha256:'test',snapshot}})}),rpc:()=>{throw new Error('Unexpected archive rewrite');}};
    const client={getJson:()=>{throw new Error('Unexpected Mexal call');},printMovementPdf:()=>{throw new Error('Unexpected print request');}};
    await ensureDdtPdf(db,client,{updated_by:'operator'},'operator',false);
  }
});

