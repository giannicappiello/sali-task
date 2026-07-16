import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import useOrdersAccess from "./useOrdersAccess";

export default function OrdersDashboard() {
  const { loading: accessLoading, agentCode, isAdmin } = useOrdersAccess();
  const [stats, setStats] = useState({ clienti: 0, ordiniMese: 0, aperti: 0, inCorso: 0, evasi: 0, prodotti: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (accessLoading) return;
    loadStats();
  }, [accessLoading, agentCode, isAdmin]);

  async function countTable(table, filters = []) {
    let query = supabase.from(table).select("*", { count: "exact", head: true });
    filters.forEach(([field, value]) => { query = query.eq(field, value); });
    const { count, error } = await query;
    if (error) return 0;
    return count || 0;
  }

  async function loadStats() {
    setLoading(true);
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);

    const agentFilters = !isAdmin && agentCode ? [["codice_agente_mexal", agentCode]] : [];

    const [clienti, prodotti, ordiniMese, aperti, inCorso, evasi] = await Promise.all([
      countTable("ordini_clienti_cache", agentFilters),
      countTable("ordini_prodotti_cache", [["mostra_in_app", true]]),
      countTable("ordini_testate", [...agentFilters, ["mese_ordine", start.toISOString().slice(0, 7)]]),
      countTable("ordini_testate", [...agentFilters, ["stato", "aperto"]]),
      countTable("ordini_testate", [...agentFilters, ["stato", "in_corso"]]),
      countTable("ordini_testate", [...agentFilters, ["stato", "evaso"]]),
    ]);

    setStats({ clienti, prodotti, ordiniMese, aperti, inCorso, evasi });
    setLoading(false);
  }

  if (accessLoading || loading) return <div className="orders-empty">Caricamento dashboard...</div>;

  return (
    <div className="orders-page">
      <div className="orders-kpi-grid">
        <Kpi label="Clienti assegnati" value={stats.clienti} />
        <Kpi label="Ordini del mese" value={stats.ordiniMese} />
        <Kpi label="Ordini aperti" value={stats.aperti} />
        <Kpi label="Ordini in corso" value={stats.inCorso} />
        <Kpi label="Ordini evasi" value={stats.evasi} />
        <Kpi label="Prodotti visibili" value={stats.prodotti} />
      </div>

      <div className="orders-panel">
        <h3>Collegamento agente</h3>
        <p>{isAdmin ? "Accesso amministratore: tutti gli agenti e tutti i clienti." : `Codice agente Mexal associato: ${agentCode || "non configurato"}`}</p>
      </div>
    </div>
  );
}

function Kpi({ label, value }) {
  return <div className="orders-kpi"><span>{label}</span><strong>{value}</strong></div>;
}
