import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";

async function invoke(body) {
  const { data: { session } } = await supabase.auth.getSession();
  const response = await fetch("/api/mexal/automation", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.success === false) throw new Error(result.error || "Operazione non riuscita.");
  return result;
}

export default function MexalOrderMaintenance({ canManage }) {
  const [settings, setSettings] = useState({ giorni_conservazione_evasi: 365, pulizia_automatica: false });
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(null);
  const load = useCallback(async () => { setLoading(true); try { const result = await invoke({ action: "order_maintenance_get" }); setSettings(result.settings); } catch (error) { setMessage({ type: "error", text: error.message }); } finally { setLoading(false); } }, []);
  useEffect(() => {
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  async function save() { setBusy(true); setMessage(null); try { const result = await invoke({ action: "order_maintenance_save", settings }); setSettings(result.settings); setMessage({ type: "success", text: "Impostazioni di manutenzione salvate." }); } catch (error) { setMessage({ type: "error", text: error.message }); } finally { setBusy(false); } }
  async function purge() {
    if (!window.confirm(`Eliminare definitivamente SOLO da Workspace i documenti EVASI da più di ${settings.giorni_conservazione_evasi} giorni e le relative righe? Mexal non verrà modificato.`)) return;
    setBusy(true); setMessage(null);
    try { const result = await invoke({ action: "order_maintenance_purge" }); const summary = result.summary; setMessage({ type: "success", text: `Pulizia completata: ${summary.eliminati} documenti eliminati (${summary.ordinipr} ORDINIPR, ${summary.ordiniph} ORDINIPH).` }); await load(); }
    catch (error) { setMessage({ type: "error", text: error.message }); } finally { setBusy(false); }
  }
  if (!canManage) return <section className="mexal-settings-panel"><div className="mexal-empty-state">La manutenzione è riservata agli amministratori.</div></section>;
  if (loading) return <section className="mexal-settings-panel"><div className="mexal-empty-state">Caricamento manutenzione…</div></section>;
  return <section className="mexal-settings-panel">
    <div className="mexal-section-heading"><div><h3>Manutenzione documenti ordine</h3><p>Gestisce OCM, OCI e OCX EVASI di ORDINIPR e ORDINIPH. La cancellazione avviene esclusivamente in Workspace.</p></div></div>
    {message && <div className={`mexal-alert alert-${message.type}`}><span>{message.text}</span></div>}
    <div className="mexal-rule-form-grid">
      <label className="mexal-rule-field">Cancella documenti evasi dopo (giorni)<input type="number" min="1" max="3650" value={settings.giorni_conservazione_evasi} onChange={(event) => setSettings({ ...settings, giorni_conservazione_evasi: Number(event.target.value) })} /></label>
      <label className="mexal-rule-checkbox"><input type="checkbox" checked={settings.pulizia_automatica} onChange={(event) => setSettings({ ...settings, pulizia_automatica: event.target.checked })} /> Esegui la pulizia dopo la sincronizzazione automatica degli ordini</label>
    </div>
    <p><small>Ultima pulizia: {settings.ultima_pulizia_il ? new Date(settings.ultima_pulizia_il).toLocaleString("it-IT") : "mai"}</small></p>
    <div className="mexal-rule-actions"><button type="button" className="orders-danger" disabled={busy} onClick={purge}>Pulisci ora</button><button type="button" className="orders-primary" disabled={busy} onClick={save}>{busy ? "Operazione…" : "Salva impostazioni"}</button></div>
  </section>;
}
