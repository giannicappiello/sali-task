import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { supabase } from "../../../lib/supabaseClient";
import useOrdersAccess from "./useOrdersAccess";

export default function Customers() {
  const { loading: accessLoading, agentCode, isAdmin } = useOrdersAccess();
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accessLoading) loadCustomers();
  }, [accessLoading, agentCode, isAdmin]);

  async function loadCustomers() {
    setLoading(true);
    let query = supabase.from("ordini_clienti_cache").select("*").order("ragione_sociale").limit(5000);
    if (!isAdmin && agentCode) query = query.eq("codice_agente_mexal", agentCode);
    const { data, error } = await query;
    if (error) console.error("Errore clienti ordini:", error);
    setRows(data || []);
    setLoading(false);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((item) => Object.values(item).some((value) => String(value ?? "").toLowerCase().includes(q)));
  }, [rows, search]);

  return (
    <div className="orders-page">
      <div className="orders-toolbar">
        <div className="orders-search"><Search size={18} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cerca cliente per qualsiasi dato..." /></div>
      </div>

      <div className="orders-panel">
        <div className="orders-table-wrap">
          <table className="orders-table">
            <thead><tr><th>Codice</th><th>Ragione sociale</th><th>Località</th><th>Provincia</th><th>Pagamento</th><th>Listino</th><th>Agente</th></tr></thead>
            <tbody>
              {!loading && filtered.map((item) => (
                <tr key={item.codice_cliente}>
                  <td>{item.codice_cliente}</td><td>{item.ragione_sociale}</td><td>{item.localita}</td><td>{item.provincia}</td><td>{item.codice_pagamento || "-"}</td><td>{item.codice_listino || "-"}</td><td>{item.codice_agente_mexal || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {loading && <p>Caricamento clienti...</p>}
        {!loading && filtered.length === 0 && <p>Nessun cliente sincronizzato.</p>}
      </div>
    </div>
  );
}
