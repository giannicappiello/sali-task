import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import InfoTooltip from "../../components/InfoTooltip";
import { supabase } from "../../lib/supabaseClient";
import { formatDate, formatMoney } from "./crmConfig";
import { useCrmPeriod } from "./CrmPeriodFilter";

async function invoke(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke("report-giornate-api", { body: { action, ...payload } });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data || {};
}

function Metric({ label, value, text, to }) {
  return <Link className="kpi-card crm-kpi" to={to} aria-label={`${label}: ${value}. Apri dettaglio`}><span>{label}<InfoTooltip label={label} text={text} /></span><strong>{value}</strong><em>Apri dettaglio →</em></Link>;
}

export function CrmBeautyCustomerPanel({ customerCode }) {
  const [data, setData] = useState(null); const [error, setError] = useState("");
  const load = useCallback(async () => { if (!customerCode) return; setError(""); try { const { data: workflow } = await supabase.from("crm_workflow_settings").select("beauty_post_evento_giorni").eq("crm_tipo", "b2b").maybeSingle(); setData(await invoke("crm-beauty-customer", { customerCode, postDays: workflow?.beauty_post_evento_giorni || 30 })); } catch (loadError) { setError(loadError.message); } }, [customerCode]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  if (!customerCode) return null;
  return <section className="panel crm-panel"><h3>BeautyDays</h3>{error ? <div className="crm-message error">{error}</div> : null}{data && !data.linked ? <p>Nessun collegamento BeautyDays disponibile per questo cliente.</p> : null}<div className="crm-list-grid">{(data?.events || []).map((event) => <article className="crm-list-card" key={event.id}><span>{event.stato}</span><h3>{formatDate(event.data)}</h3><p>{event.consultant_name || "Beauty consultant non indicata"} · {event.numero_totale_pezzi_venduti || 0} pezzi · {formatMoney(event.fatturato_giornata)}</p><small>Nei {data.post_days} giorni successivi: {event.impact.invoice_count} fatture ({formatMoney(event.impact.invoice_value)}) · {event.impact.order_count} ordini ({formatMoney(event.impact.order_value)})</small></article>)}</div>{data?.linked && !data.events?.length ? <p>Nessuna giornata registrata.</p> : null}</section>;
}

export function CrmBeautyDashboardPanel() {
  const period = useCrmPeriod();
  const [data, setData] = useState(null); const [error, setError] = useState("");
  const load = useCallback(async () => { setError(""); try { const { data: workflow } = await supabase.from("crm_workflow_settings").select("beauty_post_evento_giorni").eq("crm_tipo", "b2b").maybeSingle(); setData(await invoke("crm-beauty-dashboard", { postDays: workflow?.beauty_post_evento_giorni || 30 })); } catch (loadError) { setError(loadError.message); } }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  const metrics = data?.metrics || {};
  const detail = (metric) => period.withPeriod("/crm/b2b/beautydays", { beautyMetric: metric });
  return <section className="crm-beauty-dashboard"><div className="crm-toolbar"><div><span className="crm-eyebrow">CRM B2B · BeautyDays</span><h2>Impatto giornate promozionali</h2><p>Fonte reale Report Giornate, collegata tramite l’anagrafica cliente canonica.</p></div></div>{error ? <div className="crm-message error">{error}</div> : null}<div className="crm-kpi-grid"><Metric label="Farmacie collegate" value={metrics.linked_customers || 0} text="Clienti B2B visibili con collegamento canonico BeautyDays e almeno una giornata." to={detail("customers")} /><Metric label="Giornate eseguite" value={metrics.executed_events || 0} text="Giornate promozionali con stato eseguita." to={detail("executed")} /><Metric label="Giornate pianificate" value={metrics.planned_events || 0} text="Giornate promozionali ancora pianificate." to={detail("planned")} /><Metric label="Pezzi venduti" value={Number(metrics.reported_units || 0).toLocaleString("it-IT")} text="Somma dei pezzi dichiarati nelle giornate eseguite." to={detail("units")} /><Metric label="Fatturato giornata" value={formatMoney(metrics.reported_revenue)} text="Somma del fatturato dichiarato nelle giornate eseguite." to={detail("revenue")} /><Metric label="Fatturato post-evento" value={formatMoney(metrics.post_event_invoice_value)} text={`Fatture Mexal del cliente nei ${data?.post_days || 30} giorni successivi a ciascuna giornata eseguita. Non è attribuzione causale.`} to={detail("post-revenue")} /></div></section>;
}

export function CrmB2BLifecyclePanel() {
  const period = useCrmPeriod();
  const [data, setData] = useState({}); const [error, setError] = useState("");
  const load = useCallback(async () => { const { data: result, error: loadError } = await supabase.rpc("crm_b2b_lifecycle_summary"); if (loadError) setError(loadError.message); else setData(result || {}); }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  const worklist = (segment, reorders = false) => period.withPeriod(reorders ? "/crm/b2b/riordini" : "/crm/b2b/da-seguire", { segment });
  return <section className="crm-beauty-dashboard"><div className="crm-toolbar"><div><span className="crm-eyebrow">CRM B2B</span><h2>Ciclo cliente e riordino</h2><p>Classificazione dinamica derivata dalla frequenza storica individuale.</p></div></div>{error ? <div className="crm-message error">{error}</div> : null}<div className="crm-kpi-grid"><Metric label="Prospect" value={data.prospects || 0} text="Clienti senza ordini documentati." to={worklist("prospect")} /><Metric label="Primo ordine" value={data.first_order || 0} text="Clienti con un solo ordine documentato." to={worklist("primo_ordine", true)} /><Metric label="Riordini" value={data.reorders || 0} text="Clienti con almeno due ordini documentati." to={worklist("attivo", true)} /><Metric label="A rischio" value={data.at_risk || 0} text="Clienti oltre la frequenza attesa individuale entro la soglia di rischio configurata." to={worklist("a_rischio")} /><Metric label="Dormienti" value={data.dormant || 0} text="Clienti oltre la soglia dormiente configurata." to={worklist("dormiente")} /><Metric label="Persi" value={data.lost || 0} text="Clienti oltre la soglia di perdita configurata." to={worklist("perso")} /></div></section>;
}
