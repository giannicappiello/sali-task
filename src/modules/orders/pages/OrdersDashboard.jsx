import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../../lib/supabaseClient";
import useOrdersAccess from "./useOrdersAccess";

export default function OrdersDashboard() {
  const navigate = useNavigate();
  const {
    loading: accessLoading,
    visibleAgents,
    canSeeAll,
    canAccessOrders,
    isAdmin,
    isBackoffice,
    isAreaManager,
    isAgent,
    agentCode,
    managedAgents,
  } = useOrdersAccess();

  const [stats, setStats] = useState({
    clienti: 0,
    ordiniMese: 0,
    aperti: 0,
    inCorso: 0,
    evasi: 0,
    prodotti: 0,
  });

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accessLoading) loadStats();
  }, [
    accessLoading,
    canSeeAll,
    canAccessOrders,
    JSON.stringify(visibleAgents),
  ]);

  async function countTable(table, filters = [], agentField = null) {
    let query = supabase
      .from(table)
      .select("*", { count: "exact", head: true });

    filters.forEach(([field, value]) => {
      query = query.eq(field, value);
    });

    if (agentField && !canSeeAll) {
      if (!visibleAgents?.length) return 0;
      query = query.in(agentField, visibleAgents);
    }

    const { count, error } = await query;

    if (error) {
      console.error(`Errore conteggio ${table}:`, error);
      return 0;
    }

    return count || 0;
  }

  async function loadStats() {
    setLoading(true);

    if (!canAccessOrders) {
      setStats({
        clienti: 0,
        ordiniMese: 0,
        aperti: 0,
        inCorso: 0,
        evasi: 0,
        prodotti: 0,
      });
      setLoading(false);
      return;
    }

    const month = new Date().toISOString().slice(0, 7);

    const [clienti, prodotti, ordiniMese, aperti, inCorso, evasi] =
      await Promise.all([
        countTable(
          "ordini_clienti_cache",
          [],
          "codice_agente_mexal"
        ),
        countTable("prodotti", [["attivo_mexal", true], ["mostra_in_app", true]]),
        countTable(
          "ordini_testate",
          [["mese_ordine", month]],
          "codice_agente_mexal"
        ),
        countTable(
          "ordini_testate",
          [["stato", "aperto"]],
          "codice_agente_mexal"
        ),
        countTable(
          "ordini_testate",
          [["stato", "in_corso"]],
          "codice_agente_mexal"
        ),
        countTable(
          "ordini_testate",
          [["stato", "evaso"]],
          "codice_agente_mexal"
        ),
      ]);

    setStats({
      clienti,
      prodotti,
      ordiniMese,
      aperti,
      inCorso,
      evasi,
    });

    setLoading(false);
  }

  function getAccessDescription() {
    if (isAdmin) {
      return "Accesso amministratore: tutti gli agenti, clienti e ordini.";
    }

    if (isBackoffice) {
      return "Accesso backoffice: visualizzazione e modifica completa del modulo ordini.";
    }

    if (isAreaManager) {
      return `Area Manager: ${managedAgents.length} agenti assegnati (${managedAgents.join(
        ", "
      ) || "nessuno"}).`;
    }

    if (isAgent) {
      return `Codice agente Mexal associato: ${
        agentCode || "non configurato"
      }.`;
    }

    return "Accesso Gestione Ordini non configurato.";
  }

  if (accessLoading || loading) {
    return <div className="orders-empty">Caricamento dashboard...</div>;
  }

  return (
    <div className="orders-page">
      <div className="orders-toolbar">
        <div />
        <button className="orders-primary" type="button" onClick={() => navigate("/ordini/nuovo")}>Nuovo ordine</button>
      </div>
      <div className="orders-kpi-grid">
        <Kpi label="Clienti assegnati" value={stats.clienti} />
        <Kpi label="Ordini del mese" value={stats.ordiniMese} />
        <Kpi label="Ordini aperti" value={stats.aperti} />
        <Kpi label="Ordini in corso" value={stats.inCorso} />
        <Kpi label="Ordini evasi" value={stats.evasi} />
        <Kpi label="Prodotti visibili" value={stats.prodotti} />
      </div>

      <div className="orders-panel">
        <h3>Profilo di accesso</h3>
        <p>{getAccessDescription()}</p>
      </div>
    </div>
  );
}

function Kpi({ label, value }) {
  return (
    <div className="orders-kpi">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
