import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, RefreshCw } from "lucide-react";
import InfoTooltip from "../../components/InfoTooltip";
import { supabase } from "../../lib/supabaseClient";
import CrmPeriodFilter, { useCrmPeriod } from "./CrmPeriodFilter";
import { CrmPageHeader, CrmSectionNav } from "./CrmWorkspaceUI";
import { formatDate, formatMoney } from "./crmConfig";
import "./commercial-control-dashboard.css";

const SCOPE = {
  global: {
    eyebrow: "CRM · Direzione commerciale",
    title: "Cabina di controllo commerciale",
    description: "PRIVATE e DIRECT su fatture Mexal, ordini Workspace e anagrafiche cliente attive.",
  },
  private: {
    eyebrow: "CRM PRIVATE · Conto Terzi",
    title: "Valore, pipeline e riordino PRIVATE",
    description: "Andamento cliente, concentrazione, pipeline reale e frequenza storica individuale.",
  },
  direct: {
    eyebrow: "CRM DIRECT",
    title: "Centro di controllo vendita diretta",
    description: "Performance DIRECT per BtoB/BtoC, mercato, Paese e agente Mexal.",
  },
};

const REORDER_LABELS = {
  regular: "Regolari",
  expected: "Riordino atteso",
  late: "In ritardo",
  risk: "A rischio",
  lost: "Persi",
  insufficient: "Storico insufficiente",
};

const CONTROL_KPI_INFO = {
  Fatturato: "Somma degli imponibili delle fatture Mexal nel periodo e nei filtri correnti.",
  Ordinato: "Somma del valore degli ordini Workspace e Mexal, inclusi gli OCT, nel periodo e nei filtri correnti.",
  "Portafoglio ordini": "Somma del valore residuo degli ordini aperti monitorati.",
  "Clienti Mexal attivi": "Numero di clienti distinti con anagrafica Mexal attiva nel perimetro selezionato.",
  "Nuovi clienti": "Clienti la cui prima vendita documentata ricade nel periodo selezionato.",
  "Clienti persi": "Clienti senza riordino da oltre 2,5 volte la propria frequenza storica individuale.",
  Pipeline: "Somma del valore nominale delle opportunità CRM aperte.",
  "Forecast ponderato": "Somma del valore di ogni opportunità moltiplicato per la relativa probabilità.",
  Forecast: "Somma del valore di ogni opportunità moltiplicato per la relativa probabilità.",
  "Riordini attesi": "Clienti che hanno raggiunto la propria data di riordino prevista in base alla frequenza storica.",
  Riordini: "Clienti con riordino atteso o già in ritardo rispetto alla frequenza storica.",
  "Ordine medio": "Valore totale degli ordini diviso per il numero di ordini del periodo.",
  "Frequenza media": "Media dei giorni intercorsi fra ordini consecutivi dei clienti con storico sufficiente.",
  "Clienti da recuperare": "Clienti classificati in ritardo o a rischio secondo la frequenza individuale di riordino.",
  "Crescita fatturato": "Variazione percentuale del fatturato rispetto al periodo di confronto selezionato.",
};

function number(value, decimals = 0) {
  return new Intl.NumberFormat("it-IT", { maximumFractionDigits: decimals }).format(Number(value || 0));
}

function percentage(value) {
  return value == null ? "—" : `${new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1, signDisplay: "exceptZero" }).format(Number(value))}%`;
}

function variation(current, previous) {
  const base = Number(previous || 0);
  if (!base) return null;
  return ((Number(current || 0) - base) / Math.abs(base)) * 100;
}

function customerPath(row) {
  const base = row.crm_area === "conto_terzi" ? "/crm/conto-terzi" : row.crm_area === "online" ? "/crm/online" : "/crm/b2b";
  return `${base}/clienti/${encodeURIComponent(`mexal:${row.codice_cliente}`)}`;
}

function MetricCard({ label, value, note, onActivate, delta }) {
  return <button className="crm-control-kpi" type="button" onClick={onActivate}>
    <span>{label}<InfoTooltip label={label} text={CONTROL_KPI_INFO[label] || note || `Indicatore ${label} calcolato sui filtri correnti.`} /></span><strong>{value}</strong>
    {delta != null ? <small className={delta >= 0 ? "positive" : "negative"}>{percentage(delta)} vs confronto</small> : note ? <small>{note}</small> : null}
  </button>;
}

function Empty({ children = "Nessun dato reale disponibile nel perimetro selezionato." }) {
  return <div className="crm-control-empty">{children}</div>;
}

function Trend({ rows }) {
  const max = Math.max(1, ...(rows || []).map((row) => Number(row.invoice_total || 0)));
  if (!rows?.length) return <Empty />;
  return <div className="crm-control-trend" role="img" aria-label="Composizione del fatturato tra PRIVATE e DIRECT">
    {rows.map((row) => { const total = Number(row.invoice_total || 0); const privateValue = Number(row.private_invoice_total || 0); const directValue = Number(row.direct_invoice_total || 0); return <div className="crm-control-trend-row" key={row.bucket}>
      <time>{formatDate(row.bucket)}</time>
      <div className="crm-control-composition" style={{ width: `${Math.max(1, total / max * 100)}%` }}><i className="private" style={{ width: `${total ? privateValue / total * 100 : 0}%` }} /><i className="direct" style={{ width: `${total ? directValue / total * 100 : 0}%` }} /><span>{formatMoney(total)}</span></div>
    </div>; })}
    <footer><span><i className="private" />PRIVATE</span><span><i className="direct" />DIRECT</span></footer>
  </div>;
}

function ReorderHealth({ rows, linkFor }) {
  if (!rows?.length) return <Empty />;
  return <div className="crm-control-health">
    {rows.map((row) => <Link key={row.status} to={linkFor(`reorder-${row.status}`)} className={`health-${row.status}`}>
      <span>{REORDER_LABELS[row.status] || row.status}</span><strong>{number(row.customers)}</strong>
      <small>{formatMoney(row.potential_value)} valore medio potenziale</small>
    </Link>)}
  </div>;
}

function CustomerTable({ rows, period, privateMode = false }) {
  if (!rows?.length) return <Empty />;
  return <div className="crm-table-wrap"><table className="crm-table crm-control-table"><thead><tr>
    <th>Cliente</th><th>Fatturato</th><th>Ordinato</th><th>Ultimo ordine</th>
    {privateMode ? <><th>Frequenza</th><th>Riordino previsto</th><th>Responsabile</th><th>Stato CRM</th><th>Stato Mexal</th></> : <><th>Paese</th><th>Agente</th><th>Salute riordino</th></>}
  </tr></thead><tbody>{rows.map((row) => <tr key={row.codice_cliente}>
    <td><Link to={period.withPeriod(customerPath(row))}><strong>{row.ragione_sociale}</strong><small>{row.codice_cliente}</small></Link></td>
    <td><Link to={period.withPeriod(customerPath(row), { detail: "invoices" })}>{formatMoney(row.invoice_total)}</Link></td>
    <td><Link to={period.withPeriod(customerPath(row), { detail: "orders" })}>{formatMoney(row.order_total)}</Link></td>
    <td>{formatDate(row.last_order_date || row.last_purchase)}</td>
    {privateMode ? <><td>{row.average_gap_days ? `${number(row.average_gap_days, 1)} gg` : "—"}</td><td>{formatDate(row.expected_reorder_date)}</td><td>{row.agent_name || "—"}</td><td>{row.crm_active === false ? "Non attivo" : "Attivo"}</td><td>{row.attivo_mexal === false ? "Annullato" : "Attivo"}</td></> : <><td>{row.country_code || "ND"}</td><td>{row.agent_name || "—"}</td><td>{REORDER_LABELS[row.reorder_status] || "—"}</td></>}
  </tr>)}</tbody></table></div>;
}

export default function CommercialControlDashboard({ scope, embedded = false }) {
  const config = SCOPE[scope] || SCOPE.global;
  const period = useCrmPeriod();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const activeRequest = useRef(null);
  const requestSequence = useRef(0);
  const compare = searchParams.get("compare") || "previous_period";
  const business = searchParams.get("business") || "";
  const market = searchParams.get("market") || "";
  const country = searchParams.get("country") || "";
  const agent = searchParams.get("agent") || "";
  const channel = searchParams.get("channel") || "";
  const customer = searchParams.get("customer") || "";
  const granularity = searchParams.get("granularity") || "month";
  const focus = searchParams.get("focus") || "";

  const setFilter = useCallback((name, value) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(name, value); else next.delete(name);
      next.delete("page");
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const linkFor = useCallback((nextFocus, extras = {}) => {
    const next = new URLSearchParams(searchParams);
    if (nextFocus) next.set("focus", nextFocus); else next.delete("focus");
    Object.entries(extras).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key));
    return `?${next.toString()}`;
  }, [searchParams]);

  const requestArguments = useMemo(() => ({
    p_scope: scope, p_from: period.from, p_to: period.to, p_compare: compare,
    p_business: scope === "global" ? business || null : scope === "private" ? "PRIVATE" : "DIRECT",
    p_market: market || null, p_country: country || null, p_agent: agent || null,
    p_channel: scope === "direct" ? channel || null : null, p_customer: customer || null,
    p_granularity: granularity,
  }), [agent, business, channel, compare, country, customer, granularity, market, period.from, period.to, scope]);
  const requestKey = useMemo(() => JSON.stringify(requestArguments), [requestArguments]);

  const load = useCallback(async () => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    const sequence = ++requestSequence.current;
    activeRequest.current = controller;
    setLoading(true); setError("");
    let request = supabase.rpc("crm_commercial_control_dashboard", requestArguments);
    if (typeof request.abortSignal === "function") request = request.abortSignal(controller.signal);
    const { data: dashboard, error: dashboardError } = await request;
    if (sequence !== requestSequence.current || controller.signal.aborted) return;
    activeRequest.current = null;
    if (dashboardError) setError(dashboardError.message); else setData(dashboard || {});
    setLoading(false);
  }, [requestArguments]);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) void load();
    });
    return () => {
      cancelled = true;
      activeRequest.current?.abort();
    };
  }, [requestKey, load]);

  const totals = useMemo(() => data?.totals || {}, [data?.totals]);
  const comparison = data?.comparison || {};
  const invoiceDelta = variation(totals.invoice_total, comparison.invoice_total);
  const orderDelta = variation(totals.order_total, comparison.order_total);
  const updated = data?.generated_at ? new Date(data.generated_at).toLocaleString("it-IT") : "—";
  const nav = scope === "private" ? [["Clienti", "/crm/conto-terzi/clienti"], ["Pipeline", "/crm/conto-terzi/pipeline"], ["Brief", "/crm/conto-terzi/brief"]]
    : scope === "direct" ? [["BtoB", "/crm/b2b"], ["BtoC / Online", "/crm/online"]] : [];

  const activateCard = useCallback((target) => {
    const targetByScope = {
      global: { top: "business", portfolio: "business", new: "attention", "reorder-lost": "attention" },
      private: { top: "top", portfolio: "top", new: "top", "reorder-lost": "reorders" },
      direct: { top: "attention", portfolio: "attention", new: "direct-origin", "reorder-lost": "reorders" },
    };
    const sectionId = targetByScope[scope]?.[target] || target;
    setFilter("focus", sectionId);
    window.requestAnimationFrame(() => document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, [scope, setFilter]);

  const kpis = useMemo(() => {
    const common = [
      ["Fatturato", formatMoney(totals.invoice_total), `${totals.invoice_count || 0} fatture Mexal`, "top", invoiceDelta],
      ["Ordinato", formatMoney(totals.order_total), `${totals.order_count || 0} ordini Workspace/Mexal, inclusi OCT`, "top", orderDelta],
      ["Portafoglio ordini", formatMoney(totals.portfolio_total), `${totals.portfolio_orders || 0} ordini aperti monitorati`, "portfolio"],
      ["Clienti Mexal attivi", number(totals.mexal_active_customers), "Stato anagrafico Mexal", "top"],
      ["Nuovi clienti", number(totals.new_customers), "Prima vendita documentata nel periodo", "new"],
    ];
    if (scope === "global") return [...common, ["Clienti persi", number(totals.lost_customers), "Frequenza individuale oltre 2,5×", "reorder-lost"]];
    if (scope === "private") return [...common,
      ["Pipeline", formatMoney(totals.pipeline_value), `${totals.pipeline_count || 0} opportunità aperte`, "pipeline"],
      ["Forecast ponderato", formatMoney(totals.weighted_pipeline), "Valore opportunità × probabilità", "pipeline"],
      ["Riordini attesi", number(totals.reorders_due), "Frequenza storica individuale", "reorders"]];
    return [...common,
      ["Riordini", number(totals.reorders_due), "Attesi o in ritardo", "reorders"],
      ["Ordine medio", formatMoney(totals.average_order_value), "Ordini Workspace/Mexal nel periodo", "top"],
      ["Frequenza media", totals.average_reorder_days ? `${number(totals.average_reorder_days, 1)} gg` : "—", "Solo clienti con storico sufficiente", "reorders"],
      ["Clienti da recuperare", number((data?.attention || []).filter((row) => ["late", "risk"].includes(row.reorder_status)).length), "Elenco operativo disponibile", "attention"],
      ["Clienti persi", number(totals.lost_customers), "Oltre 2,5× la frequenza individuale", "reorder-lost"],
      ["Crescita fatturato", percentage(invoiceDelta), "Rispetto al confronto scelto", "trend"],
      ["Forecast", formatMoney(totals.weighted_pipeline), "Pipeline ponderata reale", "pipeline"],
    ];
  }, [data?.attention, invoiceDelta, orderDelta, scope, totals]);

  const dashboard = <section className={`crm-control-dashboard scope-${scope}`} aria-label={config.title}>
    <div className="crm-control-filterbar">
      <CrmPeriodFilter period={period} compact />
      <label>Confronto<select value={compare} onChange={(event) => setFilter("compare", event.target.value)}><option value="previous_period">Periodo precedente</option><option value="previous_year">Anno precedente</option><option value="none">Nessuno</option></select></label>
      {scope === "global" ? <label>Business<select value={business} onChange={(event) => setFilter("business", event.target.value)}><option value="">Tutti</option><option value="PRIVATE">PRIVATE</option><option value="DIRECT">DIRECT</option></select></label> : null}
      {scope === "direct" ? <label>Canale<select value={channel} onChange={(event) => setFilter("channel", event.target.value)}><option value="">BtoB e BtoC</option><option value="BtoB">BtoB</option><option value="BtoC">BtoC / Online attuale</option></select></label> : null}
      <label>Mercato<select value={market} onChange={(event) => setFilter("market", event.target.value)}><option value="">Tutti</option><option value="italy">Italia</option><option value="foreign">Estero</option></select></label>
      <label>Paese<select value={country} onChange={(event) => setFilter("country", event.target.value)}><option value="">Tutti</option>{(data?.filters?.countries || []).map((code) => <option key={code} value={code}>{code}</option>)}</select></label>
      <label>Agente<select value={agent} onChange={(event) => setFilter("agent", event.target.value)}><option value="">Tutti</option>{(data?.filters?.agents || []).map((item) => <option key={item.code} value={item.code}>{item.name} · {item.code}</option>)}</select></label>
      <label className="crm-control-customer">Cliente<input value={customer} onChange={(event) => setFilter("customer", event.target.value)} placeholder="Codice o ragione sociale" /></label>
      <button type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={16} />Aggiorna</button>
    </div>
    <p className="crm-control-updated">Ultimo aggiornamento: {updated}. Nessun polling automatico.</p>
    {error ? <div className="crm-message error"><span>{error}</span><button type="button" onClick={load}>Riprova</button></div> : null}
    {loading ? <div className="crm-loading">Calcolo server-side sull’intero dataset filtrato...</div> : <>
      <div className={`crm-control-kpis ${scope === "direct" ? "wide" : ""}`}>{kpis.map(([label, value, note, target, delta]) => <MetricCard key={label} label={label} value={value} note={note} delta={delta} onActivate={() => activateCard(target)} />)}</div>

      {scope === "global" ? <section className="crm-control-panel" id="business"><header><div><span>Composizione business</span><h3>PRIVATE vs DIRECT</h3></div></header><div className="crm-control-business crm-business-summary">{(data?.business || []).map((row) => <Link key={row.business} to={row.business === "PRIVATE" ? period.withPeriod("/crm/conto-terzi") : period.withPeriod("/crm/direct")}><strong>{row.business}</strong><span>{formatMoney(row.invoice_total)} fatturato</span><span>{formatMoney(row.order_total)} ordinato</span><span>{number(row.customers)} clienti</span>{row.business === "DIRECT" ? <small>BtoB {formatMoney(data?.direct_breakdown?.btob_invoice_total)} · BtoC {formatMoney(data?.direct_breakdown?.btoc_invoice_total)} · Estero {formatMoney(data?.direct_breakdown?.foreign_invoice_total)}</small> : null}</Link>)}</div></section> : null}

      <section className="crm-control-panel" id="trend"><header><div><span>Andamento</span><h3>Composizione fatturato PRIVATE / DIRECT</h3></div><select aria-label="Raggruppamento andamento" value={granularity} onChange={(event) => setFilter("granularity", event.target.value)}><option value="day">Giorno</option><option value="week">Settimana</option><option value="month">Mese</option></select></header><Trend rows={data?.trend || []} /></section>

      {scope === "private" ? <>
        <section className="crm-control-panel" id="top"><header><div><span>Valore cliente</span><h3>Top clienti PRIVATE</h3></div></header><CustomerTable rows={data?.top_customers || []} period={period} privateMode /></section>
        <section className="crm-control-split"><article className="crm-control-panel"><header><div><span>Dipendenza commerciale</span><h3>Concentrazione fatturato</h3></div></header>{[1, 5, 10].map((limit) => { const total = Number(data?.concentration?.total || 0); const value = Number(data?.concentration?.[`top_${limit}`] || 0); return <div className="crm-control-concentration" key={limit}><span>Top {limit}</span><strong>{total ? percentage(value / total * 100) : "—"}</strong><i style={{ width: `${total ? value / total * 100 : 0}%` }} /></div>; })}</article><article className="crm-control-panel" id="reorders"><header><div><span>Frequenza cliente</span><h3>Riordini PRIVATE</h3></div></header><ReorderHealth rows={data?.reorder_health || []} linkFor={linkFor} /></article></section>
        <section className="crm-control-panel" id="pipeline"><header><div><span>Fasi realmente configurate</span><h3>Pipeline PRIVATE</h3></div></header><div className="crm-control-stage-grid">{(data?.pipeline_stages || []).map((row) => <Link key={row.id} to={period.withPeriod("/crm/conto-terzi/pipeline", { stage: row.id })}><strong>{row.nome}</strong><span>{number(row.opportunity_count)} opportunità</span><span>{formatMoney(row.value)}</span><small>{number(row.average_days, 1)} gg medi nello stato</small></Link>)}</div></section>
      </> : null}

      {scope === "direct" ? <>
        <section className="crm-control-panel" id="direct-origin"><header><div><span>Nuovi clienti vs riordini</span><h3>Origine dell’ordinato DIRECT</h3></div></header><div className="crm-control-business">{[["Nuovi clienti", data?.acquisition?.new_customer_orders], ["Riordini", data?.acquisition?.reorder_orders], ["Altre vendite", data?.acquisition?.other_orders]].map(([label, value]) => <Link key={label} to={linkFor(label === "Nuovi clienti" ? "new" : "reorders")}><strong>{label}</strong><span>{formatMoney(value)}</span><span>{totals.order_total ? percentage(Number(value || 0) / Number(totals.order_total) * 100) : "—"}</span></Link>)}</div></section>
        <section className="crm-control-panel"><header><div><span>Dimensione reale Mexal</span><h3>Performance agenti</h3></div></header><div className="crm-table-wrap"><table className="crm-table"><thead><tr><th>Agente</th><th>Fatturato</th><th>Ordinato</th><th>Clienti</th><th>Nuovi</th><th>In calo</th><th>Tasso riordino</th></tr></thead><tbody>{(data?.agents || []).map((row) => <tr key={row.agent_code || row.agent_name}><td><button type="button" className="crm-table-link" onClick={() => setFilter("agent", row.agent_code || "")}>{row.agent_name}</button><small>{row.agent_code || "Senza codice"}</small></td><td>{formatMoney(row.invoice_total)}</td><td>{formatMoney(row.order_total)}</td><td>{number(row.customers)}</td><td>{number(row.new_customers)}</td><td>{number(row.declining_customers)}</td><td>{row.reorder_rate == null ? "—" : percentage(Number(row.reorder_rate) * 100)}</td></tr>)}</tbody></table></div></section>
        <section className="crm-control-split"><article className="crm-control-panel"><header><div><span>Estero</span><h3>Performance per Paese</h3></div></header><div className="crm-table-wrap"><table className="crm-table"><thead><tr><th>Paese</th><th>Fatturato</th><th>Ordinato</th><th>Clienti</th><th>Agenti</th></tr></thead><tbody>{(data?.countries || []).map((row) => <tr key={row.country_code}><td><button type="button" className="crm-table-link" onClick={() => setFilter("country", row.country_code)}>{row.country_code}</button></td><td>{formatMoney(row.invoice_total)}</td><td>{formatMoney(row.order_total)}</td><td>{number(row.customers)}</td><td>{number(row.agents)}</td></tr>)}</tbody></table></div></article><article className="crm-control-panel" id="reorders"><header><div><span>Salute portafoglio</span><h3>Riordini DIRECT</h3></div></header><ReorderHealth rows={data?.reorder_health || []} linkFor={linkFor} /></article></section>
      </> : null}

      <section className="crm-control-panel" id="attention"><header><div><span>Attenzione commerciale</span><h3>{scope === "private" ? "Clienti PRIVATE da recuperare" : "Clienti che richiedono attenzione"}</h3></div><AlertTriangle size={20} /></header><CustomerTable rows={(data?.attention || []).filter((row) => !focus.startsWith("reorder-") || row.reorder_status === focus.slice(8))} period={period} privateMode={scope === "private"} /></section>

    </>}
  </section>;

  if (embedded) return dashboard;
  return <div className="crm-page"><CrmPageHeader eyebrow={config.eyebrow} title={config.title} description={config.description}>{nav.length ? <CrmSectionNav items={nav} period={period} label={`Navigazione ${scope}`} /> : null}</CrmPageHeader>{dashboard}</div>;
}
