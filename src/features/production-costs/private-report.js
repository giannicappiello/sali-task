import {availableCosts} from './available-costs.js';
// Explicit public projection: no snapshots, rates, forecasts or personnel are sent.
export function privateProductionRecord(r) {
 const number=v=>v!=null&&v!==''&&Number.isFinite(Number(v))?Number(v):null;
 const available=availableCosts(r);
 const oct=number(r.commercial?.octRevenue), actual=number(available.values.actualTotal);
 const actualPartial=actual!=null&&available.partial.actualTotal;
 const assigned=number(r.quantity), worked=number(r.goodQuantity);
 const workedOct=oct!=null&&!r.commercial?.octPartial&&assigned>0&&worked!=null&&worked>=0 ? oct*Math.min(worked,assigned)/assigned : null;
 const compared=available.values.actualWithObjective;
 const excess=compared!=null&&workedOct!=null&&worked>0&&compared>workedOct ? Math.round((compared-workedOct)*100)/100 : null;
 const row={id:r.id,customer:r.customerName||r.customer||r.customerCode||'',articleCode:r.articleCode,description:r.articleName||r.description||r.articleDescription||'',order:r.number||r.orderNumber||String(r.id),octReferences:[...new Set((r.links||[]).map(l=>l.oct).filter(Boolean))],date:r.start||r.createdAt||null,state:r.closed?'Conclusa':'In lavorazione',octValue:oct,actualTotal:actual,comparisonTotal:compared,stationObjective:available.values.plannedObjective,realGainPerShift:available.values.realGainPerShift,invoiceValue:r.commercial?.invoiceRevenue??null,invoiceReferences:(r.commercial?.invoices||[]).map(x=>`${x.document?.sigla||"FT"} ${x.document?.serie}/${x.document?.numero}`),actualPartial,octReasons:r.commercial?.octReasons||[],workedOct,excess:excess>0?excess:null};
 if(row.excess!=null)row.detail={workedQuantity:worked,unit:r.unit,costs:[['Materie prime',available.values.actualMaterialCost],['Confezionamento',available.values.actualPackagingCost],['Personale',available.values.actualLabor],['Lavaggi',available.values.actualWash],['Perdite',available.values.lossCost]].map(([label,value])=>({label,value:number(value)})),phases:(r.phases||[]).map(p=>({id:p.id,phase:p.phase,machine:p.machine?.name||p.machineName||'',start:p.start,end:p.end,hours:number(p.actualHours),quantity:number(p.goodQuantity)}))};
 return row;
}
export function privateProductionSummary(rows) {
 const octRows=rows.filter(r=>r.octValue!=null);
 const comparable=rows.filter(r=>r.comparisonTotal!=null&&r.workedOct!=null);
 const excluded=rows.filter(r=>!comparable.includes(r));
 const difference=comparable.length?comparable.reduce((s,r)=>s+r.comparisonTotal-r.workedOct,0):null;
 return {octValue:octRows.length?octRows.reduce((s,r)=>s+r.octValue,0):null,octPartial:octRows.length!==rows.length,excess:difference>0?Math.round(difference*100)/100:null,comparisonComplete:excluded.length===0,actualPartial:comparable.some(r=>r.actualPartial),comparableCount:comparable.length,excluded,excludedCost:excluded.some(r=>r.actualTotal!=null)?excluded.reduce((s,r)=>s+(r.actualTotal??0),0):null};
}
