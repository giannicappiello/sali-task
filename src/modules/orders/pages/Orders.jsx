import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { supabase } from "../../../lib/supabaseClient";
import useOrdersAccess from "./useOrdersAccess";
import { useOrdersModule } from "../ordersModuleContext";
import { agentDisplayName, loadAgentNameMap, sortOrdersNewestFirst } from "../services/agentNames";
import { getOrderDisplayStatus } from "../services/orderDisplayStatus";

export default function Orders() {
  const { moduleCode, basePath } = useOrdersModule();
  const navigate = useNavigate();
  const location = useLocation();
  const { loading: accessLoading, visibleAgents, canSeeAll, canAccessOrders, isBackoffice, isAdmin } = useOrdersAccess();
  const [rows, setRows] = useState([]);
  const [agentsByCode, setAgentsByCode] = useState(new Map());
  const [search, setSearch] = useState("");
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accessLoading) loadOrders();
  }, [accessLoading, canSeeAll, canAccessOrders, month, JSON.stringify(visibleAgents)]);

  async function loadOrders() {
    setLoading(true);
    if (!canAccessOrders) {
      setRows([]);
      setAgentsByCode(new Map());
      setLoading(false);
      return;
    }

    let query = supabase.from("ordini_testate").select("*").or(moduleCode === "prof" ? "modulo_ordini.eq.prof,modulo_ordini.is.null" : "modulo_ordini.eq.ph").eq("mese_ordine", month);
    if (!canSeeAll) {
      if (!visibleAgents?.length) {
        setRows([]);
        setAgentsByCode(new Map());
        setLoading(false);
        return;
      }
      query = query.in("codice_agente_mexal", visibleAgents);
    }

    const { data, error } = await query;
    if (error) console.error("Errore ordini:", error);
    const orderedRows = sortOrdersNewestFirst(data || []);

    let documents = [];
    const orderIds = orderedRows.map((row) => row.id);
    if (orderIds.length) {
      const { data: documentRows, error: documentsError } = await supabase
        .from("ordini_documenti_mexal")
        .select("ordine_id,tipo_documento,serie,numero,anno,stato_operativo,presente_in_mexal")
        .in("ordine_id", orderIds)
        .not("numero", "is", null)
        .eq("presente_in_mexal", true);
      if (documentsError) console.error("Errore documenti Mexal elenco ordini:", documentsError);
      documents = documentRows || [];
    }

    const documentsByOrder = documents.reduce((map, document) => {
      const current = map.get(document.ordine_id) || [];
      current.push(document);
      map.set(document.ordine_id, current);
      return map;
    }, new Map());

    const rowsWithDocuments = orderedRows.map((row) => ({
      ...row,
      documenti_mexal: documentsByOrder.get(row.id) || [],
    }));

    let names = new Map();
    try {
      names = await loadAgentNameMap(rowsWithDocuments.map((row) => row.codice_agente_mexal));
    } catch (agentError) {
      console.warn("Errore caricamento nomi agenti:", agentError);
    }
    setRows(rowsWithDocuments);
    setAgentsByCode(names);
    setLoading(false);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((item) => [...Object.values(item), agentDisplayName(item, agentsByCode)].some((value) => String(value ?? "").toLowerCase().includes(q)));
  }, [rows, search, agentsByCode]);

  const accessLabel = isAdmin || isBackoffice ? "Accesso completo" : `${visibleAgents?.length || 0} agente/i autorizzato/i`;

  return (
    <div className="orders-page">
      <div className="orders-toolbar">
        <div className="orders-search"><Search size={18} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Ricerca rapida ordini..." /></div>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        {canAccessOrders && <button className="orders-primary" type="button" onClick={() => navigate(`${basePath}/nuovo`)}>Nuovo ordine</button>}
      </div>
      {location.state?.message && <div className="orders-alert orders-alert-success">{location.state.message}</div>}
      <div className="orders-panel">
        <p style={{ marginTop: 0 }}><strong>Visibilità:</strong> {accessLabel}</p>
        <div className="orders-table-wrap">
          <table className="orders-table">
            <thead><tr><th>Data</th><th>Numero</th><th>Cliente</th><th>Agente</th><th>Stato</th><th>Imponibile</th><th>IVA</th><th>Totale documento</th><th>OCM</th><th>OCX</th><th>OCI</th></tr></thead>
            <tbody>
              {filtered.map((item) => {
                const status = getOrderDisplayStatus(item);
                return <tr key={item.id} className="orders-clickable-row" onClick={() => navigate(`${basePath}/elenco/${item.id}`)}>
                  <td>{item.data_ordine || "-"}</td><td>{item.numero_ordine_visualizzato || item.numero_ordine || "Bozza"}</td><td>{item.ragione_sociale_cliente || item.codice_cliente}</td><td>{agentDisplayName(item, agentsByCode)}</td>
                  <td><span className={`orders-status ${status.className}`}>{status.label}</span></td>
                  <td>{Number(item.totale_imponibile ?? item.totale ?? 0).toLocaleString("it-IT", { style: "currency", currency: "EUR" })}</td><td>{Number(item.totale_iva || 0).toLocaleString("it-IT", { style: "currency", currency: "EUR" })}</td><td>{Number(item.totale_documento ?? item.totale ?? 0).toLocaleString("it-IT", { style: "currency", currency: "EUR" })}</td>
                  {["OCM", "OCX", "OCI"].map((kind) => { const document = item.documenti_mexal?.find((row) => row.tipo_documento === kind); return <td key={kind}>{document ? `${document.serie || "-"}/${document.numero}` : "-"}</td>; })}
                </tr>;
              })}
            </tbody>
          </table>
        </div>
        {loading && <p>Caricamento ordini...</p>}
        {!loading && filtered.length === 0 && <p>Nessun ordine nel mese selezionato.</p>}
      </div>
    </div>
  );
}
