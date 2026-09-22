import { useState } from "react";

const labels = { PLANNED: "Pianificato", CANCELLED: "Annullato", RELEASED: "Rilasciato", RELEASED_WITH_SHORTAGE: "Rilasciato con carenze", PREPARING: "In preparazione",
  NOT_STARTED: "Da avviare", RUNNING: "In lavorazione", COMPLETED: "Terminato", SUSPENDED: "Sospeso",
  CLOSING: "Chiusura in corso", RECONCILIATION_REQUIRED: "Da riconciliare", COVERED: "Coperto",
  SHORTAGE: "Materiali mancanti", UNVERIFIED: "Da verificare", STOCK_PENDING: "Aggiornamento giacenze in attesa" };
const status = value => labels[value] || value || "—";
const date = value => value ? new Intl.DateTimeFormat("it-IT", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "—";
const qty = value => new Intl.NumberFormat("it-IT", { maximumFractionDigits: 3 }).format(value || 0);

export default function CommercialBatchProgress({ orders, load }) {
  const [expanded, setExpanded] = useState(null);
  const [results, setResults] = useState({});
  const [loading, setLoading] = useState(null);
  const [error, setError] = useState("");
  async function open(id, refresh = false) {
    if (!refresh && expanded === id) { setExpanded(null); return; }
    setExpanded(id); setError("");
    if (!refresh && results[id]) return;
    setLoading(id);
    try { const result = await load(id); setResults(current => ({ ...current, [id]: result.batches })); }
    catch (e) { setError(e.message); }
    finally { setLoading(null); }
  }
  return <section aria-label="Avanzamento delle singole lavorazioni" className="commercial-batch-progress">
    {(orders || []).map(order => <div key={order.id}>
      <button type="button" className="secondary-action" aria-expanded={expanded === order.id} onClick={() => open(order.id)}>
        {order.numeroOrdine} · {order.codiceArticolo} · Lavorazioni {expanded === order.id ? "▴" : "▾"}
      </button>
      {expanded === order.id && <div>
        {loading === order.id ? <p role="status">Caricamento lavorazioni…</p> : <>
          {error && <p role="alert">{error}</p>}
          <button type="button" className="secondary-action" onClick={() => open(order.id, true)}>Aggiorna lavorazioni</button>
          {results[order.id]?.batches?.map(batch => <div key={batch.id || batch.number}>
            <h4>Batch {batch.number} · {qty(batch.quantity)} {batch.unit}</h4>
            <div style={{ overflowX: "auto" }}><table className="rdp-table" style={{ width: "100%", textAlign: "left" }}>
              <thead><tr><th>Fase / ODL</th><th>Impianto</th><th>Pianificato</th><th>Avanzamento</th><th>Lotto</th><th>Quantità</th><th>Materiali / documenti</th></tr></thead>
              <tbody>{batch.phases.map(phase => <tr key={phase.id || `${phase.phase}:${phase.odlId}`}>
                <td>{phase.phase === 0 ? "Produzione" : phase.phase === 3 ? "Confezionamento" : "Astucciatura"}<br/>ODL {phase.odlId || "da rilasciare"}<br/>{status(phase.releaseStatus)}</td>
                <td>{phase.resource}</td><td>{date(phase.plannedStart)}<br/>{date(phase.plannedEnd)}</td>
                <td>{status(phase.executionStatus)}<br/>{phase.actualStart && date(phase.actualStart)}<br/>{phase.actualEnd && date(phase.actualEnd)}</td>
                <td>{phase.lot || "Da assegnare"}</td><td>{qty(phase.plannedQuantity)} {phase.unit}<br/>Prodotta: {phase.producedQuantity == null ? "—" : qty(phase.producedQuantity)}</td>
                <td>{status(phase.coverageStatus)}<br/>{[phase.dischargeDocuments, phase.loadDocument, phase.wasteDocument].filter(Boolean).join(" · ")}{phase.syncStatus === "STOCK_PENDING" && <p>{status(phase.syncStatus)}</p>}</td>
              </tr>)}</tbody>
            </table></div>
          </div>)}
          {results[order.id] && !results[order.id].batches?.length && <p>Ordine acquisito; batch non ancora pianificati.</p>}
        </>}
      </div>}
    </div>)}
  </section>;
}
