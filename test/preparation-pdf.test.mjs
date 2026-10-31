import {packingWeights} from '../shared/preparationWeights.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPreparationPdf,preparationPdf} from '../src/pages/Warehouse/preparationPdf.js';
const products=[['IT0082','Bagno Doccia Pure White 1000ml'],['IT0418','Shampoo Ristrutturante']];
const content=(code,lotCode,quantity)=>({code,description:products.find(p=>p[0]===code)[1],lotCode,quantity});
const sample={id:'demo',source:{series:1,number:17458,year:2026,customerName:'Cliente di esempio / Sample customer',customerCode:'DEMO',destination:{}},verification:{summary:{totalPallets:2,totalPackages:4,totalPieces:37,pallets:[{id:'p1',number:1},{id:'p2',number:2}],packages:[{number:1,palletId:'p1',pieces:12,contents:[content('IT0082','100701062',2),content('IT0082','100701063',10)]},{number:2,palletId:'p1',pieces:12,contents:[content('IT0418','110602018',12)]},{number:3,palletId:'p2',pieces:1,contents:[content('IT0418','110602018',1)]},{number:4,palletId:'p2',pieces:12,contents:[content('IT0082','100701063',12)]}]}}};

sample.verification.summary=packingWeights(sample.verification.summary,[{code:'IT0082',unitWeightGrams:1000},{code:'IT0418',unitWeightGrams:500}],{box_tare_kg:0.3,pallet_tare_kg:20});

test('packing list groups boxes inside pallets, keeps FIFO splits and uses bilingual Box/Boxes labels',()=>{
  const doc=buildPreparationPdf(sample);
  assert.equal(doc.getNumberOfPages(),1);
  const text=doc.output();
  for(const token of ['COLLO / BOX 1','PALLET 1','PALLET 2','TOTALE COLLI / TOTAL BOXES','PZ / PCS \\(1\\)','100701062','100701063']) assert.ok(text.includes(token),token);
  assert.ok(text.indexOf('(COLLO / BOX 2)')<text.indexOf('(PALLET 2)'));
  assert.ok(text.indexOf('(COLLO / BOX 4)')<text.indexOf('(TOTALE COLLI / TOTAL BOXES)'));
  assert.ok(!text.toLowerCase().includes('carton'));
  assert.ok(!/BOZZA|DRAFT/.test(text));
  assert.ok(text.includes('Peso netto / Net weight'));assert.ok(text.includes('71,700 Kg'));
  assert.throws(()=>buildPreparationPdf({...sample,verification:null}),/riscontro/);
});

test('large packing lists repeat pallet context, retain every box and show shipment totals only once',()=>{
  const stress=structuredClone(sample);
  stress.verification.summary.packages=Array.from({length:36},(_,i)=>({number:i+1,palletId:i<24?'p1':'p2',pieces:12,contents:[content('IT0082','LOT-'+i,12)]}));
  stress.verification.summary.totalPackages=36;stress.verification.summary.totalPieces=432;
  stress.verification.summary.packages[12].contents[0].lotCode='Lotto lungo long batch '.repeat(100);
  const doc=buildPreparationPdf(stress),text=doc.output();
  assert.ok(doc.getNumberOfPages()>2);
  for(let i=1;i<=36;i++)assert.ok(text.includes('(COLLO / BOX '+i+')'), 'Box '+i);
  assert.equal(text.split('TOTALE COLLI / TOTAL BOXES').length-1,1);
  assert.ok(text.includes('continua / continued'));
  assert.ok(text.includes('(432)'));
});

test('packing list preview returns PDF bytes without downloading or adding draft markings',()=>{
  const bytes=preparationPdf(sample,{preview:true});
  assert.ok(bytes instanceof ArrayBuffer);
  const file=Buffer.from(bytes).toString('latin1');assert.ok(file.startsWith('%PDF-'));assert.ok(!/BOZZA|DRAFT/.test(file));
});

const entries=doc=>doc.internal.pages.slice(1).map(commands=>commands.flatMap(command=>{
  const match=command.match(/([\d.]+) ([\d.]+) Td\n\((.*)\) Tj/s);
  return match?[{x:Number(match[1])/doc.internal.scaleFactor,y:297-Number(match[2])/doc.internal.scaleFactor,text:match[3]}]:[];
}));
test('summary stays at the foot of the last content page and header weights share its pallet/box line',()=>{
  for(const count of [1,4,8,10,20,36]){
    const input=structuredClone(sample),summary=input.verification.summary;
    summary.pallets=[summary.pallets[0]];
    summary.packages=Array.from({length:count},(_,i)=>({...summary.packages[0],number:i+1}));
    summary.totalPackages=count;
    const pages=entries(buildPreparationPdf(input)),last=pages.at(-1);
    const totals=last.find(entry=>entry.text==='TOTALE COLLI / TOTAL BOXES');
    assert.ok(Math.abs(totals.y-257.5)<0.02);
    assert.ok(last.some(entry=>entry.text.startsWith('COLLO / BOX')),'last page contains boxes, not only totals');
    assert.equal(pages.flat().filter(entry=>entry.text==='TOTALE COLLI / TOTAL BOXES').length,1);
    for(const page of pages){
      for(const heading of page.filter(entry=>/^(PALLET |COLLO \/ BOX )/.test(entry.text))){
        const line=page.filter(entry=>Math.abs(entry.y-heading.y)<0.02);
        const net=line.find(entry=>entry.text.startsWith('Peso netto /'));
        const gross=line.find(entry=>entry.text.startsWith('Peso lordo /'));
        assert.ok(net.x>heading.x && gross.x>net.x);
        if(heading.text.startsWith('PALLET '))assert.ok(line.some(entry=>/coll[oi] \/ box/.test(entry.text)));
      }
    }
    assert.ok(last.filter(entry=>/^IT|^COLLO/.test(entry.text)).every(entry=>entry.y<249));
  }
});
test('long product descriptions stay intact on one line and do not increase box height',()=>{
  const input=structuredClone(sample),description='Descrizione prodotto estesa con formato e caratteristiche '.repeat(3).trim();
  input.verification.summary.packages[0].contents[0].description=description;
  const doc=buildPreparationPdf(input),page=entries(doc)[0],baseline=entries(buildPreparationPdf(sample))[0];
  const line=page.find(entry=>entry.text===description);
  assert.ok(line);
  assert.ok(page.some(entry=>entry.text==='IT0082' && Math.abs(entry.y-line.y)<0.02));
  assert.equal(page.find(entry=>entry.text==='COLLO / BOX 2').y,baseline.find(entry=>entry.text==='COLLO / BOX 2').y);
  assert.equal(doc.getNumberOfPages(),1);
});
