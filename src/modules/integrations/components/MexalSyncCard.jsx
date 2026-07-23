import { CheckCircle2, Clock3, RefreshCw } from "lucide-react";

export default function MexalSyncCard({
  icon: Icon,
  title,
  description,
  recordLabel,
  recordCount,
  enabled = false,
  running = false,
  lastRun,
  onSync,
  onOpen,
  run,
}) {
  const action = enabled ? onSync : onOpen;

  function activate() {
    if (!running) action?.();
  }

  return (
    <article
      className={`mexal-sync-card ${enabled ? "is-enabled" : "is-planned"}`}
      role="button"
      tabIndex={0}
      onClick={activate}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          activate();
        }
      }}
      aria-disabled={running}
    >
      <div className="mexal-sync-card-top">
        <div className="mexal-sync-icon"><Icon size={23} /></div>
        <span>{enabled ? "Disponibile" : "Pianificata"}</span>
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      <div className="mexal-sync-metric">
        <strong>{recordCount ?? "—"}</strong>
        <span>{recordLabel}</span>
      </div>
      <div className="mexal-sync-last-run">
        {lastRun ? <CheckCircle2 size={16} /> : <Clock3 size={16} />}
        <span>{lastRun || "Nessuna sincronizzazione"}</span>
      </div>
      {run && (
        <small className="mexal-sync-run-summary">
          Stato: {run.status} · Elaborati: {run.processed || 0} · Inseriti: {run.inserted || 0} · Aggiornati: {run.updated || 0} · Errori: {run.failed || 0}
        </small>
      )}
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          activate();
        }}
        disabled={running}
      >
        {running ? <RefreshCw size={17} className="spin" /> : null}
        {enabled ? (running ? "Sincronizzazione..." : "Sincronizza") : "Apri roadmap"}
      </button>
    </article>
  );
}
