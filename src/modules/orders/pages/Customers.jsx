import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../../lib/supabaseClient";
import useOrdersAccess from "./useOrdersAccess";
import { agentDisplayName, loadAgentNameMap } from "../services/agentNames";

const RESULT_LIMIT = 100;
const SEARCH_DELAY_MS = 300;

function normalizeSearch(value) {
  return String(value ?? "")
    .trim()
    .replace(/[,%()]/g, " ")
    .replace(/\s+/g, " ");
}

export default function Customers() {
  const navigate = useNavigate();
  const requestIdRef = useRef(0);
  const {
    loading: accessLoading,
    visibleAgents,
    canSeeAll,
    canAccessOrders,
  } = useOrdersAccess();

  const [rows, setRows] = useState([]);
  const [agentNames, setAgentNames] = useState(new Map());
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (accessLoading) return undefined;

    const timer = window.setTimeout(() => {
      loadCustomers(search);
    }, search.trim() ? SEARCH_DELAY_MS : 0);

    return () => window.clearTimeout(timer);
  }, [
    accessLoading,
    canSeeAll,
    canAccessOrders,
    search,
    JSON.stringify(visibleAgents),
  ]);

  async function loadCustomers(searchValue) {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError("");

    try {
      if (!canAccessOrders) {
        setRows([]);
        setAgentNames(new Map());
        return;
      }

      if (!canSeeAll && !visibleAgents?.length) {
        setRows([]);
        setAgentNames(new Map());
        return;
      }

      const searchTerm = normalizeSearch(searchValue);
      let query = supabase
        .from("ordini_clienti_cache")
        .select(
          "codice_cliente,ragione_sociale,localita,provincia,partita_iva,codice_agente_mexal"
        )
        .eq("attivo_mexal", true)
        .order("ragione_sociale", { ascending: true })
        .order("codice_cliente", { ascending: true })
        .limit(RESULT_LIMIT);

      if (!canSeeAll) {
        query = query.in("codice_agente_mexal", visibleAgents);
      }

      if (searchTerm) {
        const pattern = `%${searchTerm}%`;
        query = query.or(
          [
            `codice_cliente.ilike.${pattern}`,
            `ragione_sociale.ilike.${pattern}`,
            `localita.ilike.${pattern}`,
            `provincia.ilike.${pattern}`,
            `partita_iva.ilike.${pattern}`,
          ].join(",")
        );
      }

      const { data, error: customersError } = await query;
      if (customersError) throw customersError;
      if (requestId !== requestIdRef.current) return;

      const customers = data || [];
      const names = await loadAgentNameMap(
        customers.map((customer) => customer.codice_agente_mexal)
      );

      if (requestId !== requestIdRef.current) return;
      setRows(customers);
      setAgentNames(names);
    } catch (loadError) {
      if (requestId !== requestIdRef.current) return;
      console.error("Errore clienti ordini:", loadError);
      setRows([]);
      setAgentNames(new Map());
      setError(loadError.message || "Errore durante il caricamento dei clienti.");
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }

  return (
    <div className="orders-page">
      <div className="orders-toolbar">
        <div className="orders-search">
          <Search size={18} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Cerca per codice, ragione sociale, località, provincia o P. IVA..."
          />
        </div>
      </div>

      <div className="orders-panel orders-customers-panel">
        {error && <div className="orders-alert orders-alert-error">{error}</div>}

        <div className="orders-table-wrap orders-customers-table-wrap">
          <table className="orders-table">
            <thead>
              <tr>
                <th>Ragione sociale</th>
                <th>Località</th>
                <th>Provincia</th>
                <th>Agente</th>
              </tr>
            </thead>

            <tbody>
              {!loading &&
                rows.map((item) => (
                  <tr
                    key={item.codice_cliente}
                    className="orders-clickable-row"
                    onClick={() =>
                      navigate(
                        `/ordini/clienti/${encodeURIComponent(item.codice_cliente)}`
                      )
                    }
                  >
                    <td>{item.ragione_sociale}</td>
                    <td>{item.localita || "-"}</td>
                    <td>{item.provincia || "-"}</td>
                    <td>{agentDisplayName(item, agentNames)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {loading && <p>Caricamento clienti...</p>}
        {!loading && rows.length === 0 && (
          <p>Nessun cliente disponibile per i criteri indicati.</p>
        )}
        {!loading && rows.length === RESULT_LIMIT && (
          <p>Visualizzati i primi {RESULT_LIMIT} risultati. Usa la ricerca per restringere l’elenco.</p>
        )}
      </div>
    </div>
  );
}
