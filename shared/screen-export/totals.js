import { activeDialogs, captureCompleteReport, cloneContent, collectionFor, contentBlocks, exclusiveReportRead, findPagers, tableHeaders, visible } from './capture.js';

const providers = new WeakMap();
const providerSums = new WeakMap();
const text = node => [...node.childNodes].map(child => child.nodeType === 3 ? child.textContent : text(child)).join(' ').replace(/\s+/g,' ').trim();
const identifier = /\b(codice|code|id|ean|barcode|lotto|numero ordine|priorit[aà]|data|date|anno|telefono|cap|partita iva)\b/i;
const description = /^(cliente|articolo|prodotto|descrizione|nome|numero|n[.°º]?|agente|operatore|impianto|magazzino)$/i;
const totalLabel = /^(?:totale|totali|total|grand total|subtotale|somma)(?:\s|$)/i;

export function registerTableTotals(table, getRows) {
  if (!table) return () => {};
  providers.set(table,getRows);
  table.dispatchEvent(new CustomEvent('progre:totals-data',{bubbles:true}));
  return () => { if (providers.get(table) === getRows) providers.delete(table); };
}

export function numericParts(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? [{value,unit:'',digits:Number.isInteger(value)?0:3}] : [];
  const source = String(value ?? '').replace(/\u00a0/g,' ').replaceAll('−','-').trim();
  if (!source || /^0\d/.test(source) || /\d[/-]\d|\d:\d/.test(source)) return [];
  const matches = [...source.matchAll(/[+-]?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?(?:\.\d+)?/g)];
  // Every part of a value must belong to a measure. Multiple numbers in
  // customer names, article codes or other prose are not additive values.
  const residue = source.replace(/[+-]?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?(?:\.\d+)?/g, '')
    .replace(/\b(?:EUR|USD|GBP|kg|g|l|ml|pz|pezzi|gg|giorni|ore|h|min|clienti|ordini|fatture|righe|articoli)\b/gi, '')
    .replace(/[€$£%\s·•;,|()+-]/g, '');
  if (residue) return [];
  const result = [];
  for (let i=0;i<matches.length;i++) {
    const match=matches[i], raw=match[0];
    const suffix=source.slice(match.index+raw.length,matches[i+1]?.index ?? source.length).trim();
    const prefix=source.slice(i ? matches[i-1].index+matches[i-1][0].length : 0,match.index).trim();
    const unit=(suffix.match(/^(€|EUR|USD|GBP|%|kg|g|l|ml|pz|pezzi|gg|giorni|ore|h|min|clienti|ordini|fatture|righe|articoli)\b/i) || suffix.match(/^(€|%)/))?.[1]
      || prefix.match(/[€$£]$/)?.[0] || '';
    // Ordinary prose containing an incidental number is not a numeric measure.
    if (matches.length===1 && ((prefix && !/^[€$£]$/.test(prefix)) || (suffix && !unit))) continue;
    const normalized=raw.includes(',') ? raw.replaceAll('.','').replace(',','.') : /^\d{1,3}(?:\.\d{3})+$/.test(raw) ? raw.replaceAll('.','') : raw;
    const value=Number(normalized);
    const decimals=raw.includes(',')?raw.split(',')[1].length:normalized.includes('.')?normalized.split('.')[1].length:0;
    if (Number.isFinite(value)) result.push({value,unit:unit==='EUR'?'€':unit,digits:unit==='€'?2:Math.min(6,decimals)});
  }
  return result;
}

export function hasExistingTotals(table) {
  if (table.querySelector('tfoot:not([data-report-totals])')) return true;
  return [...table.querySelectorAll('tbody > tr')].some(row => !row.closest('[data-report-totals]') && [...row.children].some(cell=>totalLabel.test(text(cell))));
}

export function tableData(table) {
  const headers=tableHeaders(table);
  const rows=[...table.querySelectorAll('tbody > tr')].filter(row => row.closest('table')===table && !row.closest('[data-report-totals]') && visible(row))
    .filter(row=>row.children.length===headers.length && ![...row.children].some(cell=>cell.colSpan>1))
    .map(row=>[...row.children].map(text));
  return {headers,rows};
}

export function sumColumns(headers, rows) {
  const unitIndex=headers.findIndex(header=>/^(udm|um|u\.m\.|unit[aà](?: di misura)?)$/i.test(header));
  return headers.map((header,index)=>{
    if (identifier.test(header) || header.split(/\s*[/·|]\s*/).some(part=>description.test(part))) return [];
    const buckets=new Map();
    for(const row of rows){
      for(const part of numericParts(row[index])){
        const unit=part.unit || (unitIndex>=0 && /quantit|giacenz|disponibil|impegnat|peso|consum/i.test(header) ? String(row[unitIndex] || '') : '');
        const bucket=buckets.get(unit) || {value:0,correction:0,unit,digits:part.digits};
        // Compensated addition avoids cumulative floating point drift.
        const delta=part.value-bucket.correction, next=bucket.value+delta;
        bucket.correction=(next-bucket.value)-delta;bucket.value=next;bucket.digits=Math.max(bucket.digits,part.digits);
        buckets.set(unit,bucket);
      }
    }
    return [...buckets.values()];
  });
}
export function formatColumnTotal(parts) {
  return parts.map(part=>`${new Intl.NumberFormat('it-IT',{useGrouping:'always',minimumFractionDigits:part.unit==='€'?2:0,maximumFractionDigits:Math.max(part.unit==='€'?2:0,part.digits)}).format(part.value)}${part.unit?' '+part.unit:''}`).join(' · ');
}

function footerRow(headers, totals, label, doc) {
  const row=doc.createElement('tr');row.dataset.totalKind=label;
  const labelColumn=headers.findIndex((_,index)=>!totals[index].length);
  headers.forEach((_,index)=>{
    const cell=doc.createElement(index===Math.max(0,labelColumn)?'th':'td');
    const value=formatColumnTotal(totals[index]);
    cell.textContent=index===Math.max(0,labelColumn) ? `${label}${value?' · '+value:''}` : value;
    if(cell.tagName==='TH')cell.scope='row';
    cell.style.textAlign=totals[index].length?'right':'left';row.append(cell);
  });
  return row;
}

export function appendReportTotals(report) {
  const groups=new Map();
  for(const block of report.blocks.filter(block=>block.type==='table')) {
    const key=block.key ?? block;
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push(block);
  }
  for(const blocks of groups.values()) {
    if(blocks.some(block=>block.rows.some(row=>row.some(cell=>totalLabel.test(String(cell || ''))))))continue;
    const headers=blocks[0].headers;
    const general=sumColumns(headers,blocks.flatMap(block=>block.rows));
    if(!general.some(parts=>parts.length))continue;
    const labelColumn=general.findIndex(parts=>!parts.length);
    const values=(totals,label)=>headers.map((_,index)=>index===Math.max(0,labelColumn)?`${label}${totals[index].length?' · '+formatColumnTotal(totals[index]):''}`:formatColumnTotal(totals[index]));
    blocks.forEach(block=>block.rows.push(values(sumColumns(headers,block.rows),'Totale pagina')));
    blocks.at(-1).rows.push(values(general,'Totale generale'));
  }
  return report;
}

// Native datasets can supply complete rows without navigating. The fallback
// reads the same authorized paginated UI with a progress layer, then restores
// the starting page. No row action, form submission or machine API is invoked.
export function installTableTotals({doc=document}={}) {
  let timer,stopped=false,reading=false;
  const cache=new Map();
  const update=async()=>{
    if(stopped || reading || doc.documentElement.dataset.progreReportReading) {schedule();return;}
    const root=activeDialogs(doc).at(-1) || doc.querySelector('.content-area,main .content,main');
    if(!root)return;
    const allTables=[...root.querySelectorAll('table')];
    const tables=allTables.filter(visible);
    const pending=[];
    const filters=[...root.querySelectorAll('input:not([type=password]):not([type=hidden]),select')].filter(visible).map(node=>[node.name || node.getAttribute('aria-label'),node.value,node.checked]);
    const route=new URL(doc.location.href);[...route.searchParams.keys()].filter(key=>/page|pagina/i.test(key)).forEach(key=>route.searchParams.delete(key));
    for(const table of tables){
      const index=allTables.indexOf(table);
      if(hasExistingTotals(table))continue;
      const data=tableData(table), page=sumColumns(data.headers,data.rows);
      if(!page.some(parts=>parts.length)){table.querySelector('tfoot[data-report-totals]')?.remove();continue;}
      let footer=table.querySelector('tfoot[data-report-totals]');
      if(!footer){footer=doc.createElement('tfoot');footer.dataset.reportTotals='';table.append(footer);}
      const key=JSON.stringify([route.pathname+route.search,root.querySelector('h1,h2,h3')?.textContent,index,data.headers,filters,[...table.querySelectorAll('[aria-sort]')].map(node=>node.getAttribute('aria-sort'))]);
      const normalized=contentBlocks(cloneContent(table)).find(block=>block.type==='table') || data;
      const fingerprint=JSON.stringify(normalized.rows);
      let general;
      const provider=providers.get(table);
      const paged=findPagers(root).some(pager=>{
        try {const collection=collectionFor(pager,root);return collection===table || collection.contains(table) && !table.closest('article');}
        catch {return true;}
      });
      if(provider) {
        try{
          let cacheByHeader=providerSums.get(provider);
          if(!cacheByHeader){cacheByHeader=new Map();providerSums.set(provider,cacheByHeader);}
          const headerKey=JSON.stringify(data.headers);
          if(!cacheByHeader.has(headerKey))cacheByHeader.set(headerKey,Promise.resolve(provider()).then(rows=>sumColumns(data.headers,rows)));
          general=await cacheByHeader.get(headerKey);
        }
        catch(error){cache.set(key,{totals:null,pages:new Set([fingerprint]),failed:true});footer.title=error.message;}
      }
      else if(!paged)general=page;
      else if(cache.get(key)?.pages.has(fingerprint))general=cache.get(key).totals;
      else pending.push({key,headers:data.headers,index,fingerprint});
      const desired=doc.createElement('tfoot');
      desired.append(footerRow(data.headers,page,'Totale pagina',doc));
      desired.append(footerRow(data.headers,general || data.headers.map(()=>[]),'Totale generale',doc));
      if(!general) {
        [...desired.lastElementChild.children].forEach((cell,i)=>{if(page[i].length)cell.textContent=cache.get(key)?.failed?'Non disponibile':'Calcolo…';});
      }
      if(footer.innerHTML!==desired.innerHTML)footer.replaceChildren(...desired.childNodes);
    }
    if(!pending.length)return;
    reading=true;
    const progress=doc.createElement('div');progress.dataset.reportExport='';progress.className='progre-totals-progress';progress.setAttribute('role','status');progress.textContent='Calcolo dei totali generali…';
    doc.body.append(progress);
    try{
      await exclusiveReportRead(async()=>{
        const wasInert=root.inert; root.inert=true;root.classList.add('progre-totals-reading');
        try{
          const report=await captureCompleteReport({root,title:'Totali',progress:value=>{progress.textContent=`Calcolo totali · ${value}`;}});
          for(const request of pending){
            const blocks=report.blocks.filter(block=>block.type==='table' && block.key===String(request.index));
            if(!blocks.length)continue;
            // The capture omits action columns. Align by the original header.
            const rows=blocks.flatMap(block=>block.rows.map(row=>request.headers.map(header=>row[block.headers.indexOf(header)] ?? '')));
            cache.set(request.key,{totals:sumColumns(request.headers,rows),pages:new Set([request.fingerprint,...blocks.map(block=>JSON.stringify(block.rows))])});
          }
        }finally{root.inert=wasInert;root.classList.remove('progre-totals-reading');}
      },doc);
    }catch(error){
      for(const table of tables)for(const cell of table.querySelectorAll('[data-report-totals] td'))if(cell.textContent==='Calcolo…'){cell.textContent='Non disponibile';cell.title=error.message;}
      // A failed read is retried after a real data change, not in a tight loop.
      for(const request of pending)cache.set(request.key,{totals:null,pages:new Set([request.fingerprint]),failed:true});
    }finally{reading=false;progress.remove();schedule();}
  };
  function schedule(){if(stopped)return;clearTimeout(timer);timer=setTimeout(()=>{void update();},700);}
  const observer=new MutationObserver(records=>{
    if(records.every(record=>record.target.closest?.('[data-report-totals],[data-report-export]')))return;
    schedule();
  });
  observer.observe(doc.body,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','aria-hidden','aria-sort','open']});
  doc.addEventListener('progre:totals-data',schedule);doc.addEventListener('change',schedule);schedule();
  return()=>{stopped=true;clearTimeout(timer);observer.disconnect();doc.removeEventListener('progre:totals-data',schedule);doc.removeEventListener('change',schedule);doc.querySelectorAll('[data-report-totals]').forEach(node=>node.remove());};
}
