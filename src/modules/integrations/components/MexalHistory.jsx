import IntegrationStatusBadge from "./IntegrationStatusBadge";

function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(milliseconds) {
  if (milliseconds == null) return "—";
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export default function MexalHistory({ runs = [], selectedRunId, onSelect }) {
  return (
    <section className="mexal-history-panel">
      <div className="mexal-section-heading">
        <div><h3>Cronologia sincronizzazioni</h3><p>Seleziona una riga per visualizzare log ed errori.</p></div>
      </div>
      <div className="mexal-history-table-wrap">
        <table className="mexal-history-table">
          <thead><tr><th>Avvio</th><th>Tipo</th><th>Stato</th><th>Letti</th><th>Aggiornati</th><th>Durata</th></tr></thead>
          <tbody>
            {runs.length === 0 ? (
              <tr><td colSpan="6"><div className="mexal-empty-state">Nessuna sincronizzazione registrata.</div></td></tr>
            ) : runs.map((run) => (
              <tr
                key={run.id}
                className={selectedRunId === run.id ? "is-selected" : ""}
                onClick={() => onSelect(run)}
              >
                <td>{formatDate(run.started_at)}</td>
                <td>{run.sync_type === "commercial_conditions" ? "Condizioni commerciali" : run.sync_type}</td>
                <td><IntegrationStatusBadge status={run.status} /></td>
                <td>{run.records_read || 0}</td>
                <td>{run.records_updated || 0}</td>
                <td>{formatDuration(run.duration_ms)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
