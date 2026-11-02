import {jsPDF} from 'jspdf';
import {autoTable} from 'jspdf-autotable';
import {drawProgreOrderHeader} from '../../modules/orders/services/orderPdf.js';
import {preparationEventLabels} from '../../../shared/preparationAudit.js';

const timestamp=value=>value?new Date(value).toLocaleString('it-IT',{timeZone:'Europe/Rome',hour12:false}):'Non registrata';
export function buildPreparationAuditPdf(preparation,records,{generatedAt=new Date().toISOString()}={}){
 const doc=new jsPDF({unit:'mm',format:'a4'}),source=preparation.source;
 doc.setProperties({title:`Registro OCM ${source.series}/${source.number}`,author:'Progre SRL'});
 const operators=new Map(records.map(r=>[r.actor,r.operatorName]));
 const body=[];
 for(const r of records){
  const details=[r.reason,r.ddt?`${r.ddt.signature||'BCF'} ${r.ddt.series}/${r.ddt.number}`:null,r.printer?`Stampante: ${r.printer}${r.copies?` - ${r.copies} copie`:''}`:null,...(r.documents||[]).map(f=>`Documento: ${f.filename}\nSHA256: ${f.sha256}`),...(r.recipients||[]).map(p=>`Invio: ${p.email} (${p.roles?.join(', ')||''})`),...(r.lots||[]).map(l=>`${l.code} - lotto ${l.lot||'non gestito'} - ${l.quantity} pezzi - magazzino ${l.warehouse}`)].filter(Boolean);
  const eventRef=`Evento ${r.id}\nID evento: ${r.eventId}`;
  if(!r.readings.length)body.push([timestamp(r.at),`${r.operatorName}\nID operatore: ${r.actor}`,preparationEventLabels[r.operation]||'Operazione registrata',[...details,eventRef].join('\n')]);
  else for(const scan of r.readings){
   const action={insert:'Inserimento articolo',correction:'Correzione quantità',remove:'Lettura annullata'}[scan.action];
   const detail=[`${scan.code} - ${scan.action==='remove'?`rimossi ${scan.previousQuantity}`:scan.quantity} pezzi${scan.action==='correction'?` (prima: ${scan.previousQuantity})`:''}`,`Collo ${scan.packageNumber??'N/D'} - Bancale ${scan.palletNumber??'N/D'}`,`ID lettura: ${scan.id}`,`ID collo: ${scan.packageId||'Non registrato'}`,`Data/ora lettura originale: ${timestamp(scan.at)}`,...details,eventRef];
   if(scan.actor&&scan.actor!==r.actor)detail.push(`Operatore lettura originale: ${operators.get(scan.actor)||scan.actor} (${scan.actor})`);
   body.push([timestamp(scan.action==='insert'?(scan.at||r.at):r.at),`${r.operatorName}\nID operatore: ${r.actor}`,action,detail.join('\n')]);
  }
 }
 if(!body.length)body.push(['','','Nessun evento registrato','']);
 const header=()=>{
  drawProgreOrderHeader(doc);doc.setTextColor(34,34,34);doc.setFont('helvetica','bold');doc.setFontSize(12);doc.text('REGISTRO ORDINE',7,40);
  doc.setFontSize(8);doc.text(`OCM ${source.series}/${source.number} - ${source.year}`,7,46);
  doc.setFont('helvetica','normal');doc.setFontSize(8);
  const client=doc.splitTextToSize(`Cliente: ${source.customerName} (${source.customerCode})`,196);doc.text(client.slice(0,2),7,51);
  doc.text(`Allestimento: ${preparation.id}`,7,61);
  doc.text(preparation.ddt?`DDT: ${preparation.ddt.signature} ${preparation.ddt.series}/${preparation.ddt.number}`:'DDT non ancora emesso',7,66);
 };
 autoTable(doc,{startY:74,margin:{top:74,left:7,right:7,bottom:20},head:[['Data e ora server','Operatore','Operazione','Articoli e riferimenti']],body,styles:{font:'helvetica',fontSize:7.5,cellPadding:2,overflow:'linebreak',valign:'top',lineColor:[215,220,225],lineWidth:0.1},headStyles:{fillColor:[237,241,245],textColor:[34,34,34],fontStyle:'bold'},columnStyles:{0:{cellWidth:29},1:{cellWidth:37},2:{cellWidth:31},3:{cellWidth:99}},rowPageBreak:'avoid',didDrawPage:header});
 const pages=doc.getNumberOfPages();
 for(let i=1;i<=pages;i++){doc.setPage(i);doc.setFont('helvetica','normal');doc.setFontSize(6.5);doc.text(`Orari Europe/Rome - Estratto registro immutabile al ${timestamp(generatedAt)}`,7,284);doc.text('Le correzioni conservano le letture precedenti. Date originarie assenti: Non registrata.',7,288);doc.text(`Pagina ${i}/${pages}`,203,288,{align:'right'});}
 return doc;
}
