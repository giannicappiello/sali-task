import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Plus, Search } from "lucide-react";
import { supabase } from "../../../lib/supabaseClient";
import useOrdersAccess from "./useOrdersAccess";

export default function Orders() {
  const navigate = useNavigate();
  const location = useLocation();
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

  useEffect(() => {
    if (!accessLoading) loadOrders();
  }, [
    accessLoading,
    canSeeAll,
    canAccessOrders,
    month,
    JSON.stringify(visibleAgents),
  ]);

  function openNewOrder() {
    navigate("/ordini/nuovo");
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
          >
            <Plus size={18} />
            Nuovo ordine
          </button>
        )}
      </div>

      {location.state?.message && (
        <div className="orders-alert orders-alert-success">{location.state.message}</div>
      )}

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
                <tr key={item.id} className="orders-clickable-row" onClick={() => navigate(`/ordini/elenco/${item.id}`)}>
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
                    <small className={`orders-sync-inline ${item.stato_sincronizzazione || "non_inviato"}`}>
                      {item.stato_sincronizzazione || "non_inviato"}
                    </small>
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
