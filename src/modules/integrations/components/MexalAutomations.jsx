import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import { loadMexalAutomationRules, saveMexalAutomationRule } from "../services/mexalAutomationService";

const syncTypes = ["clients", "agents", "products", "commercial_conditions", "document_series", "stocks", "orders", "payments"];
const eventKeys = ["orders_module_open", "before_new_order", "customer_selected", "before_order_save", "after_order_save", "before_order_send", "after_order_send", "product_selected", "manual"];

function title(value) { return String(value || "—").replaceAll("_", " "); }
function blankRule(type) {
  return type === "schedule"
    ? { sync_type: "products", enabled: false, schedule_mode: "daily_vercel_hobby", batch_size: 100, execution_order: 1 }
    : { event_key: "manual", sync_type: "products", enabled: false, execution_order: 1, blocking: false, scope: "global" };
}

function RuleEditor({ type, rule, onClose, onSave, saving }) {
  const [draft, setDraft] = useState(rule);
  const field = (name, label, input = "text") => <label className="mexal-rule-field">{label}<input type={input} value={draft[name] ?? ""} onChange={(event) => setDraft({ ...draft, [name]: input === "number" ? Number(event.target.value) : event.target.value })} /></label>;
  return <form className="mexal-rule-editor" onSubmit={(event) => { event.preventDefault(); onSave(draft); }}>
    <h4>{rule.id ? "Modifica regola" : type === "schedule" ? "Nuova pianificazione" : "Nuova automazione evento"}</h4>
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

function RuleSection({ type, rules, onEdit, onToggle, onNew, saving }) {
  const event = type === "event";
  return <section className="mexal-settings-panel mexal-rules-panel"><div className="mexal-section-heading"><div><h3>{event ? "Automazioni evento" : "Pianificazioni"}</h3><p>{event ? "Regole eseguite in risposta agli eventi applicativi." : "Regole pianificate configurate per il dispatcher Mexal."}</p></div><button className="orders-primary" type="button" onClick={onNew}>{event ? "Nuova automazione evento" : "Nuova pianificazione"}</button></div><div className="mexal-history-table-wrap"><table className="mexal-history-table mexal-rules-table"><thead><tr>{event && <th>Evento</th>}<th>Tipo sincronizzazione</th>{!event && <th>Frequenza</th>}<th>Ordine</th><th>Stato</th><th>Azioni</th></tr></thead><tbody>{rules.length === 0 ? <tr><td colSpan={event ? 5 : 5}><div className="mexal-empty-state">Nessuna {event ? "automazione evento" : "pianificazione"} configurata.</div></td></tr> : rules.map((rule) => <tr key={rule.id || `${rule.sync_type}-${rule.event_key || "schedule"}`}><td>{event && title(rule.event_key)}</td><td>{title(rule.sync_type)}</td>{!event && <td>{title(rule.schedule_mode)}</td>}<td>{rule.execution_order ?? "—"}</td><td><span className={`mexal-rule-status ${rule.enabled ? "is-active" : "is-inactive"}`}>{rule.enabled ? "Attiva" : "Disattiva"}</span></td><td><div className="mexal-rule-row-actions"><button type="button" onClick={() => onEdit(rule)}>Modifica</button><button type="button" disabled={saving} onClick={() => onToggle(rule)}>{rule.enabled ? "Disattiva" : "Attiva"}</button></div></td></tr>)}</tbody></table></div></section>;
}

export default function MexalAutomations({ canManage }) {
  const [rules, setRules] = useState({ schedules: [], events: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [editor, setEditor] = useState(null);
  const reload = useCallback(async () => { setLoading(true); setMessage(null); try { setRules(await loadMexalAutomationRules({ supabase })); } catch (error) { setMessage({ type: "error", text: error.message }); } finally { setLoading(false); } }, []);
  useEffect(() => {
    if (!canManage) return undefined;
    const timer = window.setTimeout(reload, 0);
    return () => window.clearTimeout(timer);
  }, [canManage, reload]);
  async function save(type, rule) { setSaving(true); setMessage(null); try { await saveMexalAutomationRule({ supabase, ruleType: type, rule }); await reload(); setEditor(null); setMessage({ type: "success", text: "Regola automazione salvata correttamente." }); } catch (error) { setMessage({ type: "error", text: error.message }); } finally { setSaving(false); } }
  if (!canManage) return <section className="mexal-settings-panel"><div className="mexal-empty-state">La gestione delle automazioni è riservata agli amministratori.</div></section>;
  return <div className="mexal-automations">{message && <div className={`mexal-alert alert-${message.type}`}><span>{message.text}</span></div>}{loading ? <section className="mexal-settings-panel"><div className="mexal-empty-state">Caricamento regole automazione…</div></section> : <><RuleSection type="schedule" rules={rules.schedules} saving={saving} onNew={() => setEditor({ type: "schedule", rule: blankRule("schedule") })} onEdit={(rule) => setEditor({ type: "schedule", rule })} onToggle={(rule) => save("schedule", { ...rule, enabled: !rule.enabled })} /><RuleSection type="event" rules={rules.events} saving={saving} onNew={() => setEditor({ type: "event", rule: blankRule("event") })} onEdit={(rule) => setEditor({ type: "event", rule })} onToggle={(rule) => save("event", { ...rule, enabled: !rule.enabled })} /></>}{editor && <RuleEditor type={editor.type} rule={editor.rule} saving={saving} onClose={() => setEditor(null)} onSave={(rule) => save(editor.type, rule)} />}</div>;
}
