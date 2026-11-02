import { jsPDF } from "jspdf";
import { drawProgreOrderHeader } from "../../modules/orders/services/orderPdf.js";

const date = value => String(value || "").replace(/^(\d{4})(\d{2})(\d{2})$/, "$3/$2/$1");

export function preparationForPallet(preparation, palletId) {
  const summary = preparation.verification?.summary;
  const pallet = summary?.pallets.find(item => item.id === palletId);
  if (!pallet) throw new Error('Bancale non trovato nel riscontro.');
  const packages = summary.packages.filter(item => item.palletId === palletId);
  return {...preparation,verification:{...preparation.verification,summary:{...summary,
    pallets:[pallet],packages,totalPallets:1,totalPackages:packages.length,totalPieces:packages.reduce((n,item)=>n+item.pieces,0),
    weightTotals:{...summary.weightTotals,netWeightKg:pallet.netWeightKg,grossWeightKg:pallet.grossWeightKg},
  }}};
}

export function buildPreparationPdf(preparation, {palletId}={}) {
  if(palletId)preparation=preparationForPallet(preparation,palletId);
  const summary=preparation.verification?.summary;
  if(!summary)throw new Error("Esegui il riscontro prima di generare la packing list.");
  const doc=new jsPDF({unit:'mm',format:'a4'}),{source,ddt}=preparation;
  const title=palletId?`PACKING LIST - BANCALE ${summary.pallets[0].number}`:'PACKING LIST';
  doc.setProperties({title:`Packing list OCM ${source.series}/${source.number}`,author:'Progre SRL'});
  const text=(value,x,y,size=7.3,bold=false,align='left')=>{doc.setFont('helvetica',bold?'bold':'normal');doc.setFontSize(size);doc.setTextColor(34,34,34);doc.text(Array.isArray(value)?value:String(value??''),x,y,{align});};
  const weight=n=>n==null?'N/D':Number(n).toLocaleString('it-IT',{minimumFractionDigits:3,maximumFractionDigits:3});
  const rule=y=>{doc.setDrawColor(205,213,220);doc.setLineWidth(0.15);doc.line(7,y,203,y);};
  let y=0;
  function page(first=false){
    if(!first)doc.addPage();drawProgreOrderHeader(doc);text(title,7,40,12,true);
    doc.setFontSize(8);const reference=doc.splitTextToSize(`OCM ${source.series}/${source.number} - ${source.year} | ${source.customerName} (${source.customerCode})`,196);
    if(reference.length>6)throw new Error('Intestazione cliente troppo estesa.');
    text(reference,7,46,8,true);y=47+reference.length*3.4;
    if(first){
      const destination=[source.destination?.name,source.destination?.address,source.destination?.postalCode,source.destination?.city,source.destination?.province,source.destination?.country].filter(Boolean).join(' - ') || 'Come da ordine Mexal';
      doc.setFontSize(7.5);const lines=doc.splitTextToSize(`Destinazione / Delivery: ${destination}`,196);
      if(lines.length>25)throw new Error('Destinazione troppo estesa per la packing list.');
      text(lines,7,y,7.5);y+=lines.length*3.2+1;
      text(ddt?`DDT: ${ddt.signature || 'BC'} ${ddt.series}/${ddt.number} - ${date(ddt.date)}`:'DDT non ancora emesso',7,y,7.5);y+=5;
    }
    doc.setFillColor(237,241,245);doc.rect(7,y-3,196,6,'F');
    for(const [x,label]of [[8,'COLLO'],[21,'CODICE'],[43,'PRODOTTO'],[112,'LOTTO'],[148,'PZ'],[172,'NETTO Kg'],[201,'LORDO Kg']])text(label,x,y+1,6.6,true,x>=148?'right':'left');
    y+=5;
  }
  function palletHeading(pallet,continued=false){
    if(y+13>249)page();
    doc.setFillColor(247,249,251);doc.rect(7,y,196,6,'F');
    const packs=summary.packages.filter(p=>(p.palletId||null)===(pallet.id||null));
    text(`${pallet.number?`BANCALE / PALLET ${pallet.number}`:'SENZA BANCALE'}${continued?' - continua':''} | ${packs.length} colli | ${packs.reduce((n,p)=>n+p.pieces,0)} pezzi`,8,y+4,8,true);
    text(`Netto: ${weight(pallet.netWeightKg)} Kg | Lordo: ${weight(pallet.grossWeightKg)} Kg`,201,y+4,7,false,'right');y+=8;
  }
  page(true);
  const pallets=[...summary.pallets].sort((a,b)=>a.number-b.number);
  if(summary.packages.some(p=>!p.palletId))pallets.push({id:null,number:null});
  for(const pallet of pallets){
    const packs=summary.packages.filter(p=>(p.palletId||null)===(pallet.id||null)).sort((a,b)=>a.number-b.number);
    if(!packs.length)continue;palletHeading(pallet);
    for(const pack of packs){
      let firstRow=true;
      for(const row of pack.contents.length?pack.contents:[{code:'-',description:'Vuoto',quantity:0}]){
        doc.setFont('helvetica','normal');doc.setFontSize(7.3);
        const fields=[doc.splitTextToSize(String(row.code),20),doc.splitTextToSize(String(row.description||row.code).replace(/\s+/g,' '),67),doc.splitTextToSize(String(row.lotCode||'Non gestito'),24)];
        const lines=Math.max(...fields.map(f=>f.length));
        for(let offset=0;offset<lines;offset+=30){
          const count=Math.min(30,lines-offset),height=Math.max(5,count*3.1+1.6);
          if(y+height>249){page();palletHeading(pallet,true);}
          if(firstRow)rule(y);const top=y+3.5;
          text(firstRow?pack.number:'',8,top,7.6,true);
          text(fields[0].slice(offset,offset+30),21,top,7.3,true);text(fields[1].slice(offset,offset+30),43,top);text(fields[2].slice(offset,offset+30),112,top);
          text(offset===0?row.quantity:'',148,top,8,true,'right');
          text(firstRow?weight(pack.netWeightKg):'',172,top,7,false,'right');text(firstRow?weight(pack.grossWeightKg):'',201,top,7,false,'right');
          y+=height;firstRow=false;
        }
      }
    }
    y+=2;
  }
  doc.setFillColor(237,241,245);doc.roundedRect(7,253,196,25,1,1,'F');
  for(const[x,label,value]of[[11,'TOTALE BANCALI',summary.totalPallets],[77,'TOTALE COLLI',summary.totalPackages],[143,'TOTALE PEZZI',summary.totalPieces]]){text(label,x,259,7,true);text(value,x,266,13,true);}
  text(`Peso netto totale: ${weight(summary.weightTotals?.netWeightKg)} Kg`,11,274,8,true);
  text(`Peso lordo totale: ${weight(summary.weightTotals?.grossWeightKg)} Kg`,199,274,8,true,'right');
  const count=doc.getNumberOfPages();
  for(let i=1;i<=count;i++){doc.setPage(i);text("PROGRE' SRL | Packing list - Italiano / English",7,290,6.5);text(`Pagina / Page ${i} / ${count}`,203,290,6.5,false,'right');}
  return doc;
}

export function packingListFileName(preparation) {
  const number=Number(preparation.ddt?.number);
  return Number.isSafeInteger(number) && number>0 ? `PackList_${number}.pdf` : `PackList_OCM_${preparation.source.series}_${preparation.source.number}.pdf`;
}

export function preparationPdf(preparation,{preview=false}={}) {
  const doc=buildPreparationPdf(preparation);
  if(preview) return doc.output("arraybuffer");
  doc.save(packingListFileName(preparation));
}
