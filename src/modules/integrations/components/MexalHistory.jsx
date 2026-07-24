import { useMemo, useState } from "react";
import IntegrationStatusBadge from "./IntegrationStatusBadge";

function formatDate(value) {
  return value
    ? new Date(value).toLocaleString("it-IT", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
    : "—";
}

function formatDuration(ms) {
  if (ms == null) return "—";
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

const labels = {
  products: "Prodotti",
  clients: "Clienti",
  stocks: "Giacenze",
  orders: "Ordini",
  commercial_conditions: "Condizioni commerciali",
  document_series: "Serie documenti",
  agents: "Agenti",
  list_price_commissions: "Provvigioni listini",
  payments: "Pagamenti",
};

function sourceType(run) {
  if (run.source === "cron") return "cron";
  if (!run.source || ["manual", "integrations"].includes(run.source)) return "manual";
  return "automatic";
}

function sourceLabel(run) {
  const source = sourceType(run);
  if (source === "cron") return "Pianificata";
  if (source === "manual") return "Manuale";
  return "Automatica";
}

export default function MexalHistory({ runs = [], selectedRunId, onSelect }) {
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const filtered = useMemo(() => runs.filter((run) => (
    (!type || run.sync_type === type)
    && (!status || run.status === status)
    && (!source || sourceType(run) === source)
    && (!from || new Date(run.started_at) >= new Date(from))
    && (!to || new Date(run.started_at) <= new Date(`${to}T23:59:59`))
  )), [runs, type, status, source, from, to]);

  return (
    <section className="mexal-history-panel">
      <div className="mexal-section-heading">
        <div>
          <h3>Cronologia sincronizzazioni</h3>
          <p>Storico completo delle esecuzioni manuali, automatiche e pianificate.</p>
        </div>
      </div>
      <div className="mexal-history-filters">
        <label>
          <span>Tipo</span>
          <select value={type} onChange={(event) => setType(event.target.value)}>
            <option value="">Tutti i tipi</option>
            {Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>
          <span>Origine</span>
          <select value={source} onChange={(event) => setSource(event.target.value)}>
            <option value="">Tutte le origini</option>
            <option value="cron">Pianificata</option>
            <option value="manual">Manuale</option>
            <option value="automatic">Automatica</option>
          </select>
        </label>
        <label>
          <span>Stato</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Tutti gli stati</option>
            <option value="completed">Completata</option>
            <option value="completed_with_errors">Con errori</option>
            <option value="failed">Fallita</option>
            <option value="cancelled">Annullata</option>
            <option value="timeout">Tempo scaduto</option>
            <option value="skipped">Saltata</option>
            <option value="running">In corso</option>
          </select>
        </label>
        <label>
          <span>Da</span>
          <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label>
          <span>A</span>
          <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
      </div>
      <div className="mexal-history-table-wrap">
        <table className="mexal-history-table mexal-history-table-wide">
          <thead>
            <tr>
              <th>Avvio</th>
              <th>Origine</th>
              <th>Tipo</th>
              <th>Stato</th>
              <th>Elaborati</th>
              <th>Inseriti</th>
              <th>Aggiornati</th>
              <th>Errori</th>
              <th>Durata</th>
              <th>Esito</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0
              ? <tr><td colSpan="10"><div className="mexal-empty-state">Nessuna sincronizzazione registrata.</div></td></tr>
              : filtered.map((run) => (
                <tr
                  key={run.id}
                  className={selectedRunId === run.id ? "is-selected" : ""}
                  onClick={() => onSelect(run)}
                >
                  <td>{formatDate(run.started_at)}</td>
                  <td><span className={`mexal-run-source is-${sourceType(run)}`}>{sourceLabel(run)}</span></td>
                  <td>{labels[run.sync_type] || run.sync_type}</td>
                  <td><IntegrationStatusBadge status={run.status} /></td>
                  <td>{run.processed ?? run.records_read ?? 0}</td>
                  <td>{run.inserted ?? run.records_inserted ?? 0}</td>
                  <td>{run.updated ?? run.records_updated ?? 0}</td>
                  <td>{run.failed ?? run.records_failed ?? 0}</td>
                  <td>{formatDuration(run.duration_ms)}</td>
                  <td>{run.error_message || "—"}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
