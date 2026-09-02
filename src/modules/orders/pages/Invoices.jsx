import { useCallback, useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../../lib/supabaseClient";
import { useOrdersModule } from "../ordersModuleContext";
import useOrdersAccess from "./useOrdersAccess";

function money(value) {
  return Number(value || 0).toLocaleString("it-IT", { style: "currency", currency: "EUR" });
}

function formatDate(value) {
  if (!value) return "-";
  const [year, month, day] = String(value).slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

export default function Invoices() {
  const navigate = useNavigate();
  const { basePath, moduleCode } = useOrdersModule();
  const { loading: accessLoading, canAccessOrders, canSeeAll, visibleAgents, customerCode } = useOrdersAccess(moduleCode);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [search, setSearch] = useState("");
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadInvoices = useCallback(async () => {
    setLoading(true);
    setError("");
    if (!canAccessOrders || (!customerCode && !canSeeAll && !visibleAgents?.length)) {
      setInvoices([]);
      setLoading(false);
      return;
    }
    const start = `${month}-01`;
    const end = new Date(`${month}-01T00:00:00`);
    end.setMonth(end.getMonth() + 1);
    let query = supabase
      .from("mexal_fatture_vendita")
      .select("id,sigla,cod_modulo,serie,numero,data_documento,codice_cliente,ragione_sociale_cliente,codice_agente_mexal,agente_nome,causale_magazzino_codice,causale_magazzino_descrizione,totale_imponibile,totale_iva,totale_documento")
      .gte("data_documento", start)
      .lt("data_documento", end.toISOString().slice(0, 10))
      .order("data_documento", { ascending: false })
      .order("numero", { ascending: false });
    if (customerCode) query = query.eq("codice_cliente", customerCode);
    else if (!canSeeAll) query = query.in("codice_agente_mexal", visibleAgents);
    const { data, error: queryError } = await query;
    if (queryError) setError(queryError.message);
    setInvoices(data || []);
    setLoading(false);
  }, [canAccessOrders, canSeeAll, customerCode, month, visibleAgents]);

  useEffect(() => {
    if (accessLoading) return undefined;
    const timer = window.setTimeout(() => void loadInvoices(), 0);
    return () => window.clearTimeout(timer);
  }, [accessLoading, loadInvoices]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return invoices;
    return invoices.filter((invoice) => Object.values(invoice).some(
      (value) => String(value ?? "").toLowerCase().includes(needle),
    ));
  }, [invoices, search]);

  return <div className="orders-page">
    <div className="orders-toolbar">
      <div className="orders-search"><Search size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Ricerca rapida fatture..." /></div>
      <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
    </div>
    <div className="orders-panel">
      <div className="orders-section-heading">
        <div><h2>Fatture di vendita</h2><p>Tutte le varianti FT e i documenti OCX/COX importati da Mexal. Consultazione in sola lettura.</p></div>
      </div>
      {error && <div className="orders-alert orders-alert-error">{error}</div>}
      <div className="orders-table-wrap">
        <table className="orders-table">
          <thead><tr><th>Data</th><th>Documento</th><th>Cliente</th><th>Agente</th><th>Imponibile</th><th>IVA</th><th>Totale</th></tr></thead>
          <tbody>{filtered.map((invoice) => <tr key={invoice.id} className="orders-clickable-row" onClick={() => navigate(`${basePath}/fatture/${invoice.id}`)}>
            <td>{formatDate(invoice.data_documento)}</td>
            <td><strong>{`${invoice.sigla}${invoice.cod_modulo || "E"} ${invoice.serie}/${invoice.numero}`}</strong></td>
            <td>{invoice.ragione_sociale_cliente || invoice.codice_cliente}<br /><small>{invoice.codice_cliente}</small></td>
            <td>{invoice.agente_nome || invoice.codice_agente_mexal || "-"}</td>
            <td>{money(invoice.totale_imponibile)}</td><td>{money(invoice.totale_iva)}</td><td><strong>{money(invoice.totale_documento)}</strong></td>
          </tr>)}</tbody>
        </table>
      </div>
      {loading && <p>Caricamento fatture...</p>}
      {!loading && !filtered.length && <p>Nessun documento FT o OCX/COX visibile nel mese selezionato.</p>}
    </div>
  </div>;
}
