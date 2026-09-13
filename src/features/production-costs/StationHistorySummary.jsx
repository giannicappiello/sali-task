import { money, quantity } from "./client";
const timestamp=value=>value?String(value).slice(0,19).replace("T"," "):"Non disponibile";
export default function StationHistorySummary({history,hourly,policyId}) {
 if(!history)return <p className="pc-note">Media storica MES non ancora acquisita: costo non calcolabile.</p>;
 const shiftCost=history.mixingOperatorsCount>0&&hourly!==""&&hourly!=null?history.mixingOperatorsCount*8*Number(hourly):null;
 const meanCost=!history.error&&history.productivity>0&&shiftCost!==null?shiftCost/history.productivity:null;
 return <section className="pc-panel"><h3>Media storica STATION · intero reparto</h3>
 {history.error&&<p className="pc-error">{history.error}</p>}
 <p>Periodo: {timestamp(history.periodStart)} → {timestamp(history.periodEnd)}. Ultimo turno completato; turno corrente escluso. Sono inclusi i turni di calendario senza attività o chiusure di lavorazioni.</p>
 <div className="pc-metrics"><div>Lavorazioni concluse<strong>{quantity(history.completedWorks)}</strong></div><div>Turni di reparto<strong>{quantity(history.calendarShifts)}</strong></div><div>Chiusure medie / turno<strong>{quantity(history.productivity)}</strong></div><div>Costo turno reparto<strong>{money(shiftCost)}</strong></div><div>Costo medio base<strong>{money(meanCost)}</strong></div></div>
 <p>Organico attivo MES: {quantity(history.mixingOperatorsCount)} × {money(hourly)} × 8 ore. Costo singola lavorazione = costo medio base × turni impiegati.</p>
 <p className="pc-note">{history.calendar?.historyWarning}</p>
 <p className="pc-muted">Fonte: {history.calendar?.source}. Acquisizione: {timestamp(history.generatedAt)} UTC. Revisione verificabile: {history.snapshotId||"Non disponibile"}.{policyId&&" Versione criterio retroattivo: "+policyId} La media viene riletta da MES ad ogni consultazione/aggiornamento, senza ricaricare continuamente la pagina.</p>
 </section>;
}
