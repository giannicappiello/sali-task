export const total=(rows,key)=>{const values=rows.map(r=>r[key]).filter(v=>v!=null);return values.length?values.reduce((a,b)=>a+b,0):null;};
export const pairedDifference=(rows,left,right)=>{const pairs=rows.filter(r=>r[left]!=null&&r[right]!=null);return pairs.length?pairs.reduce((s,r)=>s+r[left]-r[right],0):null;};
export function summaryGroups(rows){
 const matched=rows.filter(r=>r.oct!=null&&r.actual!=null&&!r.octPartial);
 const invoiced=rows.filter(r=>r.invoice!=null);
 return {matched,excluded:rows.filter(r=>!matched.includes(r)),invoiced,uninvoiced:rows.filter(r=>r.invoice==null),invoiceOc:invoiced.filter(r=>r.oct!=null&&!r.octPartial)};
}

export function conclusionDate(works=[]){
 const active=works.filter(w=>String(w.state||'').toLowerCase()!=='annullato');
 if(!active.length||active.some(w=>!w.end||!Number.isFinite(Date.parse(w.end))))return null;
 return active.reduce((latest,w)=>Date.parse(w.end)>Date.parse(latest)?w.end:latest,active[0].end);
}
