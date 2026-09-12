import { formatDate, formatMoney } from "./crmConfig";
import InfoTooltip from "../../components/InfoTooltip";
import CrmCustomerLink from "./CrmCustomerLink";
import "./beauty.css";

export default function CrmBeautyEventTable({ events, postDays, from, to }) {
  return <div className="crm-table-wrap crm-beauty-table-wrap">
    <table className="crm-table crm-beauty-table">
      <colgroup><col className="beauty-client-col"/><col className="beauty-date-col"/><col className="beauty-state-col"/><col className="beauty-units-col"/><col/><col/><col/></colgroup>
      <thead><tr>
        <th>Farmacia</th><th>Data eventi</th><th>Stato</th><th>Pezzi</th><th>Fatturato giornata</th>
        <th>Ordinato post-evento<InfoTooltip label="Ordinato post-evento" text={`Totale documento degli ordini della farmacia dal giorno successivo alla giornata eseguita fino a ${postDays} giorni dopo, anche oltre il periodo filtrato. Gli ordini comuni a più eventi sono conteggiati una sola volta nel riepilogo farmacia e nella card.`}/></th>
        <th>Ordinato nel periodo<InfoTooltip label="Ordinato nel periodo" text={`Totale documento degli ordini della farmacia dal ${formatDate(from)} al ${formatDate(to)}, estremi inclusi, indipendentemente dalla data degli eventi. Il totale della stessa farmacia si ripete sulle sue singole giornate.`}/></th>
      </tr></thead>
      <tbody>{events.map(event => <tr key={event.id}>
        <td data-label="Farmacia"><CrmCustomerLink crmType="b2b" customerCode={event.customer_code} name={event.customer_name}>{event.customer_name || "Farmacia non disponibile"}</CrmCustomerLink></td>
        <td data-label="Data eventi">{event.first_event_date && event.first_event_date !== event.data ? <>{formatDate(event.first_event_date)}<br/>– {formatDate(event.data)}</> : formatDate(event.data)}</td>
        <td data-label="Stato">{event.stato || "—"}</td>
        <td data-label="Pezzi">{Number(event.numero_totale_pezzi_venduti || 0).toLocaleString("it-IT")}</td>
        <td data-label="Fatturato giornata">{formatMoney(event.fatturato_giornata)}</td>
        <td data-label="Ordinato post-evento">{formatMoney(event.impact?.order_value)}</td>
        <td data-label="Ordinato nel periodo">{event.period_order_value == null ? "—" : formatMoney(event.period_order_value)}</td>
      </tr>)}</tbody>
    </table>
    {!events.length && <div className="crm-empty">Nessun dato corrisponde alla card e al periodo selezionati.</div>}
  </div>;
}
