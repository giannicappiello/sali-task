import { useEffect, useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { supabase } from "../../../lib/supabaseClient";
import useOrdersAccess from "./useOrdersAccess";

export default function Orders() {
  const {
    loading: accessLoading,
    visibleAgents,
    canSeeAll,
    canAccessOrders,
    isBackoffice,
    isAdmin,
  } = useOrdersAccess();

  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState("");
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [loading, setLoading] = useState(true);
  const [updatingStock, setUpdatingStock] = useState(false);

  useEffect(() => {
    if (!accessLoading) loadOrders();
  }, [
    accessLoading,
    canSeeAll,
    canAccessOrders,
    month,
    JSON.stringify(visibleAgents),
  ]);

  async function callMexalApi(body) {
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError || !session?.access_token) {
      throw new Error("Sessione scaduta. Effettua nuovamente l'accesso.");
    }

    const response = await fetch("/api/mexal/sync-products", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(body),
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

    return result;
  }

  async function openNewOrder() {
    if (updatingStock) return;

    setUpdatingStock(true);

    try {
      let offset = 0;
      const batchSize = 12;
      let totalErrors = 0;

      while (true) {
        const result = await callMexalApi({
          action: "sync-stock-it",
          offset,
          batchSize,
        });

        totalErrors += Number(result.errori?.length || 0);
        offset = Number(result.prossimo_offset || offset + batchSize);

        if (result.completato) break;
      }

      if (totalErrors > 0) {
        console.warn(`Aggiornamento giacenze completato con ${totalErrors} errori.`);
      }

      alert(
        "Giacenze dei prodotti IT aggiornate. La schermata Nuovo Ordine sarà attivata nella fase successiva."
      );
    } catch (error) {
      alert(error.message || "Errore aggiornamento giacenze Mexal.");
    } finally {
      setUpdatingStock(false);
    }
  }

  async function loadOrders() {
    setLoading(true);

    if (!canAccessOrders) {
      setRows([]);
      setLoading(false);
      return;
    }

    let query = supabase
      .from("ordini_testate")
      .select("*")
      .eq("mese_ordine", month)
      .order("data_ordine", { ascending: false });

    if (!canSeeAll) {
      if (!visibleAgents?.length) {
        setRows([]);
        setLoading(false);
        return;
      }

      query = query.in("codice_agente_mexal", visibleAgents);
    }

    const { data, error } = await query;

    if (error) console.error("Errore ordini:", error);
    setRows(data || []);
    setLoading(false);
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

  const canCreateOrder = canAccessOrders;
  const accessLabel =
    isAdmin || isBackoffice
      ? "Accesso completo"
      : `${visibleAgents?.length || 0} agente/i autorizzato/i`;

  return (
    <div className="orders-page">
      <div className="orders-toolbar">
        <div className="orders-search">
          <Search size={18} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Ricerca rapida ordini..."
          />
        </div>

        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        />

        {canCreateOrder && (
          <button
            className="orders-primary"
            type="button"
            onClick={openNewOrder}
            disabled={updatingStock}
          >
            <Plus size={18} />
            {updatingStock ? "Aggiornamento giacenze..." : "Nuovo ordine"}
          </button>
        )}
      </div>

      <div className="orders-panel">
        <p style={{ marginTop: 0 }}>
          <strong>Visibilità:</strong> {accessLabel}
        </p>

        <div className="orders-table-wrap">
          <table className="orders-table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Numero</th>
                <th>Cliente</th>
                <th>Agente</th>
                <th>Stato</th>
                <th>Totale</th>
                <th>OCM</th>
                <th>OCX</th>
              </tr>
            </thead>

            <tbody>
              {filtered.map((item) => (
                <tr key={item.id}>
                  <td>{item.data_ordine || "-"}</td>
                  <td>{item.numero_ordine || "Bozza"}</td>
                  <td>
                    {item.ragione_sociale_cliente || item.codice_cliente}
                  </td>
                  <td>{item.codice_agente_mexal || "-"}</td>
                  <td>
                    <span className={`orders-status ${item.stato}`}>
                      {item.stato}
                    </span>
                  </td>
                  <td>
                    {Number(item.totale || 0).toLocaleString("it-IT", {
                      style: "currency",
                      currency: "EUR",
                    })}
                  </td>
                  <td>{item.numero_ocm || "-"}</td>
                  <td>{item.numero_ocx || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {loading && <p>Caricamento ordini...</p>}
        {!loading && filtered.length === 0 && (
          <p>Nessun ordine nel mese selezionato.</p>
        )}
      </div>
    </div>
  );
}
