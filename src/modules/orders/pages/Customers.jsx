import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../../lib/supabaseClient";
import useOrdersAccess from "./useOrdersAccess";
import { agentDisplayName, loadAgentNameMap } from "../services/agentNames";

const PAGE_SIZE = 1000;

export default function Customers() {
  const navigate = useNavigate();
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

  useEffect(() => {
    if (!accessLoading) loadCustomers();
  }, [accessLoading, canSeeAll, canAccessOrders, JSON.stringify(visibleAgents)]);

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
        setAgentNames(new Map());
        return;
      }

      if (!canSeeAll && !visibleAgents?.length) {
        setRows([]);
        setAgentNames(new Map());
        return;
      }

      const customers = await loadAllCustomerPages();
      const names = await loadAgentNameMap(customers.map((customer) => customer.codice_agente_mexal));

      setRows(customers);
      setAgentNames(names);
    } catch (error) {
      console.error("Errore clienti ordini:", error);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;

    return rows.filter((item) => {
      const agentName = agentDisplayName(item, agentNames);

      return [...Object.values(item), agentName].some((value) =>
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
      </div>

      <div className="orders-panel orders-customers-panel">
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
                filtered.map((item) => (
                  <tr
                    key={item.codice_cliente}
                    className="orders-clickable-row"
                    onClick={() => navigate(`/ordini/clienti/${encodeURIComponent(item.codice_cliente)}`)}
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
        {!loading && filtered.length === 0 && (
          <p>Nessun cliente 501 disponibile per gli agenti autorizzati.</p>
        )}
      </div>
    </div>
  );
}
