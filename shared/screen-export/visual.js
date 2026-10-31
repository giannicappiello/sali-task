import html2canvas from 'html2canvas';
import { tableHeaders } from './capture.js';

export function addVisualTotals(report) {
  const groups = new Map();
  for (const block of report.blocks.filter(block=>block.type==='table')) {
    const key = block.key ?? ''; if (!groups.has(key)) groups.set(key,[]); groups.get(key).push(block);
  }
  for (const table of report.visualRoot.querySelectorAll('table')) {
    const block = groups.get(table.dataset.exportTableIndex ?? '')?.shift();
    // Rebuild native total rows from the normalized export, so repeated page
    // footers never survive as pixels in the visual report.
    for(const row of table.querySelectorAll('tbody > tr,tfoot > tr')) {
      if(row.closest('table')===table && [...row.children].some(cell=>/^(?:totale(?:\s|$)|total(?:\s|$)|grand total|page total)/i.test(cell.textContent.trim())))row.remove();
    }
    for(const footer of table.querySelectorAll('tfoot'))if(!footer.children.length)footer.remove();
    if (!block || table.querySelector('tfoot')) continue;
    const totals = block.rows.filter(row=>row.some(cell=>/^(?:totale(?:\s|$)|total(?:\s|$)|grand total)/i.test(String(cell || '').trim())));
    if (!totals.length) continue;
    const headers = tableHeaders(table), footer = table.ownerDocument.createElement('tfoot');
    totals.forEach(row=>{
      const tr = footer.insertRow();
      headers.forEach(header=>{
        const cell=tr.insertCell(); cell.textContent = row[block.headers.indexOf(header)] || '';
        cell.style.cssText = 'padding:10px;border-top:1px solid #cadbf0;background:#e2edf5;color:#112640;font-weight:700;text-align:right';
        if (/^Totale /.test(cell.textContent)) cell.style.textAlign = 'left';
      });
    });
    table.append(footer);
  }
}

export function layoutBands(height, pageHeight, rectangles = []) {
  const bands=[];
  for (let y=0; y<height;) {
    let end=Math.min(height,y+pageHeight);
    // Keep cards, charts and ordinary table rows together whenever they fit.
    const crossing=rectangles.filter(rect=>rect.top>y+32 && rect.bottom>end && rect.top<end && rect.bottom-rect.top<=pageHeight);
    if (crossing.length && end<height) end=Math.min(...crossing.map(rect=>rect.top));
    bands.push({y,height:Math.max(1,end-y)}); y=end;
  }
  return bands;
}

export async function renderVisualPages(report, { signal, progress = () => {} } = {}) {
  if (!report.visualRoot) throw new Error('La struttura visiva della schermata non è disponibile.');
  addVisualTotals(report);
  const doc=report.visualRoot.ownerDocument;
  const host=doc.createElement('div'); host.dataset.reportExport='';
  // A separate rendering surface leaves the live application's layout untouched.
  host.style.cssText='position:fixed;left:0;top:0;z-index:-2147483647;pointer-events:none;background:white;overflow:visible;contain:layout style';
  host.style.width=report.visualRoot.style.width; host.append(report.visualRoot); doc.body.append(host);
  const resourceUrls=[];
  try {
    await doc.fonts?.ready; signal?.throwIfAborted();
    await Promise.all([...host.querySelectorAll('img')].map(async image=>{
      try {
        const url=new URL(image.src,doc.location.href);
        if (url.origin!==doc.location.origin && !['data:','blob:'].includes(url.protocol)) {
          const response=await fetch(url,{mode:'cors',credentials:'omit',signal:signal ? AbortSignal.any([signal,AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000)});
          if(!response.ok)throw new Error('Image unavailable');
          const local=URL.createObjectURL(await response.blob());resourceUrls.push(local);image.src=local;
        }
        await image.decode();
      } catch { throw new Error('Un’immagine della schermata non è disponibile per l’esportazione. Riprova dopo il caricamento.'); }
    }));
    const rect=host.getBoundingClientRect();
    const width=Math.ceil(Math.max(rect.width,host.scrollWidth));
    const height=Math.ceil(Math.max(rect.height,host.scrollHeight));
    if (!width || !height) throw new Error('La schermata non contiene una superficie esportabile.');
    const rectangles=[...host.querySelectorAll('tr,svg,img,[class*="kpi-card"],.card,p,label,h1,h2,h3,h4')].map(node=>{const r=node.getBoundingClientRect();return {top:Math.floor(r.top-rect.top),bottom:Math.ceil(r.bottom-rect.top)};});
    const bands=layoutBands(height,Math.floor(width*240/178),rectangles);
    const pages=[];
    for (const [index,band] of bands.entries()) {
      signal?.throwIfAborted(); progress(`Riproduzione della schermata · pagina ${index+1} di ${bands.length}…`);
      const canvas=await html2canvas(host,{backgroundColor:'#ffffff',scale:1.5,width,height:band.height,x:0,y:band.y,scrollX:0,scrollY:0,windowWidth:doc.documentElement.clientWidth,windowHeight:doc.documentElement.clientHeight,logging:false,useCORS:true,allowTaint:false});
      signal?.throwIfAborted();
      pages.push({dataUrl:canvas.toDataURL('image/png'),pdfDataUrl:canvas.toDataURL('image/jpeg',0.92),width:canvas.width,height:canvas.height});
      canvas.width=1; canvas.height=1;
    }
    return pages;
  } finally { host.remove(); resourceUrls.forEach(url=>URL.revokeObjectURL(url)); delete report.visualRoot; }
}
