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
}) {
  return (
    <article className={`mexal-sync-card ${enabled ? "is-enabled" : "is-planned"}`}>
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
      <button
        type="button"
        onClick={enabled ? onSync : onOpen}
        disabled={enabled ? running : false}
      >
        {running ? <RefreshCw size={17} className="spin" /> : null}
        {enabled ? (running ? "Sincronizzazione..." : "Sincronizza") : "Apri roadmap"}
      </button>
    </article>
  );
}
