export default function MexalProgress({ running, progress, phase }) {
  const safeProgress = Math.max(0, Math.min(100, Number(progress || 0)));

  return (
    <section className="mexal-progress-panel">
      <div className="mexal-progress-heading">
        <div>
          <h3>Stato sincronizzazione</h3>
          <p>{running ? phase || "Elaborazione in corso" : "Nessuna sincronizzazione in esecuzione"}</p>
        </div>
        <strong>{running ? `${safeProgress}%` : "Pronto"}</strong>
      </div>
      <div className="mexal-progress-track" aria-label="Avanzamento sincronizzazione">
        <span style={{ width: `${running ? Math.max(safeProgress, 6) : 0}%` }} />
      </div>
    </section>
  );
}
