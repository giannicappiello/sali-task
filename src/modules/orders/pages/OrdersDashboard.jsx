import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, Search } from "lucide-react";
import { supabase } from "../../../lib/supabaseClient";
import useOrdersAccess from "./useOrdersAccess";
import { filterDashboardOrders } from "../services/dashboardOrders";
import { agentDisplayName, loadAgentNameMap, sortOrdersNewestFirst } from "../services/agentNames";

export default function OrdersDashboard() {
  const navigate = useNavigate();
  const { loading: accessLoading, visibleAgents, canSeeAll, canAccessOrders } = useOrdersAccess();
  const [stats, setStats] = useState({ ordiniMese: 0, aperti: 0, inCorso: 0, evasi: 0 });
  const [orders, setOrders] = useState([]);
  const [agentsByCode, setAgentsByCode] = useState(new Map());
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const visibleAgentsKey = JSON.stringify(visibleAgents);

  const countTable = useCallback(async (table, filters = []) => {
    let query = supabase.from(table).select("*", { count: "exact", head: true });
    filters.forEach(([field, value]) => { query = query.eq(field, value); });
    if (!canSeeAll) {
      if (!visibleAgents?.length) return 0;
      query = query.in("codice_agente_mexal", visibleAgents);
    }
    const { count, error } = await query;
    if (error) { console.error(`Errore conteggio ${table}:`, error); return 0; }
    return count || 0;
  }, [canSeeAll, visibleAgentsKey]);

  const loadStats = useCallback(async () => {
    setLoading(true);
    if (!canAccessOrders) {
      setStats({ ordiniMese: 0, aperti: 0, inCorso: 0, evasi: 0 });
      setOrders([]);
      setAgentsByCode(new Map());
      setLoading(false);
      return;
    }

    const month = new Date().toISOString().slice(0, 7);
    let ordersQuery = supabase.from("ordini_testate").select("*");
    if (!canSeeAll) ordersQuery = visibleAgents?.length ? ordersQuery.in("codice_agente_mexal", visibleAgents) : null;

    const [ordiniMese, aperti, inCorso, evasi, ordersResult] = await Promise.all([
      countTable("ordini_testate", [["mese_ordine", month]]),
      countTable("ordini_testate", [["stato", "aperto"]]),
      countTable("ordini_testate", [["stato", "in_corso"]]),
      countTable("ordini_testate", [["stato", "evaso"]]),
      ordersQuery || Promise.resolve({ data: [], error: null }),
    ]);

    setStats({ ordiniMese, aperti, inCorso, evasi });
    if (ordersResult.error) console.error("Errore caricamento ordini dashboard:", ordersResult.error);
    const orderRows = sortOrdersNewestFirst(ordersResult.data || []);
    const orderIds = orderRows.map((order) => order.id);
    let documents = [];
    if (orderIds.length) {
      const { data, error } = await supabase.from("ordini_documenti_mexal").select("ordine_id, tipo_documento, numero").in("ordine_id", orderIds).not("numero", "is", null);
      if (error) console.error("Errore caricamento documenti Mexal dashboard:", error);
      documents = data || [];
    }
    const documentsByOrder = documents.reduce((grouped, document) => {
      (grouped.get(document.ordine_id) || grouped.set(document.ordine_id, []).get(document.ordine_id)).push(document);
      return grouped;
    }, new Map());
    let names = new Map();
    try { names = await loadAgentNameMap(orderRows.map((order) => order.codice_agente_mexal)); }
    catch (error) { console.warn("Errore caricamento nomi agenti dashboard:", error); }
    setAgentsByCode(names);
    setOrders(orderRows.map((order) => ({ ...order, documenti_mexal: documentsByOrder.get(order.id) || [], agente_visualizzato: agentDisplayName(order, names) })));
    setLoading(false);
  }, [canAccessOrders, canSeeAll, countTable, visibleAgentsKey]);

  useEffect(() => { if (!accessLoading) loadStats(); }, [accessLoading, loadStats]);

  const filteredOrders = useMemo(() => filterDashboardOrders(orders, search, statusFilter), [orders, search, statusFilter]);
  function toggleStatusFilter(status) { setStatusFilter((current) => current === status ? "" : status); }

  if (accessLoading || loading) return <div className="orders-empty">Caricamento dashboard...</div>;

  return <div className="orders-page">
    <div className="orders-toolbar">
      <button className="orders-primary" type="button" onClick={() => navigate("/ordini/nuovo")}>Nuovo ordine</button>
    </div>
    <div className="orders-kpi-grid"><Kpi label="Ordini del mese" value={stats.ordiniMese} /><Kpi label="Ordini aperti" value={stats.aperti} status="aperto" active={statusFilter === "aperto"} onClick={toggleStatusFilter} /><Kpi label="Ordini in corso" value={stats.inCorso} status="in_corso" active={statusFilter === "in_corso"} onClick={toggleStatusFilter} /><Kpi label="Ordini evasi" value={stats.evasi} status="evaso" active={statusFilter === "evaso"} onClick={toggleStatusFilter} /></div>
    <section className="orders-dashboard-list">
      <div className="orders-dashboard-list-header"><div className="orders-dashboard-brand"><img src="/pwa-512x512.png" alt="Logo aziendale" /><div><p>Panoramica operativa</p><h2>Ordini recenti</h2></div></div><div className="orders-search orders-dashboard-search"><Search size={18} aria-hidden="true" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cerca numero, cliente o agente" aria-label="Cerca ordini per numero, cliente o agente" /></div></div>
      <div className="orders-dashboard-filter-row"><button type="button" className={!statusFilter ? "active" : ""} onClick={() => setStatusFilter("")}>Tutti gli ordini</button>{statusFilter && <span>Filtro attivo: {statusFilter.replaceAll("_", " ")}</span>}</div>
      <div className="orders-dashboard-table-wrap"><table className="orders-table orders-dashboard-table"><thead><tr><th>Data</th><th>Ordine</th><th>Cliente</th><th>Agente</th><th>Stato</th><th>Totale</th><th>Documenti Mexal</th><th><span className="sr-only">Apri ordine</span></th></tr></thead><tbody>{filteredOrders.map((order) => <tr key={order.id} className="orders-clickable-row" onClick={() => navigate(`/ordini/elenco/${order.id}`)}><td>{formatDate(order.data_ordine)}</td><td><strong>{order.numero_ordine_visualizzato || order.numero_ordine || "Bozza"}</strong></td><td>{order.ragione_sociale_cliente || order.codice_cliente || "-"}</td><td>{agentDisplayName(order, agentsByCode)}</td><td><span className={`orders-status ${order.stato}`}>{order.stato || "bozza"}</span></td><td><strong>{formatCurrency(order.totale_documento ?? order.totale)}</strong></td><td><div className="orders-dashboard-documents">{documentNumbers(order).map((number) => <span key={number}>{number}</span>)}</div></td><td><ArrowUpRight size={18} aria-hidden="true" /></td></tr>)}</tbody></table></div>
      {!filteredOrders.length && <p className="orders-dashboard-empty">{search ? "Nessun ordine corrisponde alla ricerca." : "Non ci sono ancora ordini da mostrare."}</p>}
    </section>
  </div>;
}

function formatDate(value) { if (!value) return "-"; return new Intl.DateTimeFormat("it-IT", { dateStyle: "medium" }).format(new Date(`${value}T00:00:00`)); }
function formatCurrency(value) { return Number(value ?? 0).toLocaleString("it-IT", { style: "currency", currency: "EUR" }); }
function documentNumbers(order) { return [...new Set([order.numero_ocm, order.numero_ocx, order.numero_oci, ...(order.documenti_mexal || []).map((document) => document.numero)].filter(Boolean))]; }
function Kpi({ label, value, status, active, onClick }) { if (status) return <button type="button" className={`orders-kpi orders-kpi-button${active ? " active" : ""}`} onClick={() => onClick(status)} aria-pressed={active}><span>{label}</span><strong>{value}</strong></button>; return <div className="orders-kpi"><span>{label}</span><strong>{value}</strong></div>; }
