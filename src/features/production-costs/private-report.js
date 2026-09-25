// Explicit public projection: no snapshots, rates, forecasts or personnel are sent.
export function privateProductionRecord(r) {
 const number=v=>v!=null&&v!==''&&Number.isFinite(Number(v))?Number(v):null;
 const oct=number(r.commercial?.octRevenue), actual=number(r.actualTotal);
 const assigned=number(r.quantity), worked=number(r.goodQuantity);
 const workedOct=oct!=null&&!r.commercial?.octPartial&&assigned>0&&worked!=null&&worked>=0 ? oct*Math.min(worked,assigned)/assigned : null;
 const excess=actual!=null&&workedOct!=null&&worked>0&&actual>workedOct ? Math.round((actual-workedOct)*100)/100 : null;
 const row={id:r.id,customer:r.customerName||r.customer||r.customerCode||'',articleCode:r.articleCode,description:r.articleName||r.description||r.articleDescription||'',order:r.number||r.orderNumber||String(r.id),octReferences:[...new Set((r.links||[]).map(l=>l.oct).filter(Boolean))],date:r.start||r.createdAt||null,state:r.closed?'Conclusa':'In lavorazione',octValue:oct,actualTotal:actual,workedOct,excess:excess>0?excess:null};
 if(row.excess!=null)row.detail={workedQuantity:worked,unit:r.unit,costs:[['Materie prime',r.actualMaterialCost],['Confezionamento',r.actualPackagingCost],['Personale',r.actualLabor],['Lavaggi',r.actualWash],['Perdite',r.lossCost]].map(([label,value])=>({label,value:number(value)})),phases:(r.phases||[]).map(p=>({id:p.id,phase:p.phase,machine:p.machine?.name||p.machineName||'',start:p.start,end:p.end,hours:number(p.actualHours),quantity:number(p.goodQuantity)}))};
 return row;
}
export function privateProductionSummary(rows) {
 const octRows=rows.filter(r=>r.octValue!=null);
 const complete=rows.length>0&&rows.every(r=>r.actualTotal!=null&&r.workedOct!=null);
 const difference=complete?rows.reduce((s,r)=>s+r.actualTotal-r.workedOct,0):null;
 return {octValue:octRows.length?octRows.reduce((s,r)=>s+r.octValue,0):null,octPartial:octRows.length!==rows.length,excess:difference>0?Math.round(difference*100)/100:null,comparisonComplete:complete};
}

