import { jsPDF } from "jspdf";
import { drawProgreOrderHeader } from "../../modules/orders/services/orderPdf.js";

const boxWord = n => n === 1 ? "box" : "boxes";
const date = value => String(value || "").replace(/^(\d{4})(\d{2})(\d{2})$/, "$3/$2/$1");

export function buildPreparationPdf(preparation) {
  const summary = preparation.verification?.summary;
  if (!summary) throw new Error("Esegui il riscontro prima di generare la packing list.");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const { source, ddt } = preparation;
  doc.setProperties({title:`Packing list OCM ${source.series}/${source.number}`,author:"Progre SRL"});
  const title = "PACKING LIST";
  const text = (value, x, y, size = 8, bold = false, align = "left") => {
    doc.setTextColor(34, 34, 34);
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.text(Array.isArray(value) ? value : String(value), x, y, { align });
  };
  const frame = (x, y, w, h, fill = 255) => {
    doc.setDrawColor(185, 185, 185); doc.setLineWidth(0.18);
    doc.setFillColor(fill, fill, fill); doc.roundedRect(x, y, w, h, 1.2, 1.2, "FD");
  };
  const first = { groups: [], start: 0, end: 0 };
  const pages = [first];
  drawProgreOrderHeader(doc);
  text(title, 7, 41, 14, true);
  const destination = [source.destination?.name, source.destination?.address, source.destination?.postalCode, source.destination?.city, source.destination?.province, source.destination?.country].filter(Boolean).join(" - ") || "Come da ordine Mexal / As per Mexal order";
  doc.setFontSize(8);
  const info = [
    `Ordine / Order: OCM ${source.series}/${source.number} - ${source.year}`,
    `Cliente / Customer: ${source.customerName} (${source.customerCode})`,
    `Destinazione / Delivery address: ${destination}`,
    ddt ? `DDT / Delivery note: ${ddt.signature || "BCS"} ${ddt.series}/${ddt.number} - ${date(ddt.date)}` : "DDT non ancora emesso / Delivery note not issued",
  ].map(line => doc.splitTextToSize(line, 188));
  const infoHeight = info.reduce((n, lines) => n + lines.length * 3.5 + 1, 0) + 4;
  if (infoHeight > 125) throw new Error("Dati intestazione troppo estesi per la packing list.");
  frame(7, 46, 196, infoHeight);
  let iy = 52;
  for (const lines of info) { text(lines, 11, iy); iy += lines.length * 3.5 + 1; }
  first.start = first.end = 46 + infoHeight + 3;

  const weight = n => n == null ? "N/D / N/A" : Number(n).toLocaleString("it-IT",{minimumFractionDigits:3,maximumFractionDigits:3}) + " Kg";
  const totalsY = 252;
  const pallets = [...summary.pallets].sort((a,b) => a.number - b.number);
  if (summary.packages.some(p => !p.palletId)) pallets.push({ id: null, number: null });
  // Measure before drawing: reserve the summary only on the final content page.
  // If it overflows, move actual boxes/rows with it rather than adding a totals-only page.
  const layout = (summaryPage = Infinity) => {
    const result = [{groups:[],start:first.start,end:first.start}];
    let page = result[0];
    const limit = () => result.length - 1 >= summaryPage ? totalsY - 3 : 279;
    const nextPage = () => { page={groups:[],start:44,end:44};result.push(page); };
    for (const pallet of pallets) {
      const packages = summary.packages.filter(p => (p.palletId || null) === pallet.id).sort((a,b) => a.number - b.number);
      if (!packages.length) continue;
      let group;
      const newGroup = continued => {
        group = {pallet,packages:[],top:page.end,height:continued?11:8,continued,
          boxCount:packages.length,pieceCount:packages.reduce((n,p)=>n+p.pieces,0)};
        page.groups.push(group);page.end=group.top+group.height;
      };
      // A heading must have room for the first row, not occupy a page by itself.
      if(page.end+31>limit())nextPage();
      newGroup(false);
      for(const pack of packages) {
        const rows=pack.contents.flatMap(row=>{
          doc.setFont("helvetica","normal");doc.setFontSize(7.5);
          const description=String(row.description || row.code).replace(/\s+/g," ").trim();
          const descriptionSize=Math.min(7.5,7.5*115/Math.max(doc.getTextWidth(description),1));
          const lines=[description];
          const lotLines=doc.splitTextToSize(String(row.lotCode || "Non gestito / N/A"),29);
          const chunks=[],lineCount=Math.max(lines.length,lotLines.length);
          for(let i=0;i<lineCount;i+=35)chunks.push({...row,descriptionLines:lines.slice(i,i+35),descriptionSize,lotLines:lotLines.slice(i,i+35),quantity:i===0?row.quantity:"",height:Math.max(4.5,Math.min(35,lineCount-i)*3.3+1)});
          return chunks;
        });
        if(!rows.length)rows.push({code:"-",quantity:0,descriptionLines:["Vuoto / Empty"],lotLines:["-"],height:4.5});
        let offset=0;
        while(offset<rows.length){
          const remainingHeight=rows.slice(offset).reduce((n,r)=>n+r.height,0)+13;
          if((page.end+remainingHeight+2>limit() && remainingHeight+11<=totalsY-3-44 && group.packages.length) || page.end+rows[offset].height+15>limit()){
            // Remove a heading if even a very tall first row had to move.
            if(!group.packages.length){page.groups.pop();page.end=group.top;}
            nextPage();newGroup(offset>0 || packages.indexOf(pack)>0);
          }
          const chunk={pack,rows:[],top:page.end,continued:offset>0,height:13};
          while(offset<rows.length && page.end+chunk.height+rows[offset].height+2<=limit()){
            chunk.rows.push(rows[offset]);chunk.height+=rows[offset].height;offset++;
          }
          group.packages.push(chunk);page.end+=chunk.height+1;
          group.height=page.end-group.top+0.5;
          if(offset<rows.length){nextPage();newGroup(true);}
        }
      }
      page.end+=2;
    }
    return result;
  };
  let measured=layout();
  if(measured.at(-1).end>totalsY-3)measured=layout(measured.length-1);
  pages.splice(0,pages.length,...measured);
  for(let index=0;index<pages.length;index++) {
    if(index){doc.addPage();drawProgreOrderHeader(doc);text(title,7,38,11,true);}
    for(const group of pages[index].groups) {
      frame(7,group.top,196,group.height,249);
      frame(7,group.top,196,group.continued?10:7,242);
      text(group.pallet.number ? `PALLET ${group.pallet.number}` : "SENZA PALLET / NO PALLET",11,group.top+4.4,9,true);
      text(`Peso netto / Net weight: ${weight(group.pallet.netWeightKg)}`,43,group.top+4.4,7);
      text(`Peso lordo / Gross weight: ${weight(group.pallet.grossWeightKg)}`,104,group.top+4.4,7);
      text(`${group.boxCount} ${group.boxCount===1?"collo":"colli"} / ${boxWord(group.boxCount)}`,199,group.top+4.4,7,true,"right");
      if(group.continued)text("continua / continued",199,group.top+8.2,6.5,false,"right");
      for(const chunk of group.packages) {
        const y=chunk.top;
        frame(11,y,188,chunk.height);
        text(`COLLO / BOX ${chunk.pack.number}`,14,y+4.2,8,true);
        text(`Peso netto / Net weight: ${weight(chunk.pack.netWeightKg)}`,65,y+4.2,7);
        text(`Peso lordo / Gross weight: ${weight(chunk.pack.grossWeightKg)}`,132,y+4.2,7);
        text(`CODICE / ITEM${chunk.continued ? " *" : ""}`,14,y+8.4,5.7,true);text("PRODOTTO / PRODUCT",36,y+8.4,5.7,true);
        text("LOTTO / BATCH",155,y+8.4,5.7,true);text(`PZ / PCS (${chunk.pack.pieces})`,196,y+8.4,5.7,true,"right");
        let ry=y+12.5;
        for(const row of chunk.rows) {
          text(row.code,14,ry,7.5,true);text(row.descriptionLines,36,ry,row.descriptionSize || 7.5);
          text(row.lotLines,155,ry,7.5);text(row.quantity,196,ry,8,true,"right");
          ry+=row.height;
        }
      }
    }
  }
  frame(7,totalsY,196,27,242);
  for(const [x,label,value] of [[11,"TOTALE PALLET / TOTAL PALLETS",summary.totalPallets],[77,"TOTALE COLLI / TOTAL BOXES",summary.totalPackages],[143,"TOTALE PEZZI / TOTAL PIECES",summary.totalPieces]]){
    text(label,x,totalsY+5.5,6.5,true);text(value,x,totalsY+14,14,true);
  }
  text(`Peso netto totale / Total net weight: ${weight(summary.weightTotals?.netWeightKg)}`,11,totalsY+22,8,true);
  text(`Peso lordo totale / Total gross weight: ${weight(summary.weightTotals?.grossWeightKg)}`,199,totalsY+22,8,true,"right");
  const count=doc.getNumberOfPages();
  for(let i=1;i<=count;i++){
    doc.setPage(i);text("PROGRE’ SRL | Packing list - Italiano / English",7,290,6.5);
    text(`Pagina / Page ${i} / ${count}`,203,290,6.5,false,"right");
  }
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
