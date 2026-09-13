import { money,quantity,unitMoney } from "./client";
import { fillingUnitLabor } from "./filling-history";
const timestamp=value=>value?String(value).slice(0,19).replace("T"," "):"Non disponibile";
export default function FillingHistorySummary({history,hourly,policyId}) {
 if(!history)return <p className="pc-note">Media storica FILLING non ancora acquisita: costo non calcolabile.</p>;
 const shiftCost=history.packagingOperatorsCount>0&&hourly!==""&&hourly!=null?history.packagingOperatorsCount*8*Number(hourly):null;
 return <section className="pc-panel"><h3>Media storica FILLING · intero reparto Confezionamento</h3>
 {history.error&&<p className="pc-error">{history.error}</p>}
 <p>Periodo: {timestamp(history.periodStart)} → {timestamp(history.periodEnd)}. Turni di calendario completati, compresi quelli senza attività; turno corrente escluso.</p>
 <div className="pc-metrics">
 <div>Pezzi buoni FILLING chiusi<strong>{quantity(history.completedPieces)}</strong></div>
 <div>Pezzi astucciati (separati)<strong>{quantity(history.cartoningPieces)}</strong></div>
 <div>Turni di reparto<strong>{quantity(history.calendarShifts)}</strong></div>
 <div>Pezzi FILLING / turno<strong>{quantity(history.productivity)}</strong></div>
 <div>Costo turno reparto<strong>{money(shiftCost)}</strong></div>
 <div>Costo manodopera / pezzo<strong>{unitMoney(fillingUnitLabor(history,hourly))}</strong></div>
 </div>
 <p>Organico Confezionamento attivo MES: {quantity(history.packagingOperatorsCount)} × {money(hourly)} × 8 ore. Lavorazioni FILLING concluse: {quantity(history.completedWorks)}; astucciature concluse: {quantity(history.cartoningCompletedWorks)}.</p>
 <p>Preventivo: costo unitario × pezzi previsti. Consuntivo: costo unitario × pezzi buoni chiusi. Astucciatura esclusa dalla produttività FILLING, senza addebito autonomo; niente doppio conteggio delle presenze.</p>
 {history.cartoningWarning&&<p className="pc-note">{history.cartoningWarning}</p>}
 <p className="pc-note">{history.calendar?.historyWarning}</p>
 <p className="pc-muted">Fonte: {history.calendar?.source}. Acquisizione: {timestamp(history.generatedAt)} UTC. Revisione: {history.snapshotId||"Non disponibile"}.{policyId&&" Versione criterio retroattivo: "+policyId} Media aggiornata alla consultazione, senza ricaricamenti continui.</p>
 </section>;
}
