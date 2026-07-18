import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import { supabase } from "../../../lib/supabaseClient";
import useOrdersAccess from "./useOrdersAccess";

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
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);

  useEffect(() => {
    if (!accessLoading) loadCustomers();
  }, [accessLoading, canSeeAll, canAccessOrders, JSON.stringify(visibleAgents)]);

  async function loadCustomers() {
    setLoading(true);

    if (!canAccessOrders) {
      setRows([]);
      setLoading(false);
      return;
    }

    let query = supabase
      .from("ordini_clienti_cache")
      .select("*")
      .eq("attivo_mexal", true)
      .order("ragione_sociale")
      .limit(10000);

    if (!canSeeAll) {
      if (!visibleAgents?.length) {
        setRows([]);
        setLoading(false);
        return;
      }
      query = query.in("codice_agente_mexal", visibleAgents);
    }

    const { data, error } = await query;
    if (error) console.error("Errore clienti ordini:", error);
    setRows(data || []);
    setLoading(false);
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

    return rows.filter((item) =>
      Object.values(item).some((value) =>
        String(value ?? "").toLowerCase().includes(q)
      )
    );
  }, [rows, search]);

  return (
    <div className="orders-page">
      <div className="orders-toolbar">
        <div className="orders-search">
          <Search size={18} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
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
          {syncResult.errori?.length || 0} errori.
        </div>
      )}

      <div className="orders-panel">
        <div className="orders-table-wrap">
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
                filtered.map((item) => (
                  <tr key={item.codice_cliente}>
                    <td>{item.codice_cliente}</td>
                    <td>{item.ragione_sociale}</td>
                    <td>{item.localita || "-"}</td>
                    <td>{item.provincia || "-"}</td>
                    <td>{item.codice_pagamento || "-"}</td>
                    <td>{item.codice_listino || "-"}</td>
                    <td>{item.codice_agente_mexal || "-"}</td>
                  </tr>
                ))}
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
