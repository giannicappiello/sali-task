export default function MexalSettings({ settings, onChange, disabled }) {
  const update = (field, value) => onChange({ ...settings, [field]: value });

  return (
    <section className="mexal-settings-panel">
      <div className="mexal-section-heading">
        <div><h3>Parametri sincronizzazione</h3><p>Per salvare realmente i dati lascia Dry Run disattivato.</p></div>
      </div>
      <div className="mexal-settings-grid">
        <label className="mexal-toggle-row">
          <input type="checkbox" checked={settings.dryRun} onChange={(event) => update("dryRun", event.target.checked)} disabled={disabled} />
          <span><strong>Dry Run</strong><small>Se attivo legge e valida, ma non modifica il database.</small></span>
        </label>
        <label className="mexal-toggle-row">
          <input type="checkbox" checked={settings.syncPayments} onChange={(event) => update("syncPayments", event.target.checked)} disabled={disabled} />
          <span><strong>Regole pagamento</strong><small>Importa gli sconti pagamento quando l'endpoint Mexal è configurato; in caso contrario mantiene le regole manuali.</small></span>
        </label>
        <label className="mexal-select-row">
          <span><strong>Modalità</strong><small>Completa disattiva le regole non più presenti in Mexal.</small></span>
          <select value={settings.mode} onChange={(event) => update("mode", event.target.value)} disabled={disabled}>
            <option value="full">Completa</option>
            <option value="incremental">Incrementale</option>
          </select>
        </label>
      </div>
    </section>
  );
}
