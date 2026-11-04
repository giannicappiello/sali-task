import {buildPreparationPdf,packingListFileName} from '../src/pages/Warehouse/preparationPdf.js';
import {Buffer} from 'node:buffer';
import {createHash} from 'node:crypto';
import {PDFDocument} from 'pdf-lib';
import {assert} from '../shared/orderPreparation.js';
import {checked} from './order-preparation-auth.js';
import {verifyDdt} from './order-preparation-mexal.js';

// Corrections append versions; previously printed/emailed PDFs remain immutable.
export async function ensureDdtPdf(db,client,row,actor=row.updated_by,canCorrect=true) {
  const current=checked(await db.from('warehouse_current_preparation_documents').select('sha256,snapshot').eq('preparation_id',row.id).eq('kind','bcf').single());
  if(['1','F','S'].includes(current.snapshot.pdfPrintModule || current.snapshot.dispatch?.pdfPrintModule) || current.snapshot.dispatch?.pdfPath!=='mexal:stampa_movimento_magazzino')return;
  assert(canCorrect,'PDF DDT da aggiornare da un operatore abilitato.',403);
  assert(Number(client.anno)===row.source.year,'Anno Mexal diverso dal documento.',409);
  verifyDdt(await client.getJson('/documenti/movimenti-magazzino/'+encodeURIComponent(row.ddt.reference)),row,row.export_payload);
  const result=await client.printMovementPdf({sigla:'BC',serie:Number(row.ddt.series),numero:Number(row.ddt.number),cod_conto:row.source.customerCode,cod_modulo:'F'});
  const bytes=Buffer.from(result.body);
  assert(bytes.length<=10*1024*1024 && bytes.subarray(0,5).toString()==='%PDF-','PDF DDT non valido.');
  const source=await PDFDocument.load(bytes),print=await PDFDocument.create();
  assert(source.getPageCount()>0,'PDF DDT privo di pagine.');
  for(let copy=0;copy<3;copy++)for(const page of await print.copyPages(source,source.getPageIndices()))print.addPage(page);
  const files=[{kind:'bcf',filename:`DDT_${row.source.year}_${row.ddt.series}_${row.ddt.number}.pdf`,bytes},
    {kind:'bcf_print',filename:`DDT_${row.ddt.number}_3_copie.pdf`,bytes:Buffer.from(await print.save())}]
    .map(({bytes,...file})=>({...file,base64:bytes.toString('base64'),sha256:createHash('sha256').update(bytes).digest('hex')}));
  checked(await db.rpc('warehouse_correct_ddt_pdf',{p_id:row.id,p_actor:actor,p_expected:current.sha256,p_files:files}));
}

export async function ensurePackingPdf(db,row,actor=row.updated_by,canCorrect=true) {
 const current=checked(await db.from('warehouse_current_preparation_documents').select('snapshot').eq('preparation_id',row.id).eq('kind','packing_list').single());
 if(current.snapshot.packingLayout==='compact-v2' || current.snapshot.dispatch?.packingLayout==='compact-v2')return;
 assert(canCorrect,'Packing list da aggiornare da un operatore abilitato.',403);
 const preparation={...row,source:{...row.source,destination:row.verification.destination || row.source.destination}};
 const files=[{kind:'packing_list',filename:packingListFileName(row),bytes:Buffer.from(buildPreparationPdf(preparation).output('arraybuffer'))},
 ...row.state.pallets.map(pallet=>({kind:'packing_pallet_'+pallet.id,filename:`PackList_${row.ddt.number}_Bancale_${pallet.number}.pdf`,bytes:Buffer.from(buildPreparationPdf(preparation,{palletId:pallet.id}).output('arraybuffer'))}))]
 .map(({bytes,...file})=>({...file,base64:bytes.toString('base64'),sha256:createHash('sha256').update(bytes).digest('hex')}));
 checked(await db.rpc('warehouse_correct_packing_pdf',{p_id:row.id,p_actor:actor,p_files:files}));
}
