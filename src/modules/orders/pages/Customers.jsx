import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import { supabase } from "../../../lib/supabaseClient";
import useOrdersAccess from "./useOrdersAccess";

const PAGE_SIZE = 1000;

function normalizeAgentCode(value) {
  return String(value || "").trim().toUpperCase();
}

function getPaymentDescription(item) {
  const data = item?.dati_mexal || item?.json_mexal || {};

  return (
    data?._descrizione_pagamento ||
    data?.descrizione_pagamento ||
    data?.des_pagamento ||
    data?.pagamento_descrizione ||
    item?.codice_pagamento ||
    "-"
  );
}

export default function Customers() {
  const {
    loading: accessLoading,
    visibleAgents,
    canSeeAll,
    canAccessOrders,
    isAdmin,
    isBackoffice,
  } = useOrdersAccess();

  const [rows, setRows] = useState([]);
  const [agentNames, setAgentNames] = useState({});
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);

  useEffect(() => {
    if (!accessLoading) loadCustomers();
  }, [accessLoading, canSeeAll, canAccessOrders, JSON.stringify(visibleAgents)]);

  async function loadAgentNames() {
    const { data: integrations, error: integrationsError } = await supabase
      .from("integrazioni_utenti")
      .select("utente_id,codice_agente_mexal")
      .eq("modulo", "gestione_ordini")
      .not("codice_agente_mexal", "is", null);

    if (integrationsError) {
      console.error("Errore caricamento agenti:", integrationsError);
      return {};
    }

    const userIds = [
      ...new Set((integrations || []).map((row) => row.utente_id).filter(Boolean)),
    ];

    if (!userIds.length) return {};

    const { data: users, error: usersError } = await supabase
      .from("utenti")
      .select("id,nome,cognome")
      .in("id", userIds);

    if (usersError) {
      console.error("Errore caricamento nomi agenti:", usersError);
      return {};
    }

    const usersById = new Map((users || []).map((user) => [user.id, user]));
    const result = {};

    for (const integration of integrations || []) {
      const code = normalizeAgentCode(integration.codice_agente_mexal);
      const user = usersById.get(integration.utente_id);
      const fullName = [user?.cognome, user?.nome].filter(Boolean).join(" ").trim();

      if (code && fullName) result[code] = fullName;
    }

    return result;
  }

  async function loadAllCustomerPages() {
    const allRows = [];
    let from = 0;

    while (true) {
      let query = supabase
        .from("ordini_clienti_cache")
        .select("*")
        .eq("attivo_mexal", true)
        .order("ragione_sociale", { ascending: true })
        .order("codice_cliente", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

      if (!canSeeAll) {
        query = query.in("codice_agente_mexal", visibleAgents);
      }

      const { data, error } = await query;

      if (error) throw error;

      const page = data || [];
      allRows.push(...page);

      if (page.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }

    return allRows;
  }

  async function loadCustomers() {
    setLoading(true);

    try {
      if (!canAccessOrders) {
        setRows([]);
        setAgentNames({});
        return;
      }

      if (!canSeeAll && !visibleAgents?.length) {
        setRows([]);
        setAgentNames({});
        return;
      }

      const [customers, names] = await Promise.all([
        loadAllCustomerPages(),
        loadAgentNames(),
      ]);

      setRows(customers);
      setAgentNames(names);
    } catch (error) {
      console.error("Errore clienti ordini:", error);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  async function syncCustomers() {
    if (syncing || (!isAdmin && !isBackoffice)) return;

    setSyncing(true);
    setSyncResult(null);

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError || !session?.access_token) {
        throw new Error("Sessione scaduta. Effettua nuovamente l'accesso.");
      }

      const response = await fetch("/api/mexal/sync-clients", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ action: "sync" }),
      });

      const text = await response.text();
      let result;

      try {
        result = text ? JSON.parse(text) : {};
      } catch {
        result = { error: text || "Risposta API non valida." };
      }

      if (!response.ok) {
        throw new Error(result.error || `Errore API (${response.status}).`);
      }

      setSyncResult(result);
      await loadCustomers();

      alert(
        `Sincronizzazione clienti completata.\n\n` +
          `Clienti 501 trovati: ${result.letti_mexal || 0}\n` +
          `Inseriti/Aggiornati: ${result.inseriti_o_aggiornati || 0}\n` +
          `Disattivati: ${result.disattivati || 0}\n` +
          `Errori: ${result.errori?.length || 0}`
      );
    } catch (error) {
      alert(error.message || "Errore sincronizzazione clienti Mexal.");
    } finally {
      setSyncing(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;

    return rows.filter((item) => {
      const agentName =
        agentNames[normalizeAgentCode(item.codice_agente_mexal)] || "";
      const paymentDescription = getPaymentDescription(item);

      return [...Object.values(item), agentName, paymentDescription].some((value) =>
        String(value ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, search, agentNames]);

  return (
    <div className="orders-page">
      <div className="orders-toolbar">
        <div className="orders-search">
          <Search size={18} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Cerca cliente per qualsiasi dato..."
          />
        </div>

        {(isAdmin || isBackoffice) && (
          <button
            type="button"
            className="orders-primary"
            onClick={syncCustomers}
            disabled={syncing}
          >
            <RefreshCw size={18} className={syncing ? "spin" : ""} />
            {syncing ? "Sincronizzazione..." : "Sincronizza clienti Mexal"}
          </button>
        )}
      </div>

      {syncResult && (
        <div className="orders-panel orders-sync-summary">
          <strong>Ultima sincronizzazione:</strong>{" "}
          {syncResult.inseriti_o_aggiornati || 0} clienti aggiornati, {" "}
          {syncResult.disattivati || 0} disattivati, {" "}
          {syncResult.errori?.length || 0} errori.
        </div>
      )}

      <div className="orders-panel orders-customers-panel">
        <div className="orders-table-wrap orders-customers-table-wrap">
          <table className="orders-table">
            <thead>
              <tr>
                <th>Codice</th>
                <th>Ragione sociale</th>
                <th>Località</th>
                <th>Provincia</th>
                <th>Pagamento</th>
                <th>Listino</th>
                <th>Agente</th>
              </tr>
            </thead>

            <tbody>
              {!loading &&
                filtered.map((item) => {
                  const agentCode = normalizeAgentCode(item.codice_agente_mexal);

                  return (
                    <tr key={item.codice_cliente}>
                      <td>{item.codice_cliente}</td>
                      <td>{item.ragione_sociale}</td>
                      <td>{item.localita || "-"}</td>
                      <td>{item.provincia || "-"}</td>
                      <td>{getPaymentDescription(item)}</td>
                      <td>{item.codice_listino || "-"}</td>
                      <td>{agentNames[agentCode] || agentCode || "-"}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        {loading && <p>Caricamento clienti...</p>}
        {!loading && filtered.length === 0 && (
          <p>Nessun cliente 501 disponibile per gli agenti autorizzati.</p>
        )}
      </div>
    </div>
  );
}
