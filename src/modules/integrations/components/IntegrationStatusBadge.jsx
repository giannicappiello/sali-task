const LABELS = {
  connected: "Connesso",
  active: "Attivo",
  configuration: "Configurazione",
  unavailable: "Non configurato",
  running: "In esecuzione",
  completed: "Completata",
  completed_with_warnings: "Completata con avvisi",
  failed: "Errore",
  cancelled: "Annullata",
  timeout: "Tempo scaduto",
};

export default function IntegrationStatusBadge({ status = "unavailable" }) {
  return (
    <span className={`integration-status-badge status-${status}`}>
      <span className="integration-status-dot" />
      {LABELS[status] || status}
    </span>
  );
}
