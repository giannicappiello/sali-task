import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Search, Sparkles } from "lucide-react";
import { supabase } from "../../../lib/supabaseClient";
import useOrdersAccess from "./useOrdersAccess";
import { useOrdersModule } from "../ordersModuleContext";
import { agentDisplayName, customerDisplayName, loadAgentNameMap, loadCustomerDirectory, sortOrdersNewestFirst } from "../services/agentNames";
import { getOrderDisplayStatus } from "../services/orderDisplayStatus";
import AIOrderTypeDialog from "../components/AIOrderTypeDialog";
import { filterOrderModuleRows, isPrivateOrderModule, orderModuleDocumentTypes, orderModuleFilter } from "../services/orderModules";

export default function Orders() {
  const { moduleCode, basePath } = useOrdersModule();
  const navigate = useNavigate();
  const location = useLocation();
  const { loading: accessLoading, visibleAgents, canSeeAll, canAccessOrders, canWriteOrders, isBackoffice, isAdmin } = useOrdersAccess(moduleCode);
  const [rows, setRows] = useState([]);
  const [agentsByCode, setAgentsByCode] = useState(new Map());
  const [customersByCode, setCustomersByCode] = useState(new Map());
  const [agentsByCustomer, setAgentsByCustomer] = useState(new Map());
  const [search, setSearch] = useState("");
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [loading, setLoading] = useState(true);
  const [aiTypeDialogOpen, setAITypeDialogOpen] = useState(false);

  function openAIOrderImport(type) {
    setAITypeDialogOpen(false);
    navigate(`${basePath}/nuovo-da-documento?tipo=${type}`);
  }

  const loadOrders = useCallback(async () => {
    setLoading(true);
    if (!canAccessOrders) {
      setRows([]);
      setAgentsByCode(new Map());
      setLoading(false);
      return;
    }

    let query = supabase.from("ordini_testate").select("*").or(orderModuleFilter(moduleCode)).eq("mese_ordine", month);
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
    const orderedRows = sortOrdersNewestFirst(filterOrderModuleRows(moduleCode, data || []));

    let documents = [];
    const orderIds = orderedRows.map((row) => row.id);
    if (orderIds.length) {
      const { data: documentRows, error: documentsError } = await supabase
        .from("ordini_documenti_mexal")
        .select("ordine_id,tipo_documento,serie,numero,anno,stato_operativo,presente_in_mexal")
        .in("ordine_id", orderIds)
        .in("tipo_documento", orderModuleDocumentTypes(moduleCode))
        .not("numero", "is", null);
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
    let customerDirectory = { namesByCode: new Map(), agentsByCustomer: new Map() };
    try {
      customerDirectory = await loadCustomerDirectory(rowsWithDocuments.map((row) => row.codice_cliente));
      const agentCodes = rowsWithDocuments.map((row) => row.codice_agente_mexal || customerDirectory.agentsByCustomer.get(String(row.codice_cliente || "").trim().toUpperCase()));
      names = await loadAgentNameMap(agentCodes);
    } catch (agentError) {
      console.warn("Errore caricamento anagrafiche cliente/agente:", agentError);
    }
    setRows(rowsWithDocuments);
    setAgentsByCode(names);
    setCustomersByCode(customerDirectory.namesByCode);
    setAgentsByCustomer(customerDirectory.agentsByCustomer);
    setLoading(false);
  }, [canAccessOrders, canSeeAll, moduleCode, month, visibleAgents]);

  useEffect(() => {
    if (accessLoading) return undefined;
    const timer = window.setTimeout(loadOrders, 0);
    return () => window.clearTimeout(timer);
  }, [accessLoading, loadOrders]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((item) => [
      ...Object.values(item),
      customerDisplayName(item, customersByCode),
      agentDisplayName(item, agentsByCode, agentsByCustomer),
      ...(item.documenti_mexal || []).flatMap((document) => [
        document.tipo_documento,
        document.serie,
        document.numero,
        document.stato_operativo,
      ]),
    ].some((value) => String(value ?? "").toLowerCase().includes(q)));
  }, [rows, search, agentsByCode, agentsByCustomer, customersByCode]);

  const accessLabel = isAdmin || isBackoffice ? "Accesso completo" : `${visibleAgents?.length || 0} agente/i autorizzato/i`;

  return (
    <div className="orders-page">
      <div className="orders-toolbar">
        <div className="orders-search"><Search size={18} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Ricerca rapida ordini..." /></div>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        {canWriteOrders && <><button className="orders-primary" type="button" onClick={() => navigate(`${basePath}/nuovo`)}>{isPrivateOrderModule(moduleCode) ? "Nuovo OCT" : "Nuovo ordine"}</button>{!isPrivateOrderModule(moduleCode) && <button className="orders-secondary" type="button" onClick={() => navigate(`${basePath}/nuovo?tipo=prenotazione`)}>Ordine prenotazione</button>}</>}
        <button className="orders-secondary" type="button" onClick={() => isPrivateOrderModule(moduleCode) ? openAIOrderImport("standard") : setAITypeDialogOpen(true)}><Sparkles size={17} /> Genera con AI</button>
      </div>
      {location.state?.message && <div className="orders-alert orders-alert-success">{location.state.message}</div>}
      <div className="orders-panel">
        <p style={{ marginTop: 0 }}><strong>Visibilità:</strong> {accessLabel}</p>
        <div className="orders-table-wrap">
          <table className="orders-table">
            <thead><tr><th>Tipo</th><th>Data</th><th>Numero</th><th>Rif. padre</th><th>Cliente</th><th>Agente</th><th>Stato</th><th>Imponibile</th><th>IVA</th><th>Totale documento</th></tr></thead>
            <tbody>
              {filtered.map((item) => {
                const status = getOrderDisplayStatus(item);
                const parentReference = item.numero_ordine_visualizzato || item.numero_ordine || "Bozza";
                return [
                  <tr key={item.id} className="orders-clickable-row" onClick={() => navigate(`${basePath}/elenco/${item.id}`)}>
                    <td>PADRE</td><td>{item.data_ordine || "-"}</td><td>{parentReference}</td><td>-</td><td>{customerDisplayName(item, customersByCode)}</td><td>{agentDisplayName(item, agentsByCode, agentsByCustomer)}</td>
                    <td><span className={`orders-status ${status.className}`}>{status.label}</span></td>
                    <td>{Number(item.totale_imponibile ?? item.totale ?? 0).toLocaleString("it-IT", { style: "currency", currency: "EUR" })}</td><td>{Number(item.totale_iva || 0).toLocaleString("it-IT", { style: "currency", currency: "EUR" })}</td><td>{Number(item.totale_documento ?? item.totale ?? 0).toLocaleString("it-IT", { style: "currency", currency: "EUR" })}</td>
                  </tr>,
                  ...(item.documenti_mexal || []).map((document) => {
                    const documentStatus = String(document.stato_operativo || "APERTO").toUpperCase();
                    const documentStatusClass = documentStatus === "EVASO" ? "evaso" : documentStatus === "APERTO" ? "inviato-mexal" : "errore";
                    return <tr key={`${item.id}-${document.tipo_documento}-${document.serie}-${document.numero}`} className="orders-clickable-row orders-child-order-row" onClick={() => navigate(`${basePath}/elenco/${item.id}`)}>
                      <td>{document.tipo_documento}</td><td>{item.data_ordine || "-"}</td><td>{`${document.serie || "-"}/${document.numero}`}</td><td>{parentReference}</td><td colSpan={2}>Documento figlio Mexal</td>
                      <td><span className={`orders-status ${documentStatusClass}`}>{documentStatus}</span></td><td>-</td><td>-</td><td>-</td>
                    </tr>;
                  }),
                ];
              })}
            </tbody>
          </table>
        </div>
        {loading && <p>Caricamento ordini...</p>}
        {!loading && filtered.length === 0 && <p>Nessun ordine nel mese selezionato.</p>}
      </div>
      <AIOrderTypeDialog open={aiTypeDialogOpen} onClose={() => setAITypeDialogOpen(false)} onSelect={openAIOrderImport} />
    </div>
  );
}
