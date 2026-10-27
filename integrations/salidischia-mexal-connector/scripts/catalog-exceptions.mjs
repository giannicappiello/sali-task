import {readFile,writeFile} from 'node:fs/promises';
const report=JSON.parse(await readFile('output/catalog-last-run.json','utf8'));
const excluded=report.results.filter(x=>['attention-required','skipped','unmapped','excluded'].includes(x.mode));
const headers={Authorization:`Basic ${Buffer.from(`${process.env.WOO_CONSUMER_KEY}:${process.env.WOO_CONSUMER_SECRET}`).toString('base64')}`};
const url=new URL('/wp-json/wc/v3/products',process.env.WOO_URL);
url.search=new URLSearchParams({include:excluded.map(x=>x.id).join(','),per_page:'100',_fields:'id,name,sku,status,type'});
const response=await fetch(url,{headers,redirect:'error',signal:AbortSignal.timeout(30000)});
if(!response.ok)throw Error(`Lettura schede escluse: HTTP ${response.status}`);
const details=await response.json();
// The product collection omits variation IDs; read those individually.
for(const item of excluded.filter(x=>!details.some(p=>p.id===x.id))){
 const detailUrl=new URL(`/wp-json/wc/v3/products/${item.id}`,process.env.WOO_URL);detailUrl.search=new URLSearchParams({_fields:'id,name,sku,status,type,parent_id'});
 const found=await fetch(detailUrl,{headers,redirect:'error',signal:AbortSignal.timeout(30000)});
 if(!found.ok)throw Error(`Scheda ${item.id}: HTTP ${found.status}`);
 const detail=await found.json();if(detail.id!==item.id)throw Error('Scheda eccezione diversa.');details.push(detail);
}
const lines=['Prodotti esclusi dalla sincronizzazione Mexal → sito',`Controllo: ${new Date().toISOString()}`,'',
 'Nessuna modifica applicata a queste schede. Non è stato inventato un codice o un prezzo mancante.',''];
for(const item of excluded){
 const detail=details.find(x=>x.id===item.id);
 lines.push(`${item.id} | ${detail?.name||''} | SKU: ${item.sku||'(assente)'} | ${detail?.status||''} | ${detail?.type||''} | ${item.reason}`);
}
await writeFile('output/catalog-eccezioni.txt',lines.join('\n'));
console.log(JSON.stringify({excluded:excluded.length,published:details.filter(x=>x.status==='publish').length,missingCodes:[...new Set(excluded.filter(x=>x.sku).map(x=>x.sku))]}));
