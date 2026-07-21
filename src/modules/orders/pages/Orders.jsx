import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { supabase } from "../../../lib/supabaseClient";
import useOrdersAccess from "./useOrdersAccess";

function normalize(value) {
  return String(value ?? "").trim();
}

function agentCode(agent) {
  return normalize(
    agent?.codice_agente_mexal ||
    agent?.codice_agente ||
    agent?.codice ||
    agent?.id_agente
  ).toUpperCase();
}

function agentFullName(agent) {
  const fullName = normalize(
    agent?.nome_completo ||
    agent?.nominativo ||
    agent?.descrizione ||
    agent?.ragione_sociale
  );
  if (fullName) return fullName;

  return [agent?.nome, agent?.cognome]
    .map(normalize)
    .filter(Boolean)
    .join(" ");
}

function orderAgentName(order, agentsByCode) {
  const directName = agentFullName(order);
  if (directName) return directName;

  const code = normalize(order?.codice_agente_mexal).toUpperCase();
  return agentsByCode.get(code) || "-";
}

function displayStatus(order) {
  const syncStatus = normalize(order?.stato_sincronizzazione).toLowerCase();
  if (syncStatus === "completato") return { label: "INVIATO", className: "inviato" };
  if (syncStatus === "errore") return { label: "ERRORE", className: "errore" };
  return { label: "BOZZA", className: "bozza" };
}

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
  const [agentsByCode, setAgentsByCode] = useState(new Map());
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

  async function loadAgents() {
    const { data, error } = await supabase
      .from("ordini_agenti_cache")
      .select("*");

    if (error) {
      console.warn("Archivio agenti non disponibile:", error);
      return new Map();
    }

    return new Map(
      (data || [])
        .map((agent) => [agentCode(agent), agentFullName(agent)])
        .filter(([code, name]) => code && name)
    );
  }

  async function loadOrders() {
    setLoading(true);

    if (!canAccessOrders) {
      setRows([]);
      setAgentsByCode(new Map());
      setLoading(false);
      return;
    }

    let query = supabase
      .from("ordini_testate")
      .select("*")
      .eq("mese_ordine", month)
      .order("data_ordine", { ascending: false })
      .order("numero_ordine", { ascending: false });

    if (!canSeeAll) {
      if (!visibleAgents?.length) {
        setRows([]);
        setAgentsByCode(new Map());
        setLoading(false);
        return;
      }

      query = query.in("codice_agente_mexal", visibleAgents);
    }

    const [{ data, error }, loadedAgents] = await Promise.all([
      query,
      loadAgents(),
    ]);

    if (error) console.error("Errore ordini:", error);
    setRows(data || []);
    setAgentsByCode(loadedAgents);
    setLoading(false);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;

    return rows.filter((item) => {
      const agentName = orderAgentName(item, agentsByCode);
      return [...Object.values(item), agentName].some((value) =>
        String(value ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, search, agentsByCode]);

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
          <button className="orders-primary" type="button" onClick={() => navigate("/ordini/nuovo")}>Nuovo ordine</button>
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
                <th>Imponibile</th><th>IVA</th><th>Totale documento</th>
                <th>OCM</th>
                <th>OCX</th>
                <th>OCI</th>
              </tr>
            </thead>

            <tbody>
              {filtered.map((item) => {
                const status = displayStatus(item);
                return (
                  <tr key={item.id} className="orders-clickable-row" onClick={() => navigate(`/ordini/elenco/${item.id}`)}>
                    <td>{item.data_ordine || "-"}</td>
                    <td>{item.numero_ordine_visualizzato || item.numero_ordine || "Bozza"}</td>
                    <td>{item.ragione_sociale_cliente || item.codice_cliente}</td>
                    <td>{orderAgentName(item, agentsByCode)}</td>
                    <td>
                      <span className={`orders-status ${status.className}`}>
                        {status.label}
                      </span>
                    </td>
                    <td>{Number(item.totale_imponibile ?? item.totale ?? 0).toLocaleString("it-IT", { style: "currency", currency: "EUR" })}</td>
                    <td>{Number(item.totale_iva || 0).toLocaleString("it-IT", { style: "currency", currency: "EUR" })}</td>
                    <td>{Number(item.totale_documento ?? item.totale ?? 0).toLocaleString("it-IT", { style: "currency", currency: "EUR" })}</td>
                    <td>{item.numero_ocm || "-"}</td>
                    <td>{item.numero_ocx || "-"}</td>
                    <td>{item.numero_oci || "-"}</td>
                  </tr>
                );
              })}
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
