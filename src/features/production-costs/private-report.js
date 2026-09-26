import {invoiceReferences} from './invoice-summary.js';
import {conclusionDate,isSaliDiIschia} from './summary-totals.js';
import {octReference} from './oct-evidence.js';
import {availableCosts} from './available-costs.js';
// Explicit public projection: no snapshots, rates, forecasts or personnel are sent.
export function privateProductionRecord(r) {
 const number=v=>v!=null&&v!==''&&Number.isFinite(Number(v))?Number(v):null;
 const available=availableCosts(r);
 const oct=number(r.commercial?.octRevenue), actual=number(available.values.actualTotal);
 const actualPartial=actual!=null&&available.partial.actualTotal;
 const worked=number(r.goodQuantity);
 // Same production-attributed OC as the standard report: never scale it twice.
 const workedOct=oct;
 const compared=available.values.actualWithObjective;
 const excess=compared!=null&&workedOct!=null&&compared>workedOct ? Math.round((compared-workedOct)*100)/100 : null;
 const row={id:r.id,customer:r.customerName||r.customer||r.customerCode||'',articleCode:r.articleCode,description:r.articleName||r.description||r.articleDescription||'',order:r.number||r.orderNumber||String(r.id),octReferences:[...new Set([...(r.links||[]).map(l=>l.oct),r.sourceOrder?.reference,r.commercialIdentity?.reference,r.orderNumber].map(octReference).filter(Boolean))].map(v=>v.replaceAll('+','/')),concludedAt:conclusionDate(r.works||r.phases||[]),isSali:isSaliDiIschia(r),date:r.works?.[0]?.start||r.date||r.start||r.createdAt||null,state:r.closed?'Conclusa':'In lavorazione',octValue:oct,octPartial:Boolean(r.commercial?.octPartial),actualTotal:compared,comparisonTotal:compared,invoiceValue:r.commercial?.invoiceRevenue??null,invoiceReferences:invoiceReferences(r.commercial?.invoices),actualPartial,octReasons:workedOct==null?['OC non disponibile o non confrontabile.']:[],workedOct,excess:excess>0?excess:null};
 if(row.excess!=null)row.detail={workedQuantity:worked,unit:r.unit,phases:(r.phases||[]).map(p=>({id:p.id,phase:p.phase,machine:p.machine?.name||p.machineName||'',start:p.start,end:p.end,hours:number(p.actualHours),quantity:number(p.goodQuantity)}))};
 return row;
}
export function privateProductionSummary(rows) {
 const octRows=rows.filter(r=>r.octValue!=null);
 const comparable=rows.filter(r=>r.comparisonTotal!=null&&r.workedOct!=null);
 const excluded=rows.filter(r=>!comparable.includes(r));
 const difference=comparable.length?comparable.reduce((s,r)=>s+r.comparisonTotal-r.workedOct,0):null;
 return {octValue:octRows.length?octRows.reduce((s,r)=>s+r.octValue,0):null,octPartial:octRows.length!==rows.length,excess:difference>0?Math.round(difference*100)/100:null,comparisonComplete:excluded.length===0,actualPartial:comparable.some(r=>r.actualPartial),comparableCount:comparable.length,excluded,excludedCost:excluded.some(r=>r.actualTotal!=null)?excluded.reduce((s,r)=>s+(r.actualTotal??0),0):null};
}

export const privateDifference=(left,right)=>left!=null&&right!=null?Math.round((left-right)*100)/100:null;
export function privateComparisons(rows){
 return [{key:'invoiceOc',label:'Fatturato su OC',left:'invoiceValue',right:'workedOct'},
 {key:'invoiceActual',label:'Fatturato su Consuntivo',left:'invoiceValue',right:'comparisonTotal'},
 {key:'ocActual',label:'OC su Consuntivo',left:'workedOct',right:'comparisonTotal'}].map(c=>{
 const items=rows.filter(r=>r[c.left]!=null&&r[c.right]!=null);
 return {...c,items,difference:items.length?Math.round(items.reduce((sum,r)=>sum+r[c.left]-r[c.right],0)*100)/100:null,
 missingLeft:rows.filter(r=>r[c.left]==null).length,missingRight:rows.filter(r=>r[c.right]==null).length,excluded:rows.length-items.length};
 });
}
export function matchesPrivateDates(row,{month='',from='',to=''}){
 const day=String(row.date||'').slice(0,10);
 if((month||from||to)&&!/^\d{4}-\d{2}-\d{2}$/.test(day))return false;
 return (!month||day.slice(0,7)===month)&&(!from||day>=from)&&(!to||day<=to);
}
