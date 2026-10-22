const number = value => Number(String(value ?? 0).replace(',','.'));
const indexed = value => new Map(Array.isArray(value) ? value : Object.entries(value || {}).map(([k,v])=>[Number(k),v]));
const round = value => Math.round(value*1e6)/1e6;

export function warehouseLotStock(page) {
  const fields=Object.fromEntries(['cod_articolo','id_magazzino','id_lotto','qta_inventario','qta_carico','qta_scarico'].map(key=>[key,indexed(page[key])]));
  return [...fields.cod_articolo].filter(([i])=>number(fields.id_magazzino.get(i))===4 && number(fields.id_lotto.get(i))>0).map(([i,code])=>({code:String(code).trim(),lotId:number(fields.id_lotto.get(i)),quantity:round(number(fields.qta_inventario.get(i))+number(fields.qta_carico.get(i))-number(fields.qta_scarico.get(i)))}));
}

export function applyFifoLots(payload, articles, lots, stock) {
  const quantities=new Map();
  for(const row of stock) quantities.set(row.code+':'+row.lotId,round((quantities.get(row.code+':'+row.lotId)||0)+row.quantity));
  const ids=[],amounts=[],positions=[],counts=[],decimals=[];
  const requested=new Map(payload.quantita);
  for(const [row,code] of payload.codice_articolo) {
    if(!String(articles.get(code)?.cod_tp_lotto || '').trim()) continue;
    let remaining=number(requested.get(row)),count=0;
    const candidates=lots.filter(l=>l.cod_articolo===code && l.stato==='C' && l.caricato==='S' && /^\d{8}$/.test(l.data_carico) && l.data_carico<=payload.data_documento && (!l.data_validita || l.data_validita>=payload.data_documento))
      .sort((a,b)=>a.data_carico.localeCompare(b.data_carico)||Number(a.id)-Number(b.id));
    for(const lot of candidates) {
      const key=code+':'+lot.id,available=quantities.get(key)||0;
      if(!Number.isFinite(available)||available<=0) continue;
      const take=round(Math.min(remaining,available));
      if(!count) positions.push([row,ids.length+1]);
      const i=ids.length+1;ids.push([i,Number(lot.id)]);amounts.push([i,take]);decimals.push([i,6]);count++;
      quantities.set(key,round(available-take));remaining=round(remaining-take);
      if(!remaining) break;
    }
    if(remaining) throw new Error(`Lotti FIFO insufficienti nel magazzino 4 per ${code}: mancano ${remaining}. COX non emesso.`);
    counts.push([row,count]);
  }
  return {...payload,id_lotto:ids,qta_lotto:amounts,pos_righe_lotto:positions,nr_righe_lotto:counts,dec_qta_lotto:decimals};
}

export async function prepareFifoLots(mexal,payload,articles) {
  const codes=[...new Set(payload.codice_articolo.map(([,code])=>code).filter(code=>String(articles.get(code)?.cod_tp_lotto||'').trim()))];
  if(!codes.length) return payload;
  const stock=[],lots=[];
  let next;const seen=new Set();
  do {
    const page=await mexal.getJson('/progressivi-articoli?max=500'+(next?'&next='+encodeURIComponent(next):''));
    if(!page.cod_articolo || !page.id_magazzino) throw new Error('Giacenze per lotto Mexal non verificabili: COX non emesso.');
    stock.push(...warehouseLotStock(page).filter(row=>codes.includes(row.code)));
    next=page.next;if(next && seen.has(next)) throw new Error('Cursore giacenze ripetuto.');seen.add(next);
    if(seen.size>50) throw new Error('Lettura giacenze troppo estesa.');
  } while(next);
  for(const code of codes) {
    next=null;const seenLots=new Set();
    do {
      const page=await mexal.postJson('/lotti/ricerca?max=100'+(next?'&next='+encodeURIComponent(next):''),{filtri:[{campo:'cod_articolo',condizione:'=',valore:code}]});
      if(!Array.isArray(page.dati)) throw new Error('Elenco lotti Mexal non valido.');
      lots.push(...page.dati.filter(row=>row.cod_articolo===code));
      next=page.next;if(next && seenLots.has(next)) throw new Error('Cursore lotti ripetuto.');seenLots.add(next);
      if(seenLots.size>50) throw new Error('Lettura lotti troppo estesa.');
    } while(next);
  }
  return applyFifoLots(payload,articles,lots,stock);
}
