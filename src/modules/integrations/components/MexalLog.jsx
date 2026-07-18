import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";

function iconFor(status) {
  if (status === "success") return CheckCircle2;
  if (status === "warning") return AlertTriangle;
  if (status === "error") return XCircle;
  return Info;
}

function formatTime(value) {
  if (!value) return "--:--";
  return new Date(value).toLocaleTimeString("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function MexalLog({ items = [] }) {
  return (
    <section className="mexal-log-panel">
      <div className="mexal-section-heading">
        <div><h3>Log operazione</h3><p>Dettaglio tecnico dell'ultima esecuzione selezionata.</p></div>
      </div>
      <div className="mexal-log-list">
        {items.length === 0 ? (
          <div className="mexal-empty-state">Nessun log disponibile.</div>
        ) : (
          items.map((item, index) => {
            const Icon = iconFor(item.status);
            return (
              <div className={`mexal-log-row log-${item.status || "info"}`} key={item.id || `${item.created_at}-${index}`}>
                <span className="mexal-log-time">{formatTime(item.created_at)}</span>
                <Icon size={17} />
                <div>
                  <strong>{item.title || item.entity_type || "Sistema"}</strong>
                  <p>{item.message || "Operazione registrata"}</p>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
