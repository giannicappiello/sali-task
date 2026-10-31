import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPreparationPdf} from '../src/pages/Warehouse/preparationPdf.js';
const products=[['IT0082','Bagno Doccia Pure White 1000ml'],['IT0418','Shampoo Ristrutturante']];
const content=(code,lotCode,quantity)=>({code,description:products.find(p=>p[0]===code)[1],lotCode,quantity});
const sample={id:'demo',source:{series:1,number:17458,year:2026,customerName:'Cliente di esempio / Sample customer',customerCode:'DEMO',destination:{}},verification:{summary:{totalPallets:2,totalPackages:4,totalPieces:37,pallets:[{id:'p1',number:1},{id:'p2',number:2}],packages:[{number:1,palletId:'p1',pieces:12,contents:[content('IT0082','100701062',2),content('IT0082','100701063',10)]},{number:2,palletId:'p1',pieces:12,contents:[content('IT0418','110602018',12)]},{number:3,palletId:'p2',pieces:1,contents:[content('IT0418','110602018',1)]},{number:4,palletId:'p2',pieces:12,contents:[content('IT0082','100701063',12)]}]}}};

test('packing list groups boxes inside pallets, keeps FIFO splits and uses bilingual Box/Boxes labels',()=>{
  const doc=buildPreparationPdf(sample);
  assert.equal(doc.getNumberOfPages(),1);
  const text=doc.output();
  for(const token of ['COLLO / BOX 1','PALLET 1','PALLET 2','TOTALE COLLI / TOTAL BOXES','1 pezzo / piece','100701062','100701063']) assert.ok(text.includes(token),token);
  assert.ok(text.indexOf('(COLLO / BOX 2)')<text.indexOf('(PALLET 2)'));
  assert.ok(text.indexOf('(COLLO / BOX 4)')<text.indexOf('(TOTALE COLLI / TOTAL BOXES)'));
  assert.ok(!text.toLowerCase().includes('carton'));
  assert.throws(()=>buildPreparationPdf({...sample,verification:null}),/riscontro/);
});

test('large packing lists repeat pallet context, retain every box and show shipment totals only once',()=>{
  const stress=structuredClone(sample);
  stress.verification.summary.packages=Array.from({length:36},(_,i)=>({number:i+1,palletId:i<24?'p1':'p2',pieces:12,contents:[content('IT0082','LOT-'+i,12)]}));
  stress.verification.summary.totalPackages=36;stress.verification.summary.totalPieces=432;
  stress.verification.summary.packages[12].contents[0].description='Descrizione lunga long description '.repeat(100);
  const doc=buildPreparationPdf(stress),text=doc.output();
  assert.ok(doc.getNumberOfPages()>2);
  for(let i=1;i<=36;i++)assert.ok(text.includes('(COLLO / BOX '+i+')'), 'Box '+i);
  assert.equal(text.split('TOTALE COLLI / TOTAL BOXES').length-1,1);
  assert.ok(text.includes('continua / continued'));
  assert.ok(text.includes('(432)'));
});
