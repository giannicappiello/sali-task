import { useCallback, useEffect, useState } from "react";
import { Factory, RefreshCw, Save, Square } from "lucide-react";
import { useAuth } from "../../../contexts/AuthContext";

export default function ProgremesSettings() {
  const { session, hasPermission } = useAuth();
  const [data, setData] = useState({ modules: [], screens: [], runs: [], config: null });
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState(null);
  const canSync = hasPermission("integrations.configure") || hasPermission("integrations.sync.progremes_modules");

  const call = useCallback(async (action, extra = {}) => {
    const response = await fetch("/api/mexal/automation", { method: "POST", headers: { Authorization: `Bearer ${session?.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ action, ...extra }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Operazione ProgreMES non riuscita.");
    return payload;
  }, [session?.access_token]);

  const load = useCallback(async () => setData(await call("progremes_modules_list")), [call]);
  useEffect(() => {
    let active = true;
    call("progremes_modules_list").then((result) => {
      if (active) setData(result);
    }).catch((error) => {
      if (active) setMessage({ type: "error", text: error.message });
    });
    return () => { active = false; };
  }, [call]);

  async function sync() { setBusy("sync"); setMessage(null); try { await call("progremes_modules_sync"); await load(); setMessage({ type: "success", text: "Catalogo moduli ProgreMES aggiornato." }); } catch (error) { setMessage({ type: "error", text: error.message }); } finally { setBusy(""); } }
  async function stop() { setBusy("stop"); try { await call("progremes_modules_stop"); await load(); setMessage({ type: "warning", text: "Richiesta di arresto inviata." }); } catch (error) { setMessage({ type: "error", text: error.message }); } finally { setBusy(""); } }
  async function saveConfig() { setBusy("config"); try { await call("progremes_sync_config_save", data.config); await load(); setMessage({ type: "success", text: "Programmazione salvata." }); } catch (error) { setMessage({ type: "error", text: error.message }); } finally { setBusy(""); } }
  const running = data.runs.some((run) => ["in_coda", "in_esecuzione"].includes(run.stato));

  return <div className="mexal-page progremes-settings-page">
    <section className="progremes-summary-strip">
      <div className="progremes-summary-title"><span><Factory size={24} /></span><div><h2>Catalogo ProgreMES</h2><p>Stato della sincronizzazione con il Workspace.</p></div></div>
      <div className="progremes-summary-metrics"><div><strong>{data.modules.length}</strong><span>Moduli</span></div><div><strong>{(data.screens || []).length}</strong><span>Schermate</span></div><div><strong className={running ? "is-running" : "is-ready"}>{running ? "In corso" : "Pronto"}</strong><span>Stato</span></div></div>
    </section>
    {message && <div className={`mexal-alert alert-${message.type}`}>{message.text}</div>}
    <section className="mexal-settings-panel progremes-control-panel"><div className="mexal-section-heading"><div><h3>Sincronizzazione moduli</h3><p>I moduli rimossi da ProgreMES vengono disattivati senza cancellare le assegnazioni ai reparti.</p></div></div>
      <div className="progremes-control-grid">
        <div className="progremes-control-card"><div><h4>Aggiornamento manuale</h4><p>Avvia subito il confronto tra il catalogo ProgreMES e quello del Workspace.</p></div><div className="mexal-settings-actions"><button className="primary-action" disabled={!canSync || busy || running} onClick={sync}><RefreshCw size={18} className={busy === "sync" ? "spin" : ""} />Sincronizza ora</button><button className="mexal-danger-action" disabled={!canSync || busy || !running} onClick={stop}><Square size={16} />Arresta</button></div></div>
        {data.config && <div className="progremes-control-card"><div><h4>Programmazione automatica</h4><p>Configura l’aggiornamento periodico del catalogo.</p></div><div className="progremes-schedule-grid"><label className="mexal-toggle-row"><input type="checkbox" checked={data.config.sincronizzazione_automatica} onChange={(e) => setData((current) => ({ ...current, config: { ...current.config, sincronizzazione_automatica: e.target.checked } }))} /><span><strong>Sincronizzazione automatica</strong><small>Attiva i controlli periodici.</small></span></label><label className="mexal-select-row"><span><strong>Intervallo</strong><small>Ore tra due controlli.</small></span><input type="number" min="1" max="168" value={data.config.intervallo_ore} onChange={(e) => setData((current) => ({ ...current, config: { ...current.config, intervallo_ore: Number(e.target.value) } }))} /></label><button className="primary-action" disabled={!canSync || busy} onClick={saveConfig}><Save size={18} />Salva programmazione</button></div></div>}
      </div>
    </section>
    <section className="mexal-table-panel"><div className="mexal-section-heading"><div><h3>Catalogo tecnico rilevato</h3><p>La composizione dei moduli e delle schermate si gestisce in Impostazioni → Moduli.</p></div></div><table className="mexal-history-table"><thead><tr><th>Codice</th><th>Nome</th><th>Percorso</th><th>Stato</th><th>Ultimo aggiornamento</th></tr></thead><tbody>{data.modules.map((item) => <tr key={item.codice}><td><code>{item.codice}</code></td><td><strong>{item.nome}</strong></td><td>{item.percorso}</td><td><span className={`progremes-status ${item.attivo ? "active" : "inactive"}`}>{item.attivo ? "Attivo" : "Non disponibile"}</span></td><td>{item.ultima_sincronizzazione ? new Date(item.ultima_sincronizzazione).toLocaleString("it-IT") : "—"}</td></tr>)}{!data.modules.length && <tr><td colSpan="5"><div className="mexal-empty-state">Nessun modulo ancora sincronizzato.</div></td></tr>}</tbody></table></section>
    <section className="mexal-table-panel"><div className="mexal-section-heading"><div><h3>Storico sincronizzazioni</h3><p>Ultime operazioni eseguite sul catalogo ProgreMES.</p></div></div><table className="mexal-history-table"><thead><tr><th>Data</th><th>Origine</th><th>Stato</th><th>Letti</th><th>Inseriti</th><th>Aggiornati</th><th>Disattivati</th><th>Errore</th></tr></thead><tbody>{data.runs.map((run) => <tr key={run.id}><td>{new Date(run.iniziata_il).toLocaleString("it-IT")}</td><td>{run.origine}</td><td><span className={`progremes-status ${["completata", "completato", "success"].includes(run.stato) ? "active" : ["in_coda", "in_esecuzione"].includes(run.stato) ? "running" : "inactive"}`}>{run.stato}</span></td><td>{run.moduli_letti}</td><td>{run.inseriti}</td><td>{run.aggiornati}</td><td>{run.disattivati}</td><td>{run.errore || "—"}</td></tr>)}{!data.runs.length && <tr><td colSpan="8"><div className="mexal-empty-state">Nessuna sincronizzazione registrata.</div></td></tr>}</tbody></table></section>
  </div>;
}
