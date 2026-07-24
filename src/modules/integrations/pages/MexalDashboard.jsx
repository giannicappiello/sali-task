import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  Boxes,
  Building2,
  Clock3,
  Database,
  PackageSearch,
  RefreshCw,
  ScrollText,
  ShoppingCart,
  Users,
  Warehouse,
} from "lucide-react";
import { useAuth } from "../../../contexts/AuthContext";
import MexalHistory from "../components/MexalHistory";
import MexalProgress from "../components/MexalProgress";
import MexalSettings from "../components/MexalSettings";
import MexalAutomations from "../components/MexalAutomations";
import MexalSyncCard from "../components/MexalSyncCard";
import IntegrationStatusBadge from "../components/IntegrationStatusBadge";
import OrdersDocumentSeriesSettings from "../../../components/OrdersDocumentSeriesSettings";
import OrderModuleSettings from "../components/OrderModuleSettings";
import { createMexalManualRunRefresh, getMexalRunId } from "../services/mexalManualRunRefresh";
import {
  invokeCommercialConditionsSync,
  loadCommercialCounts,
  invokeClientsSync,
  invokeProductsSync,
  invokeStocksSync,
  loadMexalEntityCounts,
  loadMexalRuns,
  loadSyncRuns,
  startMexalSync,
  stopMexalRun,
} from "../services/mexalSyncService";

const syncLabels = {
  clients: "Clienti",
  products: "Prodotti",
  stocks: "Giacenze",
  commercial_conditions: "Condizioni commerciali",
  document_series: "Serie documenti",
  list_price_commissions: "Provvigioni listini",
  agents: "Agenti",
};

function formatDate(value) {
  if (!value) return "Mai";
  return new Date(value).toLocaleString("it-IT", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function MexalDashboard() {
  const navigate = useNavigate();
  const { profile, isAdminUser } = useAuth();
  const [runs, setRuns] = useState([]);
  const [counts, setCounts] = useState({ matrix: null, particularities: null, payments: null });
  const [selectedRun, setSelectedRun] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState(null);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState("");
  const [settings, setSettings] = useState({ mode: "full", dryRun: false, syncPayments: true });
  const [entityCounts, setEntityCounts] = useState({ products: null, clients: null, stocks: null, orders: null, agents: null });
  const [entityRuns, setEntityRuns] = useState({ products: null, clients: null, stocks: null, orders: null, agents: null });
  const [activeSync, setActiveSync] = useState(null);
  const [activeTab, setActiveTab] = useState("syncs");
  const [configurationTab, setConfigurationTab] = useState("settings");
  const [stoppingRunId, setStoppingRunId] = useState(null);
  const [manualAction, setManualAction] = useState(null);
  const historyRef = useRef(null);
  const manualCancelledRef = useRef(false);
  const manualRefreshRef = useRef(null);
  const mountedRef = useRef(true);

  const latestRun = runs[0] || null;

  const refreshData = useCallback(async (preferredRunId = null) => {
    const [runRows, countRows, entityCountRows, productRuns, clientRuns, agentRuns, stockRuns, orderRuns] = await Promise.all([
      loadSyncRuns(25),
      loadCommercialCounts(),
      loadMexalEntityCounts(),
      loadMexalRuns("products"),
      loadMexalRuns("clients"),
      loadMexalRuns("agents"),
      loadMexalRuns("stocks"),
      loadMexalRuns("orders"),
    ]);
    if (!mountedRef.current) return;
    setRuns(runRows);
    setCounts(countRows);
    setEntityCounts(entityCountRows);
    setEntityRuns({
      products: productRuns[0] || null,
      clients: clientRuns[0] || null,
      agents: agentRuns[0] || null,
      stocks: stockRuns[0] || null,
      orders: orderRuns[0] || null,
    });
    const nextSelected = preferredRunId
      ? runRows.find((run) => Number(run.id) === Number(preferredRunId))
      : runRows[0];
    setSelectedRun(nextSelected || null);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        await refreshData();
      } catch (error) {
        if (active) setMessage({ type: "error", text: error.message || "Impossibile caricare i dati Mexal" });
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      mountedRef.current = false;
      manualRefreshRef.current?.stop();
    };
  }, [refreshData]);

  async function runCommercialSync() {
    if (!isAdminUser) return;
    if (!settings.dryRun && !window.confirm("Avviare la sincronizzazione reale delle condizioni commerciali?")) return;
    setRunning(true);
    setMessage(null);
    setProgress(10);
    setPhase("Connessione alla WebAPI Mexal");
    try {
      const result = await invokeCommercialConditionsSync(settings);
      setProgress(100);
      setPhase("Sincronizzazione completata");
      setMessage({ type: "success", text: "Condizioni commerciali sincronizzate." });
      await refreshData(result.runId);
    } catch (error) {
      setMessage({ type: "error", text: error.message || "Errore durante la sincronizzazione Mexal" });
      await refreshData();
    } finally {
      window.setTimeout(() => {
        setRunning(false);
        setProgress(0);
        setPhase("");
      }, 500);
    }
  }

  async function runEntitySync(type) {
    if (!isAdminUser || activeSync) return;
    setActiveSync(type);
    setMessage({ type: "info", text: `Sincronizzazione ${syncLabels[type] || type} avviata...` });
    try {
      if (type === "products") await invokeProductsSync();
      else if (type === "stocks") await invokeStocksSync();
      else if (type === "clients") await invokeClientsSync();
      else await startMexalSync(type);
      setMessage({ type: "success", text: `Sincronizzazione ${syncLabels[type] || type} completata.` });
      await refreshData();
    } catch (error) {
      setMessage({ type: "error", text: error.message || "Sincronizzazione Mexal interrotta." });
      await refreshData();
    } finally {
      setActiveSync(null);
    }
  }

  async function stopRun(run) {
    if (!isAdminUser || stoppingRunId || run?.status !== "running") return;
    if (!window.confirm(`Arrestare la sincronizzazione ${syncLabels[run.sync_type] || "selezionata"}?`)) return;
    setStoppingRunId(run.id);
    manualCancelledRef.current = true;
    manualRefreshRef.current?.stop();
    try {
      await stopMexalRun(run.id);
      setMessage({ type: "success", text: "Sincronizzazione arrestata." });
      await refreshData(run.id);
    } catch (error) {
      setMessage({ type: "error", text: error.message || "Impossibile arrestare la sincronizzazione." });
    } finally {
      setStoppingRunId(null);
    }
  }

  async function runManualPhase(syncType, phaseIndex, phaseCount) {
    const label = syncLabels[syncType];
    setPhase(label);
    setMessage({ type: "info", text: `Avvio ${label}…` });
    const updateBatchProgress = ({ processed, total, syncRunId }) => {
      if (manualCancelledRef.current) return;
      const completed = total > 0 ? Math.min(processed / total, 1) : 0;
      setProgress(Math.round(((phaseIndex + completed) / phaseCount) * 100));
      setPhase(`${label}: ${processed}/${total || "?"} elaborati`);
      if (syncRunId) manualRefreshRef.current?.refreshNow(syncRunId);
    };
    const result = syncType === "products"
      ? await invokeProductsSync(updateBatchProgress, () => manualCancelledRef.current)
      : syncType === "stocks"
        ? await invokeStocksSync(updateBatchProgress, () => manualCancelledRef.current)
        : await startMexalSync(syncType);
    if (manualCancelledRef.current) throw Object.assign(new Error("Sincronizzazione annullata."), { cancelled: true });
    setProgress(Math.round(((phaseIndex + 1) / phaseCount) * 100));
    await manualRefreshRef.current?.refreshNow(getMexalRunId(result));
    return result;
  }

  async function startManualSync(syncType = null) {
    if (!isAdminUser || manualAction) return;
    const actionKey = syncType || "all";
    const phases = syncType
      ? [syncType]
      : ["clients", "agents", "commercial_conditions", "document_series", "products", "stocks", "list_price_commissions"];
    manualCancelledRef.current = false;
    setManualAction(actionKey);
    setProgress(0);
    manualRefreshRef.current?.stop();
    manualRefreshRef.current = createMexalManualRunRefresh({ refresh: refreshData });
    manualRefreshRef.current.start();
    try {
      for (const [phaseIndex, phaseType] of phases.entries()) {
        await runManualPhase(phaseType, phaseIndex, phases.length);
      }
      setMessage({ type: "success", text: "Sincronizzazione completata." });
    } catch (error) {
      setMessage({
        type: error.cancelled ? "warning" : "error",
        text: error.cancelled ? "Sincronizzazione annullata." : (error.message || "Errore di rete durante la sincronizzazione."),
      });
    } finally {
      manualRefreshRef.current?.stop();
      manualRefreshRef.current = null;
      setManualAction(null);
      window.setTimeout(() => {
        setProgress(0);
        setPhase("");
      }, 500);
    }
  }

  function openHistory(run = null) {
    if (run) setSelectedRun(run);
    window.requestAnimationFrame(() => historyRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  const commercialCount = useMemo(() => {
    const values = [counts.matrix, counts.particularities, counts.payments];
    if (values.some((value) => value == null)) return null;
    return values.reduce((sum, value) => sum + value, 0);
  }, [counts]);

  const cards = [
    { icon: Users, title: "Clienti", description: "Anagrafiche, categorie commerciali e condizioni cliente.", recordLabel: "clienti attivi", recordCount: entityCounts.clients, enabled: true, type: "clients", lastRunData: entityRuns.clients },
    { icon: Building2, title: "Agenti", description: "Agenti attivi da fornitori Mexal (prefisso 602).", recordLabel: "agenti attivi", recordCount: entityCounts.agents, enabled: true, type: "agents", lastRunData: entityRuns.agents },
    { icon: PackageSearch, title: "Prodotti", description: "Catalogo, categorie, immagini e schede tecniche.", recordLabel: "prodotti visibili", recordCount: entityCounts.products, enabled: true, type: "products", lastRunData: entityRuns.products },
    { icon: ScrollText, title: "Condizioni commerciali", description: "Matrice sconti, particolarità e regole pagamento.", recordLabel: "regole attive", recordCount: commercialCount, enabled: true, type: "commercial_conditions" },
    { icon: Warehouse, title: "Giacenze", description: "Disponibilità per magazzino e controllo evasione ordini.", recordLabel: "prodotti sincronizzati", recordCount: entityCounts.stocks, enabled: true, type: "stocks", lastRunData: entityRuns.stocks },
    { icon: ShoppingCart, title: "Ordini", description: "Invio OCM/OCX, PDF e stato sincronizzazione documenti.", recordLabel: "ordini da inviare", recordCount: entityCounts.orders, enabled: true, type: "orders", lastRunData: entityRuns.orders },
  ];

  const runningRuns = runs.filter((item) => item.status === "running").length;
  const failedRuns = runs.filter((item) => ["failed", "timeout", "completed_with_errors"].includes(item.status)).length;

  if (loading) return <div className="integrations-loading"><RefreshCw className="spin" size={24} /> Caricamento Centro Mexal...</div>;

  return (
    <div className="mexal-page">
      <button type="button" className="integrations-back-button" onClick={() => navigate("/integrations")}><ArrowLeft size={18} /> Centro Integrazioni</button>

      <section className="mexal-hero">
        <div className="mexal-hero-main">
          <div className="mexal-logo"><Database size={30} /></div>
          <div>
            <div className="mexal-title-line"><h1>Mexal ERP</h1><IntegrationStatusBadge status="connected" /></div>
            <p>Console di controllo della sincronizzazione tra Progre Workspace e Passepartout Mexal.</p>
          </div>
        </div>
        <div className="mexal-hero-user"><span>Operatore</span><strong>{`${profile?.nome || ""} ${profile?.cognome || ""}`.trim() || "Utente"}</strong></div>
      </section>

      {message && <div className={`mexal-alert alert-${message.type}`}>{message.type === "error" || message.type === "warning" ? <AlertTriangle size={19} /> : <Boxes size={19} />}<span>{message.text}</span><button type="button" onClick={() => setMessage(null)}>×</button></div>}

      <nav className="mexal-main-tabs" aria-label="Sezioni Centro Mexal">
        <button type="button" className={activeTab === "syncs" ? "active" : ""} onClick={() => setActiveTab("syncs")}>Sincronizzazioni</button>
        <button type="button" className={activeTab === "configuration" ? "active" : ""} onClick={() => setActiveTab("configuration")}>Configurazioni</button>
      </nav>

      {activeTab === "syncs" && <>
        <section className="mexal-kpi-grid">
          <div className="mexal-kpi"><span>Connessione</span><IntegrationStatusBadge status="connected" /></div>
          <div className="mexal-kpi"><span>Ultima sincronizzazione</span><strong>{formatDate(latestRun?.started_at)}</strong></div>
          <div className="mexal-kpi"><span>Run in corso</span><strong>{runningRuns}</strong></div>
          <div className="mexal-kpi"><span>Sincronizzazioni con errori</span><strong>{failedRuns}</strong></div>
          <button type="button" className="mexal-kpi" onClick={() => openHistory()}><span>Cronologia sincronizzazioni</span><strong>{runs.length}</strong></button>
        </section>

        <section className="mexal-sync-grid">
          {cards.map((card) => <MexalSyncCard key={card.title} {...card} running={activeSync === card.type || running} lastRun={formatDate(card.lastRunData?.started_at)} run={card.lastRunData} onSync={() => card.type === "orders" ? navigate("/orders") : card.type === "commercial_conditions" ? runCommercialSync() : runEntitySync(card.type)} onOpen={() => {}} />)}
        </section>

        <section className="mexal-manual-start">
          <div className="mexal-section-heading"><div><h3>Avvio manuale</h3><p>Avvia le sincronizzazioni disponibili e monitora le run appena create.</p></div></div>
          {isAdminUser && <div className="mexal-manual-actions">
            {Object.entries(syncLabels).map(([type, label]) => <button key={type} type="button" className="orders-primary" disabled={Boolean(manualAction)} onClick={() => startManualSync(type)}>{manualAction === type ? "Avvio…" : type === "list_price_commissions" ? "Sincronizza provvigioni listini" : label}</button>)}
            <button type="button" className="orders-primary" disabled={Boolean(manualAction)} onClick={() => startManualSync()}>{manualAction === "all" ? "Avvio…" : "Sincronizza tutto"}</button>
          </div>}
        </section>

        <MexalProgress running={running || Boolean(manualAction)} progress={progress} phase={phase} />

        <section className="mexal-table-panel">
          <table className="mexal-history-table">
            <thead><tr><th>Tipo</th><th>Stato</th><th>Inizio</th><th>Fine</th><th>Messaggio</th><th>Azioni</th></tr></thead>
            <tbody>{runs.length === 0 ? <tr><td colSpan="6">Nessuna sincronizzazione registrata.</td></tr> : runs.map((run) => <tr key={run.id} className={run.status === "running" ? "is-running" : ""}><td>{syncLabels[run.sync_type] || "Sincronizzazione"}</td><td><IntegrationStatusBadge status={run.status} /></td><td>{formatDate(run.started_at)}</td><td>{formatDate(run.completed_at)}</td><td>{run.error_message || "—"}</td><td>{run.status === "running" && isAdminUser && <button type="button" className="orders-secondary" disabled={stoppingRunId === run.id} onClick={() => stopRun(run)}>{stoppingRunId === run.id ? "Arresto…" : "Arresta"}</button>}<button type="button" onClick={() => openHistory(run)}>Dettaglio</button></td></tr>)}</tbody>
          </table>
        </section>

        <section ref={historyRef} className="mexal-history-section">
          <div className="mexal-section-heading"><div><h3><Clock3 size={19} /> Cronologia sincronizzazioni</h3><p>Storico completo delle esecuzioni manuali e pianificate.</p></div></div>
          <MexalHistory runs={runs} selectedRunId={selectedRun?.id} onSelect={setSelectedRun} />
        </section>
      </>}

      {activeTab === "configuration" && <>
        <nav className="mexal-main-tabs" aria-label="Configurazioni Mexal">
          <button type="button" className={configurationTab === "settings" ? "active" : ""} onClick={() => setConfigurationTab("settings")}>Configurazione</button>
          <button type="button" className={configurationTab === "automations" ? "active" : ""} onClick={() => setConfigurationTab("automations")}>Automazioni</button>
          <button type="button" className={configurationTab === "series" ? "active" : ""} onClick={() => setConfigurationTab("series")}>Serie documenti</button><button type="button" className={configurationTab === "orders" ? "active" : ""} onClick={() => setConfigurationTab("orders")}>Ordini PROF / PH</button>
        </nav>
        {configurationTab === "settings" && <div className="mexal-two-columns"><MexalSettings settings={settings} onChange={setSettings} disabled={running} /><section className="mexal-data-summary"><div className="mexal-section-heading"><div><h3>Stato ambiente</h3><p>Configurazione disponibile senza mostrare credenziali.</p></div></div><div className="mexal-data-summary-grid"><div><span>Matrice sconti</span><strong>{counts.matrix ?? "—"}</strong></div><div><span>Particolarità</span><strong>{counts.particularities ?? "—"}</strong></div><div><span>Regole pagamento</span><strong>{counts.payments ?? "—"}</strong></div></div></section></div>}
        {configurationTab === "automations" && <MexalAutomations canManage={isAdminUser} />}
        {configurationTab === "series" && <OrdersDocumentSeriesSettings canManage={isAdminUser} />}
        {configurationTab === "orders" && <OrderModuleSettings />}
      </>}
    </div>
  );
}
