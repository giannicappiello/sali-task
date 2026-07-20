import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, Search } from "lucide-react";
import { supabase } from "../../../lib/supabaseClient";
import useOrdersAccess from "./useOrdersAccess";

export default function OrdersDashboard() {
  const navigate = useNavigate();
  const {
    loading: accessLoading,
    visibleAgents,
    canSeeAll,
    canAccessOrders,
  } = useOrdersAccess();

  const [stats, setStats] = useState({
    ordiniMese: 0,
    aperti: 0,
    inCorso: 0,
    evasi: 0,
  });
  const [orders, setOrders] = useState([]);
  const [search, setSearch] = useState("");

  const [loading, setLoading] = useState(true);
  const visibleAgentsKey = JSON.stringify(visibleAgents);

  const countTable = useCallback(async (table, filters = []) => {
    let query = supabase
      .from(table)
      .select("*", { count: "exact", head: true });

    filters.forEach(([field, value]) => {
      query = query.eq(field, value);
    });

    if (!canSeeAll) {
      if (!visibleAgents?.length) return 0;
      query = query.in("codice_agente_mexal", visibleAgents);
    }

    const { count, error } = await query;

    if (error) {
      console.error(`Errore conteggio ${table}:`, error);
      return 0;
    }

    return count || 0;
  }, [canSeeAll, visibleAgentsKey]);

  const loadStats = useCallback(async () => {
    setLoading(true);

    if (!canAccessOrders) {
      setStats({
        ordiniMese: 0,
        aperti: 0,
        inCorso: 0,
        evasi: 0,
      });
      setOrders([]);
      setLoading(false);
      return;
    }

    const month = new Date().toISOString().slice(0, 7);

    let ordersQuery = supabase
      .from("ordini_testate")
      .select("*")
      .order("data_ordine", { ascending: false });

    if (!canSeeAll) {
      ordersQuery = visibleAgents?.length
        ? ordersQuery.in("codice_agente_mexal", visibleAgents)
        : null;
    }

    const [ordiniMese, aperti, inCorso, evasi, ordersResult] =
      await Promise.all([
        countTable(
          "ordini_testate",
          [["mese_ordine", month]]
        ),
        countTable("ordini_testate", [["stato", "aperto"]]),
        countTable("ordini_testate", [["stato", "in_corso"]]),
        countTable("ordini_testate", [["stato", "evaso"]]),
        ordersQuery || Promise.resolve({ data: [], error: null }),
      ]);

    setStats({
      ordiniMese,
      aperti,
      inCorso,
      evasi,
    });
    if (ordersResult.error) console.error("Errore caricamento ordini dashboard:", ordersResult.error);
    setOrders(ordersResult.data || []);

    setLoading(false);
  }, [canAccessOrders, canSeeAll, countTable, visibleAgentsKey]);

  useEffect(() => {
    if (!accessLoading) loadStats();
  }, [accessLoading, loadStats]);

  const filteredOrders = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return orders;

    return orders.filter((order) =>
      [
        order.numero_ordine,
        order.ragione_sociale_cliente,
        order.codice_cliente,
        order.codice_agente_mexal,
      ].some((value) => String(value ?? "").toLowerCase().includes(query))
    );
  }, [orders, search]);

  if (accessLoading || loading) {
    return <div className="orders-empty">Caricamento dashboard...</div>;
  }

  return (
    <div className="orders-page">
      <div className="orders-toolbar">
        <button className="orders-primary" type="button" onClick={() => navigate("/ordini/nuovo")}>Nuovo ordine</button>
      </div>
      <div className="orders-kpi-grid">
        <Kpi label="Ordini del mese" value={stats.ordiniMese} />
        <Kpi label="Ordini aperti" value={stats.aperti} />
        <Kpi label="Ordini in corso" value={stats.inCorso} />
        <Kpi label="Ordini evasi" value={stats.evasi} />
      </div>

      <section className="orders-dashboard-list">
        <div className="orders-dashboard-list-header">
          <div className="orders-dashboard-brand">
            <img src="/pwa-512x512.png" alt="Logo aziendale" />
            <div>
              <p>Panoramica operativa</p>
              <h2>Ordini recenti</h2>
            </div>
          </div>
          <div className="orders-search orders-dashboard-search">
            <Search size={18} aria-hidden="true" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Cerca numero, cliente o agente"
              aria-label="Cerca ordini per numero, cliente o agente"
            />
          </div>
        </div>

        <div className="orders-dashboard-table-wrap">
          <table className="orders-table orders-dashboard-table">
            <thead><tr><th>Data</th><th>Ordine</th><th>Cliente</th><th>Agente</th><th>Stato</th><th>Totale</th><th><span className="sr-only">Apri ordine</span></th></tr></thead>
            <tbody>
              {filteredOrders.map((order) => (
                <tr key={order.id} className="orders-clickable-row" onClick={() => navigate(`/ordini/elenco/${order.id}`)}>
                  <td>{formatDate(order.data_ordine)}</td>
                  <td><strong>{order.numero_ordine || "Bozza"}</strong></td>
                  <td>{order.ragione_sociale_cliente || order.codice_cliente || "-"}</td>
                  <td>{order.codice_agente_mexal || "-"}</td>
                  <td><span className={`orders-status ${order.stato}`}>{order.stato || "bozza"}</span></td>
                  <td><strong>{formatCurrency(order.totale_documento ?? order.totale)}</strong></td>
                  <td><ArrowUpRight size={18} aria-hidden="true" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!filteredOrders.length && <p className="orders-dashboard-empty">{search ? "Nessun ordine corrisponde alla ricerca." : "Non ci sono ancora ordini da mostrare."}</p>}
      </section>
    </div>
  );
}

function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("it-IT", { dateStyle: "medium" }).format(new Date(`${value}T00:00:00`));
}

function formatCurrency(value) {
  return Number(value ?? 0).toLocaleString("it-IT", { style: "currency", currency: "EUR" });
}

function Kpi({ label, value }) {
  return (
    <div className="orders-kpi">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
