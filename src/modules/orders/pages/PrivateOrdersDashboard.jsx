import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, RefreshCw, Search, Sparkles } from "lucide-react";
import { useAuth } from "../../../contexts/AuthContext";
import { useOrdersModule } from "../ordersModuleContext";
import useOrdersAccess from "./useOrdersAccess";
import { OctOrderCard, DetailPanel, DiagnosticActionDialog } from "../../../pages/Production/RdpWorkbench";
import { privateWorkbenchMatchesSearch } from "../services/privateWorkbenchSearch.js";
import "../../../pages/Production/production.css";
import "./private-orders-workbench.css";

async function requestWorkbench(token, action, extra, signal) {
  const response = await fetch("/api/mexal/automation", {
    method: "POST", signal,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...extra }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) throw new Error(payload.error || "Caricamento degli OCT non riuscito.");
  return payload;
}

export default function PrivateOrdersDashboard() {
  const navigate = useNavigate();
  const { basePath } = useOrdersModule();
  const { session, dataScope } = useAuth();
  const { loading: accessLoading, canAccessOrders, canWriteOrders, canUseAIOrderGeneration } = useOrdersAccess("private");
  const token = session?.access_token;
  const scopeKey = JSON.stringify(dataScope || {});
  const [revision, setRevision] = useState(0);
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [diagnostic, setDiagnostic] = useState(null);
  const detailRequest = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    detailRequest.current?.abort();
    async function load() {
    setDetail(null); setDiagnostic(null); setDetailLoading(false);
    setRows([]); setError(""); setWarning("");
    if (accessLoading || !canAccessOrders || !token) { setLoading(accessLoading); return; }
    setLoading(true);
    try {
        const payload = await requestWorkbench(token, "private_workbench_list", {}, controller.signal);
        if (controller.signal.aborted) return;
        setRows(payload.items || []); setWarning(payload.productionWarning || "");
    } catch (failure) { if (!controller.signal.aborted) setError(failure.message); }
    finally { if (!controller.signal.aborted) setLoading(false); }
    }
    load();
    return () => { controller.abort(); detailRequest.current?.abort(); };
  }, [token, scopeKey, accessLoading, canAccessOrders, revision]);

  const visible = useMemo(() => rows.filter((row) => privateWorkbenchMatchesSearch(row, search)), [rows, search]);
  async function openDetail(row) {
    // Local OCT drafts retain their existing edit/send workflow.
    if (row.origin !== "mexal_oct" && !row.requestId) { navigate(`${basePath}/elenco/${row.id}`); return; }
    detailRequest.current?.abort();
    const controller = new AbortController();
    detailRequest.current = controller;
    setDetailLoading(true); setError("");
    try {
      const payload = await requestWorkbench(token, "private_workbench_detail", { orderId: row.id, requestId: row.requestId }, controller.signal);
      if (!controller.signal.aborted) setDetail(payload);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure.message);
    } finally {
      if (!controller.signal.aborted) setDetailLoading(false);
    }
  }
  return <section className="production-page rdp-workbench private-orders-workbench" aria-label="Dashboard OrdiniPrivate">
    <div className="orders-toolbar private-workbench-actions">
      {canWriteOrders && <button type="button" className="orders-primary" onClick={() => navigate(`${basePath}/nuovo`)}><Plus size={17}/>Nuovo OCT</button>}
      {canUseAIOrderGeneration && <button type="button" className="orders-secondary" onClick={() => navigate(`${basePath}/nuovo-da-documento?tipo=standard`)}><Sparkles size={17}/>Genera con AI</button>}
    </div>
    <div className="private-workbench-toolbar">
      <label className="orders-search"><Search size={18} aria-hidden="true"/><input type="search" aria-label="Ricerca rapida totale OCT" placeholder="Cerca OCT, RdP, cliente, prodotto, stato o data…" value={search} onChange={(event) => setSearch(event.target.value)}/></label>
      <button type="button" className="orders-secondary" disabled={loading || accessLoading} onClick={() => setRevision((value) => value + 1)}><RefreshCw size={17}/>Aggiorna</button>
    </div>
    <p className="private-workbench-count" role="status">{loading ? "Caricamento OCT e stati di produzione…" : `${visible.length} OCT${search ? ` su ${rows.length}` : ""} · Tutti gli stati`}</p>
    {error && <div className="orders-error" role="alert">{error}</div>}
    {warning && <div className="private-workbench-warning" role="alert">{warning}</div>}
    {detailLoading && <p role="status">Caricamento dettaglio…</p>}
    <div className="rdp-oct-scroll" tabIndex={0} role="region" aria-label="Elenco unico OCT">
      <div className="rdp-oct-cards">{visible.map((row) => <OctOrderCard key={row.id} row={row} selectable={false} onOpen={() => openDetail(row)} onDiagnostic={setDiagnostic}/>)}</div>
      {!loading && !error && !visible.length && <div className="rdp-empty">{search ? "Nessun OCT corrisponde alla ricerca." : "Nessun OCT disponibile nel tuo ambito autorizzato."}</div>}
    </div>
    {detail && <DetailPanel key={detail.request?.id || detail.orders?.[0]?.id} detail={detail} readOnly onClose={() => setDetail(null)} onDiagnostics={setDiagnostic}/>}
    {diagnostic && <DiagnosticActionDialog diagnostic={diagnostic} canManage={false} onClose={() => setDiagnostic(null)}/>}
  </section>;
}
