import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import {
  automationSection,
  canManageMexalAutomations,
  loadLatestListPriceCommissionRun,
  loadMexalAutomationRules,
  runListPriceCommissionsNow,
  saveMexalAutomationRule,
  stopListPriceCommissionRun,
} from "../services/mexalAutomationService";

const eventKeys = ["orders_module_open", "before_new_order", "customer_selected", "before_order_save", "after_order_save", "before_order_send", "after_order_send", "product_selected", "manual"];

function title(value) { return String(value || "—").replaceAll("_", " "); }
function blankEventRule() { return { event_key: "manual", sync_type: "products", enabled: false, execution_order: 1, blocking: false, scope: "global" }; }
function number(value) { return Number(value || 0).toLocaleString("it-IT"); }

function RuleEditor({ type, rule, onClose, onSave, saving }) {
  const [draft, setDraft] = useState(rule);
  const syncTypes = automationSection(type, true).syncTypes;
  const field = (name, label, input = "text") => <label className="mexal-rule-field">{label}<input type={input} value={draft[name] ?? ""} onChange={(event) => setDraft({ ...draft, [name]: input === "number" ? Number(event.target.value) : event.target.value })} /></label>;
  return <form className="mexal-rule-editor" onSubmit={(event) => { event.preventDefault(); onSave(draft); }}>
    <h4>{rule.id ? "Modifica regola" : "Nuova automazione evento"}</h4>
    <div className="mexal-rule-form-grid">
      {type === "event" && <label className="mexal-rule-field">Evento<select value={draft.event_key} onChange={(event) => setDraft({ ...draft, event_key: event.target.value })}>{eventKeys.map((value) => <option key={value} value={value}>{title(value)}</option>)}</select></label>}
      <label className="mexal-rule-field">Tipo di sincronizzazione<select value={draft.sync_type} onChange={(event) => setDraft({ ...draft, sync_type: event.target.value })}>{syncTypes.map((value) => <option key={value} value={value}>{title(value)}</option>)}</select></label>
      {type === "schedule" && <label className="mexal-rule-field">Pianificazione<select value={draft.schedule_mode} onChange={(event) => setDraft({ ...draft, schedule_mode: event.target.value })}><option value="daily_vercel_hobby">Giornaliera (Vercel Hobby)</option></select></label>}
      {type === "event" && <label className="mexal-rule-field">Ambito<select value={draft.scope} onChange={(event) => setDraft({ ...draft, scope: event.target.value })}>{["global", "selected_customer", "selected_product", "current_order", "current_user", "current_warehouse"].map((value) => <option key={value} value={value}>{title(value)}</option>)}</select></label>}
      {field("execution_order", "Ordine di esecuzione", "number")}
      {type === "schedule" && field("batch_size", "Dimensione batch", "number")}
    </div>
    <label className="mexal-rule-checkbox"><input type="checkbox" checked={Boolean(draft.enabled)} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} /> Regola attiva</label>
    {type === "event" && <label className="mexal-rule-checkbox"><input type="checkbox" checked={Boolean(draft.blocking)} onChange={(event) => setDraft({ ...draft, blocking: event.target.checked })} /> Bloccante</label>}
    <div className="mexal-rule-actions"><button type="button" onClick={onClose}>Annulla</button><button className="orders-primary" disabled={saving}>{saving ? "Salvataggio…" : "Salva regola"}</button></div>
  </form>;
}

function ProgressPanel({ run, stopping, onStop }) {
  if (!run) return null;
  const metadata = run.metadata || {};
  const total = Number(metadata.total || 0);
  const processed = Number(run.processed || metadata.processed || 0);
  const percent = run.status === "completed" ? 100 : Number(metadata.progress_percent || (total ? Math.round((processed / total) * 100) : 0));
  const running = run.status === "running";
  const statusLabel = running ? "In esecuzione" : run.status === "cancelled" ? "Arrestata" : run.status === "completed" ? "Completata" : run.status === "failed" ? "Errore" : title(run.status);
  return <section className="mexal-settings-panel" style={{ marginBottom: 16 }}>
    <div className="mexal-section-heading">
      <div><h3>Provvigioni listini — {statusLabel}</h3><p>{metadata.phase === "download" ? "Download dati da Mexal…" : `Batch ${metadata.current_batch || 0} di ${metadata.total_batches || "—"}`}</p></div>
      {running && <button type="button" className="orders-danger" disabled={stopping} onClick={onStop}>{stopping ? "Arresto…" : "Arresta sincronizzazione"}</button>}
    </div>
    <div style={{ width: "100%", height: 14, borderRadius: 8, background: "rgba(127,127,127,.2)", overflow: "hidden", margin: "12px 0" }}>
      <div style={{ width: `${Math.max(0, Math.min(100, percent))}%`, height: "100%", background: "currentColor", transition: "width .3s ease" }} />
    </div>
    <div className="mexal-rule-form-grid">
      <div><strong>Avanzamento</strong><br />{percent}%</div>
      <div><strong>Elaborati</strong><br />{number(processed)}{total ? ` / ${number(total)}` : ""}</div>
      <div><strong>Inseriti</strong><br />{number(run.inserted)}</div>
      <div><strong>Aggiornati</strong><br />{number(run.updated)}</div>
      <div><strong>Invariati</strong><br />{number(run.skipped)}</div>
      <div><strong>Errori</strong><br />{number(run.failed)}</div>
    </div>
    {run.error_message && <div className="mexal-alert alert-warning" style={{ marginTop: 12 }}><span>{run.error_message}</span></div>}
  </section>;
}

function RuleSection({ type, rules, onEdit, onToggle, onNew, onRunNow, saving, runningNow }) {
  const event = type === "event";
  const { columns, canCreate } = automationSection(type, true);
  return <section className="mexal-settings-panel mexal-rules-panel"><div className="mexal-section-heading"><div><h3>{event ? "Automazioni evento" : "Pianificazioni"}</h3><p>{event ? "Regole eseguite in risposta agli eventi applicativi." : "Regole pianificate configurate per il dispatcher Mexal."}</p></div>{canCreate && <button className="orders-primary" type="button" onClick={onNew}>Nuova automazione evento</button>}</div><div className="mexal-history-table-wrap"><table className="mexal-history-table mexal-rules-table"><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{rules.length === 0 ? <tr><td colSpan={columns.length}><div className="mexal-empty-state">Nessuna {event ? "automazione evento" : "pianificazione"} configurata.</div></td></tr> : rules.map((rule) => <tr key={rule.id || `${rule.sync_type}-${rule.event_key || "schedule"}`}>{event && <td>{title(rule.event_key)}</td>}<td>{title(rule.sync_type)}</td>{!event && <td>{title(rule.schedule_mode)}</td>}<td>{rule.execution_order ?? "—"}</td><td><span className={`mexal-rule-status ${rule.enabled ? "is-active" : "is-inactive"}`}>{rule.enabled ? "Attiva" : "Disattiva"}</span></td><td><div className="mexal-rule-row-actions">{!event && rule.sync_type === "list_price_commissions" && <button type="button" disabled={saving || runningNow} onClick={onRunNow}>{runningNow ? "Sincronizzazione…" : "Esegui ora"}</button>}<button type="button" onClick={() => onEdit(rule)}>Modifica</button><button type="button" disabled={saving} onClick={() => onToggle(rule)}>{rule.enabled ? "Disattiva" : "Attiva"}</button></div></td></tr>)}</tbody></table></div></section>;
}

export default function MexalAutomations({ canManage }) {
  const [rules, setRules] = useState({ schedules: [], events: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [runningNow, setRunningNow] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [activeRun, setActiveRun] = useState(null);
  const [message, setMessage] = useState(null);
  const [editor, setEditor] = useState(null);

  const refreshRun = useCallback(async () => {
    const run = await loadLatestListPriceCommissionRun({ supabase });
    setActiveRun(run);
    setRunningNow(run?.status === "running");
    return run;
  }, []);

  const reload = useCallback(async () => {
    setLoading(true); setMessage(null);
    try {
      const [loadedRules] = await Promise.all([loadMexalAutomationRules({ supabase }), refreshRun()]);
      setRules(loadedRules);
    } catch (error) { setMessage({ type: "error", text: error.message }); }
    finally { setLoading(false); }
  }, [refreshRun]);

  useEffect(() => {
    if (!canManage) return undefined;
    const timer = window.setTimeout(reload, 0);
    return () => window.clearTimeout(timer);
  }, [canManage, reload]);

  useEffect(() => {
    if (!canManage || activeRun?.status !== "running") return undefined;
    const timer = window.setInterval(() => { refreshRun().catch((error) => setMessage({ type: "error", text: error.message })); }, 2000);
    return () => window.clearInterval(timer);
  }, [canManage, activeRun?.status, refreshRun]);

  async function save(type, rule) {
    setSaving(true); setMessage(null);
    try { await saveMexalAutomationRule({ supabase, ruleType: type, rule }); await reload(); setEditor(null); setMessage({ type: "success", text: "Regola automazione salvata correttamente." }); }
    catch (error) { setMessage({ type: "error", text: error.message }); }
    finally { setSaving(false); }
  }

  async function runCommissionsNow() {
    setRunningNow(true); setMessage(null);
    const discoveryTimer = window.setInterval(() => { refreshRun().catch(() => {}); }, 1000);
    try {
      const result = await runListPriceCommissionsNow({ supabase });
      await refreshRun();
      if (result.cancelled || result.status === "cancelled") setMessage({ type: "warning", text: "Sincronizzazione provvigioni listini arrestata manualmente." });
      else setMessage({ type: result.errori?.length ? "warning" : "success", text: `Provvigioni listini sincronizzate: ${result.letti_da_mexal || 0} lette, ${result.inseriti || 0} inserite, ${result.aggiornati || 0} aggiornate, ${result.invariati || 0} invariate, ${result.disattivati || 0} disattivate, ${result.errori?.length || 0} errori.` });
    } catch (error) { setMessage({ type: "error", text: error.message }); await refreshRun().catch(() => {}); }
    finally { window.clearInterval(discoveryTimer); setRunningNow(false); }
  }

  async function stopCurrentRun() {
    if (!activeRun?.id) return;
    setStopping(true); setMessage(null);
    try {
      await stopListPriceCommissionRun({ supabase, runId: activeRun.id });
      await refreshRun();
      setMessage({ type: "warning", text: "Richiesta di arresto registrata. Il processo si fermerà al termine del batch corrente." });
    } catch (error) { setMessage({ type: "error", text: error.message }); }
    finally { setStopping(false); }
  }

  if (!canManageMexalAutomations(canManage)) return <section className="mexal-settings-panel"><div className="mexal-empty-state">La gestione delle automazioni è riservata agli amministratori.</div></section>;
  return <div className="mexal-automations">
    {message && <div className={`mexal-alert alert-${message.type}`}><span>{message.text}</span></div>}
    <ProgressPanel run={activeRun} stopping={stopping} onStop={stopCurrentRun} />
    {loading ? <section className="mexal-settings-panel"><div className="mexal-empty-state">Caricamento regole automazione…</div></section> : <>
      <RuleSection type="schedule" rules={rules.schedules} saving={saving} runningNow={runningNow} onRunNow={runCommissionsNow} onEdit={(rule) => setEditor({ type: "schedule", rule })} onToggle={(rule) => save("schedule", { ...rule, enabled: !rule.enabled })} />
      <RuleSection type="event" rules={rules.events} saving={saving} runningNow={runningNow} onNew={() => setEditor({ type: "event", rule: blankEventRule() })} onEdit={(rule) => setEditor({ type: "event", rule })} onToggle={(rule) => save("event", { ...rule, enabled: !rule.enabled })} />
    </>}
    {editor && <RuleEditor type={editor.type} rule={editor.rule} saving={saving} onClose={() => setEditor(null)} onSave={(rule) => save(editor.type, rule)} />}
  </div>;
}