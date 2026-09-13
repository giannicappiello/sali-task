import { useEffect, useId, useRef, useState } from "react";
import { Info, X } from "lucide-react";
import { createPortal } from "react-dom";
import { money,quantity,unitMoney } from "./client";
import { fillingUnitLabor } from "./filling-history";

export default function CostInfo({title,children}) {
 const [open,setOpen]=useState(false),ref=useRef(null),id=useId();
 useEffect(()=>{if(open){const dialog=ref.current;dialog.showModal();return()=>dialog.close();}},[open]);
 return <><button type="button" className="pc-info-button" aria-label={"Informazioni: "+title} aria-haspopup="dialog" aria-expanded={open} onClick={()=>setOpen(true)}><Info size={17} aria-hidden="true"/></button>
 {open&&createPortal(<dialog ref={ref} className="pc-info-dialog" aria-labelledby={id} onCancel={e=>{e.preventDefault();e.stopPropagation();setOpen(false);}}><header><h2 id={id}>{title}</h2><button type="button" aria-label="Chiudi informazioni" onClick={()=>setOpen(false)} autoFocus><X size={20}/></button></header><div className="pc-info-text">{children}</div></dialog>,document.body)}</>;
}
const timestamp=v=>v?String(v).replace("T"," "):"Non disponibile";
export function HistoryNotes({record:r}) {
 return <>{[["STATION",r.stationHistory,r.stationHistoricalHourly,r.stationContext?.policy?.id],["FILLING",r.fillingHistory,r.fillingHistoricalHourly,r.fillingContext?.policy?.id]].map(([kind,h,hourly,policy])=>{
 if(!h)return null;
 const count=kind==="STATION"?h.mixingOperatorsCount:h.packagingOperatorsCount;
 const shift=count>0&&hourly!=null&&hourly!==""?count*Number(hourly)*8:null;
 return <section key={kind}><h3>Media storica {kind}</h3><p>Periodo: {timestamp(h.periodStart)} → {timestamp(h.periodEnd)}. Turni completati: {quantity(h.calendarShifts)}; lavorazioni concluse: {quantity(h.completedWorks)}. Turno corrente escluso; inclusi i turni senza attività.</p>
 <p>Organico: {quantity(count)} × {money(hourly)} × 8 ore. Costo turno reparto: {money(shift)}. Produttività media: {quantity(h.productivity)} {kind==="STATION"?"chiusure/turno":"pezzi/turno"}.</p>
 {kind==="STATION"?<p>Costo medio base: {money(!h.error&&h.productivity>0&&shift!==null?shift/h.productivity:null)}.</p>:<p>Pezzi FILLING chiusi: {quantity(h.completedPieces)}; astucciati separati: {quantity(h.cartoningPieces)}; astucciature concluse: {quantity(h.cartoningCompletedWorks)}. Costo manodopera al pezzo: {unitMoney(fillingUnitLabor(h,hourly))}.</p>}
 {h.error&&<p>{h.error}</p>}{h.cartoningWarning&&<p>{h.cartoningWarning}</p>}<p>{h.calendar?.historyWarning}</p><p>Fonte: {h.calendar?.source}. Acquisizione UTC: {timestamp(h.generatedAt)}. Revisione: {h.snapshotId||"Non disponibile"}. Criterio: {policy||"Non disponibile"}.</p></section>;
 })}</>;
}
export function RecordNotes({record:r}) {
 return <><p>{r.provisional?"Consuntivo provvisorio o incompleto.":"Lavorazione conclusa con costi disponibili."} Le somme esposte includono i valori disponibili: un importo parziale non equivale a un costo definitivo. Le voci mancanti non vengono valorizzate a zero.</p>
 {r.reconstructed&&<p>Valorizzazione storica ricostruita: le quantità e i costi ultimi usati non sostituiscono prezzi storici non conservati. Gli snapshot originali restano prioritari.</p>}
 {(r.warnings||[]).map(w=><p key={w}>{w}</p>)}{(r.laborCriteria||[]).map(c=><p key={c}>{c}</p>)}<HistoryNotes record={r}/></>;
}
