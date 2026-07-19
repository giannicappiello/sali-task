import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";

async function authorizedFetch(path, options = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}`, ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok && response.status !== 207) throw new Error(data.error || "Operazione automazione non riuscita.");
  return data;
}

export default function MexalAutomations({ onMessage }) {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const load = async () => { try { setRules((await authorizedFetch("/api/mexal/automation-rules")).rules || []); } catch (error) { onMessage?.({ type: "error", text: error.message }); } finally { setLoading(false); } };
  useEffect(() => { load(); }, []);
  async function runAll() { setRunning(true); try { const result = await authorizedFetch("/api/mexal/automation-run-now", { method: "POST", body: JSON.stringify({ sync_type: "sync_all" }) }); onMessage?.({ type: result.ok ? "success" : "warning", text: `Avvio completato: ${result.counters.completed} completate, ${result.counters.failed} fallite.` }); await load(); } catch (error) { onMessage?.({ type: "error", text: error.message }); } finally { setRunning(false); } }
  async function toggle(rule) { try { const { rule: updated } = await authorizedFetch("/api/mexal/automation-rules", { method: "PATCH", body: JSON.stringify({ id: rule.id, enabled: !rule.enabled }) }); setRules((items) => items.map((item) => item.id === updated.id ? updated : item)); } catch (error) { onMessage?.({ type: "error", text: error.message }); } }
  return <section className="mexal-settings-panel"><div className="mexal-section-heading"><div><h3>Automazioni</h3><p>Il cron Vercel esegue ogni giorno le regole abilitate in sequenza. Gli ordini restano esclusi per evitare reinvii automatici.</p></div><button type="button" onClick={runAll} disabled={loading || running}>{running ? "Avvio in corso…" : "Esegui tutte ora"}</button></div>{loading ? <p>Caricamento regole…</p> : <div className="mexal-settings-grid">{rules.map((rule) => <label className="mexal-toggle-row" key={rule.id}><input type="checkbox" checked={rule.enabled} onChange={() => toggle(rule)} /><span><strong>{rule.sync_type}</strong><small>{rule.last_status ? `Ultimo esito: ${rule.last_status}` : "Mai eseguita"}{rule.last_error ? ` — ${rule.last_error}` : ""}</small></span></label>)}</div>}</section>;
}
