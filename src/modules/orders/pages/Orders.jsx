import { useEffect, useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { supabase } from "../../../lib/supabaseClient";
import useOrdersAccess from "./useOrdersAccess";

export default function Orders() {
  const { loading: accessLoading, agentCode, isAdmin } = useOrdersAccess();
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState("");
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [loading, setLoading] = useState(true);

  useEffect(() => { if (!accessLoading) loadOrders(); }, [accessLoading, agentCode, isAdmin, month]);

  async function loadOrders() {
    setLoading(true);
    let query = supabase.from("ordini_testate").select("*").eq("mese_ordine", month).order("data_ordine", { ascending: false });
    if (!isAdmin && agentCode) query = query.eq("codice_agente_mexal", agentCode);
    const { data, error } = await query;
    if (error) console.error("Errore ordini:", error);
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
        <div className="orders-search"><Search size={18} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Ricerca rapida ordini..." /></div>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        <button className="orders-primary" type="button" onClick={() => alert("La schermata Nuovo Ordine sarà attivata nella fase successiva, dopo la sincronizzazione Mexal.")}><Plus size={18} />Nuovo ordine</button>
      </div>

      <div className="orders-panel">
        <div className="orders-table-wrap">
          <table className="orders-table">
            <thead><tr><th>Data</th><th>Numero</th><th>Cliente</th><th>Agente</th><th>Stato</th><th>Totale</th><th>OCM</th><th>OCX</th></tr></thead>
            <tbody>{filtered.map((item) => <tr key={item.id}><td>{item.data_ordine || "-"}</td><td>{item.numero_ordine || "Bozza"}</td><td>{item.ragione_sociale_cliente || item.codice_cliente}</td><td>{item.codice_agente_mexal}</td><td><span className={`orders-status ${item.stato}`}>{item.stato}</span></td><td>{Number(item.totale || 0).toLocaleString("it-IT", { style: "currency", currency: "EUR" })}</td><td>{item.numero_ocm || "-"}</td><td>{item.numero_ocx || "-"}</td></tr>)}</tbody>
          </table>
        </div>
        {loading && <p>Caricamento ordini...</p>}
        {!loading && filtered.length === 0 && <p>Nessun ordine nel mese selezionato.</p>}
      </div>
    </div>
  );
}
