import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import { automationSection, canManageMexalAutomations, loadMexalAutomationRules, runListPriceCommissionsNow, saveMexalAutomationRule } from "../services/mexalAutomationService";

const eventKeys = ["orders_module_open", "before_new_order", "customer_selected", "before_order_save", "after_order_save", "before_order_send", "after_order_send", "product_selected", "manual"];

function title(value) { return String(value || "—").replaceAll("_", " "); }
function blankEventRule() { return { event_key: "manual", sync_type: "products", enabled: false, execution_order: 1, blocking: false, scope: "global" }; }

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

function RuleSection({ type, rules, onEdit, onToggle, onNew, onRunNow, saving, runningNow }) {
  const event = type === "event";
  const { columns, canCreate } = automationSection(type, true);
  return <section className="mexal-settings-panel mexal-rules-panel"><div className="mexal-section-heading"><div><h3>{event ? "Automazioni evento" : "Pianificazioni"}</h3><p>{event ? "Regole eseguite in risposta agli eventi applicativi." : "Regole pianificate configurate per il dispatcher Mexal."}</p></div>{canCreate && <button className="orders-primary" type="button" onClick={onNew}>Nuova automazione evento</button>}</div><div className="mexal-history-table-wrap"><table className="mexal-history-table mexal-rules-table"><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{rules.length === 0 ? <tr><td colSpan={columns.length}><div className="mexal-empty-state">Nessuna {event ? "automazione evento" : "pianificazione"} configurata.</div></td></tr> : rules.map((rule) => <tr key={rule.id || `${rule.sync_type}-${rule.event_key || "schedule"}`}><td>{event ? title(rule.event_key) : title(rule.sync_type)}</td>{event && <td>{title(rule.sync_type)}</td>}{!event && <td>{title(rule.schedule_mode)}</td>}<td>{rule.execution_order ?? "—"}</td><td><span className={`mexal-rule-status ${rule.enabled ? "is-active" : "is-inactive"}`}>{rule.enabled ? "Attiva" : "Disattiva"}</span></td><td><div className="mexal-rule-row-actions">{!event && rule.sync_type === "list_price_commissions" && <button type="button" disabled={saving || runningNow} onClick={onRunNow}>{runningNow ? "Sincronizzazione…" : "Esegui ora"}</button>}<button type="button" onClick={() => onEdit(rule)}>Modifica</button><button type="button" disabled={saving} onClick={() => onToggle(rule)}>{rule.enabled ? "Disattiva" : "Attiva"}</button></div></td></tr>)}</tbody></table></div></section>;
}

export default function MexalAutomations({ canManage }) {
  const [rules, setRules] = useState({ schedules: [], events: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [runningNow, setRunningNow] = useState(false);
  const [message, setMessage] = useState(null);
  const [editor, setEditor] = useState(null);
  const reload = useCallback(async () => { setLoading(true); setMessage(null); try { setRules(await loadMexalAutomationRules({ supabase })); } catch (error) { setMessage({ type: "error", text: error.message }); } finally { setLoading(false); } }, []);
  useEffect(() => {
    if (!canManage) return undefined;
    const timer = window.setTimeout(reload, 0);
    return () => window.clearTimeout(timer);
  }, [canManage, reload]);
  async function save(type, rule) { setSaving(true); setMessage(null); try { await saveMexalAutomationRule({ supabase, ruleType: type, rule }); await reload(); setEditor(null); setMessage({ type: "success", text: "Regola automazione salvata correttamente." }); } catch (error) { setMessage({ type: "error", text: error.message }); } finally { setSaving(false); } }
  async function runCommissionsNow() {
    setRunningNow(true); setMessage(null);
    try {
      const result = await runListPriceCommissionsNow({ supabase });
      setMessage({ type: result.errori?.length ? "warning" : "success", text: `Provvigioni listini sincronizzate: ${result.letti_da_mexal || 0} lette, ${result.inseriti || 0} inserite, ${result.aggiornati || 0} aggiornate, ${result.invariati || 0} invariate, ${result.disattivati || 0} disattivate, ${result.errori?.length || 0} errori.` });
    } catch (error) { setMessage({ type: "error", text: error.message }); }
    finally { setRunningNow(false); }
  }
  if (!canManageMexalAutomations(canManage)) return <section className="mexal-settings-panel"><div className="mexal-empty-state">La gestione delle automazioni è riservata agli amministratori.</div></section>;
  return <div className="mexal-automations">{message && <div className={`mexal-alert alert-${message.type}`}><span>{message.text}</span></div>}{loading ? <section className="mexal-settings-panel"><div className="mexal-empty-state">Caricamento regole automazione…</div></section> : <><RuleSection type="schedule" rules={rules.schedules} saving={saving} runningNow={runningNow} onRunNow={runCommissionsNow} onEdit={(rule) => setEditor({ type: "schedule", rule })} onToggle={(rule) => save("schedule", { ...rule, enabled: !rule.enabled })} /><RuleSection type="event" rules={rules.events} saving={saving} runningNow={runningNow} onNew={() => setEditor({ type: "event", rule: blankEventRule() })} onEdit={(rule) => setEditor({ type: "event", rule })} onToggle={(rule) => save("event", { ...rule, enabled: !rule.enabled })} /></>}{editor && <RuleEditor type={editor.type} rule={editor.rule} saving={saving} onClose={() => setEditor(null)} onSave={(rule) => save(editor.type, rule)} />}</div>;
}
