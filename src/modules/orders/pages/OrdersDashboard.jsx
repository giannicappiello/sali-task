import { displayDateFormatter } from '../../../lib/displayLocale.js';
import { enrichOrderInvoices } from "../services/orderInvoices";
import OrderStatus from "../components/OrderStatus";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, Search, Sparkles } from "lucide-react";
import InfoTooltip from "../../../components/InfoTooltip";
import { supabase } from "../../../lib/supabaseClient";
import useOrdersAccess from "./useOrdersAccess";
import { useOrdersModule } from "../ordersModuleContext";
import { filterDashboardOrders, getDashboardOrderMonth } from "../services/dashboardOrders";
import { agentDisplayName, customerDisplayName, loadAgentNameMap, loadCustomerDirectory, sortOrdersNewestFirst } from "../services/agentNames";
import AIOrderTypeDialog from "../components/AIOrderTypeDialog";
import OrdersStatusFilter from "../components/OrdersStatusFilter";
import { filterOrderModuleDocuments, filterOrderModuleRows, isPrivateOrderModule, orderModuleDocumentTypes, orderModuleFilter, orderModuleUsesMexalReconciliation } from "../services/orderModules";

const DASHBOARD_STATUS_OPTIONS = Object.freeze([
  Object.freeze({ value: "aperto", label: "Aperto" }),
  Object.freeze({ value: "in_corso", label: "In corso" }),
  Object.freeze({ value: "evaso", label: "Evaso" }),
]);

export default function OrdersDashboard() {
  const { moduleCode, basePath } = useOrdersModule();
  const usesMexalReconciliation = orderModuleUsesMexalReconciliation(moduleCode);
  const navigate = useNavigate();
  const { loading: accessLoading, visibleAgents, readCustomerCodes, canSeeAll, canAccessOrders, canWriteOrders, canUseAIOrderGeneration } = useOrdersAccess(moduleCode);
  const [aiTypeDialogOpen, setAITypeDialogOpen] = useState(false);
  const [orders, setOrders] = useState([]);
  const [agentsByCode, setAgentsByCode] = useState(new Map());
  const [customersByCode, setCustomersByCode] = useState(new Map());
  const [agentsByCustomer, setAgentsByCustomer] = useState(new Map());
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [monthFilter, setMonthFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const loadStats = useCallback(async () => {
    setLoading(true);
    if (!canAccessOrders) {
      setOrders([]);
      setAgentsByCode(new Map());
      setLoading(false);
      return;
    }

    let ordersQuery = supabase.from("ordini_testate").select("*").or(orderModuleFilter(moduleCode));
    if (readCustomerCodes !== null) ordersQuery = ordersQuery.in("codice_cliente", readCustomerCodes);
    else if (!canSeeAll) ordersQuery = visibleAgents?.length ? ordersQuery.in("codice_agente_mexal", visibleAgents) : null;

    const ordersResult = ordersQuery ? await ordersQuery : {data: [], error: null};
    if (ordersResult.error) console.error("Errore caricamento ordini dashboard:", ordersResult.error);
    const orderRows = sortOrdersNewestFirst(filterOrderModuleRows(moduleCode, ordersResult.data || []));
    const orderIds = orderRows.map((order) => order.id);
    let documents = [];
    const documentTypes = orderModuleDocumentTypes(moduleCode);
    if (orderIds.length && documentTypes.length) {
      const { data, error } = await supabase.from("ordini_documenti_mexal").select("ordine_id,tipo_documento,numero,stato_operativo,presente_in_mexal").in("ordine_id", orderIds).in("tipo_documento", documentTypes).not("numero", "is", null);
      if (error) console.error("Errore caricamento documenti Mexal dashboard:", error);
      documents = data || [];
    }
    const documentsByOrder = documents.reduce((grouped, document) => {
      (grouped.get(document.ordine_id) || grouped.set(document.ordine_id, []).get(document.ordine_id)).push(document);
      return grouped;
    }, new Map());
    let names = new Map();
    let customerDirectory = { namesByCode: new Map(), agentsByCustomer: new Map() };
    try {
      customerDirectory = await loadCustomerDirectory(orderRows.map((order) => order.codice_cliente));
      names = await loadAgentNameMap(orderRows.map((order) => order.codice_agente_mexal || customerDirectory.agentsByCustomer.get(String(order.codice_cliente || "").trim().toUpperCase())));
    }
    catch (error) { console.warn("Errore caricamento anagrafiche cliente/agente dashboard:", error); }
    setAgentsByCode(names);
    setCustomersByCode(customerDirectory.namesByCode);
    setAgentsByCustomer(customerDirectory.agentsByCustomer);
    setOrders(await enrichOrderInvoices(orderRows.map((order) => ({ ...order, ragione_sociale_cliente: customerDisplayName(order, customerDirectory.namesByCode), documenti_mexal: documentsByOrder.get(order.id) || [], agente_visualizzato: agentDisplayName(order, names, customerDirectory.agentsByCustomer) }))));
    setLoading(false);
  }, [canAccessOrders, canSeeAll, readCustomerCodes, moduleCode, visibleAgents]);

  useEffect(() => {
    if (accessLoading) return undefined;
    const timer = window.setTimeout(loadStats, 0);
    return () => window.clearTimeout(timer);
  }, [accessLoading, loadStats]);

  const monthOptions = useMemo(() => [...new Set(orders.map(getDashboardOrderMonth).filter(Boolean))].toSorted().reverse(), [orders]);
  const currentMonth = new Date().toISOString().slice(0, 7);
  const filteredOrders = useMemo(() => filterDashboardOrders(orders, search, statusFilter, monthFilter), [orders, search, statusFilter, monthFilter]);
  const stats = {
    ordiniMese: filteredOrders.filter(order=>getDashboardOrderMonth(order)===(monthFilter||currentMonth)).length,
    aperti: filteredOrders.filter(order=>order.stato==='aperto').length,
    inCorso: filteredOrders.filter(order=>order.stato==='in_corso').length,
    evasi: filteredOrders.filter(order=>order.stato==='evaso').length,
  };
  function toggleStatusFilter(status) { setStatusFilter((current) => current === status ? "" : status); }
  function openAIOrderImport(type) { setAITypeDialogOpen(false); navigate(`${basePath}/nuovo-da-documento?tipo=${type}`); }

  if (accessLoading || loading) return <div className="orders-empty">Caricamento dashboard...</div>;

  return <div className="orders-page">
    <div className="orders-kpi-grid"><Kpi label="Ordini del mese" value={stats.ordiniMese} active={Boolean(monthFilter)} onClick={() => setMonthFilter((value) => value ? "" : currentMonth)} /><Kpi label="Ordini aperti" value={stats.aperti} active={statusFilter === "aperto"} onClick={() => toggleStatusFilter("aperto")} /><Kpi label="Ordini in corso" value={stats.inCorso} active={statusFilter === "in_corso"} onClick={() => toggleStatusFilter("in_corso")} /><Kpi label="Ordini evasi" value={stats.evasi} active={statusFilter === "evaso"} onClick={() => toggleStatusFilter("evaso")} /></div>
    <section className="orders-dashboard-list">
      <div className="orders-dashboard-list-header"><div className="orders-dashboard-brand"><img src="/pwa-512x512.png" alt="Logo aziendale" /><div><p>Panoramica operativa</p><h2>Ordini recenti</h2></div></div>    <div className="orders-toolbar orders-dashboard-actions">
      {canWriteOrders && <><button className="orders-primary" type="button" onClick={() => navigate(`${basePath}/nuovo`)}>{isPrivateOrderModule(moduleCode) ? "Nuovo OCT" : "Nuovo ordine"}</button>
      {!isPrivateOrderModule(moduleCode) && <button className="orders-secondary" type="button" onClick={() => navigate(`${basePath}/nuovo?tipo=prenotazione`)}>Ordine prenotazione</button>}</>}
      {canUseAIOrderGeneration && <button className="orders-secondary" type="button" onClick={() => isPrivateOrderModule(moduleCode) ? openAIOrderImport("standard") : setAITypeDialogOpen(true)}><Sparkles size={17} /> Genera con AI</button>}
    </div>
<div className="orders-dashboard-controls"><label className="orders-dashboard-month"><span>Mese</span><select value={monthFilter} onChange={(event) => setMonthFilter(event.target.value)} aria-label="Filtra ordini per mese"><option value="">Tutti i mesi</option>{monthOptions.map((month) => <option key={month} value={month}>{formatMonth(month)}</option>)}</select></label><OrdersStatusFilter value={statusFilter} onChange={setStatusFilter} options={DASHBOARD_STATUS_OPTIONS} /><div className="orders-search orders-dashboard-search"><Search size={18} aria-hidden="true" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cerca numero, cliente o agente" aria-label="Cerca ordini per numero, cliente o agente" /></div></div></div>
      <div className="orders-dashboard-filter-row"><button type="button" className={!statusFilter ? "active" : ""} onClick={() => setStatusFilter("")}>Tutti gli ordini</button>{statusFilter && <span>Stato: {statusFilter.replaceAll("_", " ")}</span>}{monthFilter && <span>Mese: {formatMonth(monthFilter)}</span>}</div>
      <div className="orders-dashboard-table-wrap"><table className="orders-table orders-dashboard-table"><thead><tr><th>Data</th><th>Ordine</th><th>Cliente</th><th>Agente</th><th>Stato</th><th>Totale</th>{usesMexalReconciliation && <th>Documenti Mexal</th>}<th><span className="sr-only">Apri ordine</span></th></tr></thead><tbody>{filteredOrders.map((order) => {

        return <tr key={order.id} className="orders-clickable-row" onClick={() => navigate(`${basePath}/elenco/${order.id}`)}><td>{formatDate(order.data_ordine)}</td><td><strong>{order.numero_ordine_visualizzato || order.numero_ordine || "Bozza"}</strong></td><td>{customerDisplayName(order, customersByCode)}</td><td>{agentDisplayName(order, agentsByCode, agentsByCustomer)}</td><td><OrderStatus order={order} basePath={basePath} /></td><td><strong>{formatCurrency(order.totale_documento ?? order.totale)}</strong></td>{usesMexalReconciliation && <td><div className="orders-dashboard-documents">{documentNumbers(order).map((number) => <span key={number}>{number}</span>)}</div></td>}<td><ArrowUpRight size={18} aria-hidden="true" /></td></tr>;
      })}</tbody></table></div>
      {!filteredOrders.length && <p className="orders-dashboard-empty">{search || statusFilter || monthFilter ? "Nessun ordine corrisponde ai filtri selezionati." : "Non ci sono ancora ordini da mostrare."}</p>}
    </section>
    <AIOrderTypeDialog open={aiTypeDialogOpen} onClose={() => setAITypeDialogOpen(false)} onSelect={openAIOrderImport} />
  </div>;
}

function formatDate(value) { if (!value) return "-"; return displayDateFormatter({ dateStyle: "medium" }).format(new Date(`${value}T00:00:00`)); }
function formatMonth(value) { return new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric" }).format(new Date(`${value}-01T00:00:00`)); }
function formatCurrency(value) { return Number(value ?? 0).toLocaleString("it-IT", { useGrouping: 'always',  style: "currency", currency: "EUR" }); }
function documentNumbers(order) {
  const types = orderModuleDocumentTypes(order.modulo_ordini || "prof");
  const stored = filterOrderModuleDocuments(order.modulo_ordini || "prof", order.documenti_mexal || []);
  return [...new Set([...types.map((type) => order[`numero_${type.toLowerCase()}`]), ...stored.map((document) => document.numero)].filter(Boolean))];
}
const ORDER_KPI_INFO = {
  "Ordini del mese": "Numero di ordini distinti con mese ordine uguale al mese selezionato (o corrente), con i filtri attivi.",
  "Ordini aperti": "Numero di ordini distinti con stato aperto con i filtri attivi.",
  "Ordini in corso": "Numero di ordini distinti con stato in corso con i filtri attivi.",
  "Ordini evasi": "Numero di ordini distinti con stato evaso con i filtri attivi.",
};
function Kpi({ label, value, active, onClick }) { const title = <span>{label}<InfoTooltip label={label} text={ORDER_KPI_INFO[label]} /></span>; if (onClick) return <button type="button" className={`orders-kpi orders-kpi-button${active ? " active" : ""}`} onClick={onClick} aria-pressed={active}>{title}<strong>{value}</strong></button>; return <div className="orders-kpi">{title}<strong>{value}</strong></div>; }
