import { withAdditionalStationShifts, stationHistorySummary } from "./station-history.js";

export const isPieces = unit => ["PZ","PCS","PEZZI"].includes(String(unit||"").trim().toUpperCase());
const amount = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) && Number(value)>=0 ? Number(value) : null;

// Only FILLING starts define this department's period. Reuse the STATION
// calendar extension, not its completed-work productivity formula.
export function withAdditionalFillingShifts(source,settings) {
 if(!settings?.shifts?.slice(1).length&&!settings?.companyCalendar)return source;
 const active=[...new Map((source.works||[]).filter(w=>!["Annullato","DaAvviare"].includes(w.state)&&w.start<=source.asOfLocal).map(w=>[w.id,w])).values()];
 const filling=active.filter(w=>w.phase==="Confezionamento");
 const period=withAdditionalStationShifts({...source,works:filling,mixingOperatorsCount:source.packagingOperatorsCount},settings);
 const closed=filling.filter(w=>w.state==="Terminato"&&w.end&&w.end>=w.start&&period.periodEnd&&w.end<=period.periodEnd);
 const cartoning=active.filter(w=>w.phase==="Astucciatura"&&w.state==="Terminato"&&w.end>=w.start&&w.end>=period.periodStart&&w.end<=period.periodEnd);
 const invalid=closed.some(w=>!isPieces(w.unit)||amount(w.goodQuantity)===null);
 const pieces=invalid?null:closed.reduce((sum,w)=>sum+Number(w.goodQuantity),0);
 const cartoningInvalid=active.some(w=>w.phase==="Astucciatura"&&w.state==="Terminato"&&(!w.end||w.end<w.start))||cartoning.some(w=>!isPieces(w.unit)||amount(w.goodQuantity)===null);
 const error=period.error?.replaceAll("STATION","FILLING").replaceAll("Miscelazione","Confezionamento")|| (invalid?"Quantità FILLING o unità pezzi non valide.":!pieces?"Media storica FILLING pari a zero.":null);
 return {...source,periodStart:period.periodStart,periodEnd:period.periodEnd,calendar:period.calendar,calendarShifts:period.calendarShifts,
  completedWorks:closed.length,completedPieces:pieces,cartoningCompletedWorks:cartoning.length,
  cartoningPieces:cartoningInvalid||!period.periodStart||!period.periodEnd?null:cartoning.reduce((s,w)=>s+Number(w.goodQuantity),0),
  cartoningWarning:cartoningInvalid?"Dati astucciatura incompleti: pezzi non verificabili.":null,
  productivity:error?null:pieces/period.calendarShifts,error};
}
export function fillingUnitLabor(history,hourly) {
 const rate=amount(hourly);
 if(!history||history.error||!(history.productivity>0)||!(history.packagingOperatorsCount>0)||rate===null)return null;
 return history.packagingOperatorsCount*8*rate/history.productivity;
}
export function activeFillingPolicy(configs,today) {
 const latest=[...configs].filter(c=>String(c.effective_from).slice(0,10)<=today)
  .sort((a,b)=>String(b.effective_from).localeCompare(String(a.effective_from))||String(b.created_at).localeCompare(String(a.created_at)))[0];
 return latest?.settings?.laborRules?.filling?.basis==="historical_pieces"?latest:null;
}
export const fillingHistorySummary=stationHistorySummary;
