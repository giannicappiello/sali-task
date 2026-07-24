import { CheckCircle2, Clock3, RefreshCw, Square } from "lucide-react";

export default function MexalSyncCard({
  icon: Icon,
  title,
  description,
  recordLabel,
  recordCount,
  enabled = false,
  running = false,
  stopping = false,
  lastRun,
  onSync,
  onStop,
  onOpen,
  run,
}) {
  const isAgentsCard = title === "Agenti";
  const effectiveEnabled = enabled || isAgentsCard;
  const hasRunningRun = run?.status === "running";
  const action = isAgentsCard
    ? () => { window.location.assign("/integrations/mexal/agenti"); }
    : (enabled ? onSync : onOpen);

  function activate() {
    if (!running) action?.();
  }

  return (
    <article
      className={`mexal-sync-card ${effectiveEnabled ? "is-enabled" : "is-planned"}`}
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
        <span>{effectiveEnabled ? "Disponibile" : "Pianificata"}</span>
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
      <div className="mexal-sync-actions">
        <button
          type="button"
          className="mexal-sync-primary"
          onClick={(event) => {
            event.stopPropagation();
            activate();
          }}
          disabled={running}
        >
          {running ? <RefreshCw size={17} className="spin" /> : null}
          {isAgentsCard ? "Gestisci agenti" : effectiveEnabled ? (running ? "Sincronizzazione..." : "Sincronizza") : "Apri roadmap"}
        </button>
        {hasRunningRun && (
          <button
            type="button"
            className="mexal-sync-stop"
            onClick={(event) => {
              event.stopPropagation();
              onStop?.();
            }}
            disabled={stopping}
          >
            <Square size={15} />
            {stopping ? "Arresto..." : "Arresta sincronizzazione"}
          </button>
        )}
      </div>
    </article>
  );
}
