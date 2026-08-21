import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Boxes,
  Building2,
  FileText,
  PackageSearch,
  Tags,
  Percent,
  RefreshCw,
  ShoppingCart,
  ScrollText,
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
import MexalOrderMaintenance from "../components/MexalOrderMaintenance";
import {
  invokeCommercialConditionsSync,
  loadCommercialCounts,
  invokeClientsSync,
  invokeProductsSync,
  invokeStocksSync,
  invokeSalesInvoicesSync,
  loadMexalEntityCounts,
  loadMexalRuns,
  loadSyncRuns,
  startMexalSync,
  stopMexalRun,
} from "../services/mexalSyncService";
import { supabase } from "../../../lib/supabaseClient";
import {
  loadMexalAutomationRules,
  saveMexalAutomationRule,
} from "../services/mexalAutomationService";

const syncLabels = {
  clients: "Clienti",
  agents: "Agenti",
  products: "Prodotti",
  product_categories: "Categorie prodotto",
  stocks: "Giacenze",
  commercial_conditions: "Condizioni commerciali",
  document_series: "Serie documenti",
  list_price_commissions: "Provvigioni listini",
  orders: "Ordini",
  sales_invoices: "Fatture",
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
  const { hasPermission } = useAuth();
  const canConfigure = hasPermission("integrations.configure");
  const canSync = useCallback((type) => hasPermission(`integrations.sync.${type}`), [hasPermission]);
  const [runs, setRuns] = useState([]);
  const [counts, setCounts] = useState({ matrix: null, particularities: null, payments: null });
  const [selectedRun, setSelectedRun] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState(null);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState("");
  const [settings, setSettings] = useState({ mode: "full", dryRun: false, syncPayments: true });
  const [entityCounts, setEntityCounts] = useState({ products: null, clients: null, stocks: null, orders: null, listPriceCommissions: null, salesInvoices: null, salesInvoicesLastSync: null });
  const [entityRuns, setEntityRuns] = useState({ products: null, clients: null, stocks: null, orders: null });
  const [activeSync, setActiveSync] = useState(null);
  const [activeTab, setActiveTab] = useState("syncs");
  const [configurationTab, setConfigurationTab] = useState("settings");
  const [stoppingRunId, setStoppingRunId] = useState(null);
  const [syncSchedules, setSyncSchedules] = useState({});
  const [savingScheduleType, setSavingScheduleType] = useState(null);
  const [stoppingInvoiceSync, setStoppingInvoiceSync] = useState(false);
  const historyRef = useRef(null);
  const mountedRef = useRef(true);
  const cancelInvoiceSyncRef = useRef(false);

  const latestRun = runs[0] || null;

  const refreshData = useCallback(async (preferredRunId = null) => {
    const [runRows, countRows, entityCountRows, productRuns, clientRuns, stockRuns, orderRuns] = await Promise.all([
      loadSyncRuns(100),
      loadCommercialCounts(),
      loadMexalEntityCounts(),
      loadMexalRuns("products"),
      loadMexalRuns("clients"),
      loadMexalRuns("stocks"),
      loadMexalRuns("orders"),
    ]);
    if (!mountedRef.current) return;
    setRuns(runRows);
    setCounts(countRows);
    setEntityCounts(entityCountRows);
    if (canConfigure) {
      try {
        const automationRules = await loadMexalAutomationRules({ supabase });
        setSyncSchedules(Object.fromEntries(
          automationRules.schedules.map((rule) => [rule.sync_type, rule]),
        ));
      } catch {
        setSyncSchedules({});
      }
    }
    setEntityRuns({
      products: productRuns[0] || null,
      clients: clientRuns[0] || null,
      stocks: stockRuns[0] || null,
      orders: orderRuns[0] || null,
    });
    const nextSelected = preferredRunId
      ? runRows.find((run) => Number(run.id) === Number(preferredRunId))
      : runRows[0];
    setSelectedRun(nextSelected || null);
  }, [canConfigure]);

  useEffect(() => {
    let active = true;
    mountedRef.current = true;
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
    };
  }, [refreshData]);

  useEffect(() => {
    if (!activeSync && !running) return undefined;
    const timer = window.setInterval(async () => {
      try {
        const runRows = await loadSyncRuns(100);
        if (mountedRef.current) setRuns(runRows);
      } catch {
        // Il messaggio dell'operazione principale resta quello mostrato all'utente.
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [activeSync, running]);

  async function runCommercialSync() {
    if (!canSync("commercial_conditions")) return;
    if (!settings.dryRun && !await window.workspaceConfirm("Avviare la sincronizzazione reale delle condizioni commerciali?")) return;
    setRunning(true);
    setMessage(null);
    setProgress(10);
    setPhase("Connessione alla WebAPI Mexal");
    try {
      const result = await invokeCommercialConditionsSync(settings);
      setProgress(100);
      setPhase("Sincronizzazione completata");
      setMessage({ type: "success", text: "Condizioni commerciali sincronizzate." });
      await refreshData(result.sync_run_id || result.runId);
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
    if (!canSync(type) || activeSync) return;
    setActiveSync(type);
    setProgress(5);
    setPhase(syncLabels[type] || type);
    setMessage({ type: "info", text: `Sincronizzazione ${syncLabels[type] || type} avviata...` });
    if (type === "sales_invoices") {
      cancelInvoiceSyncRef.current = false;
      setStoppingInvoiceSync(false);
    }
    try {
      const updateProgress = ({ processed, total }) => {
        const percentage = total > 0 ? Math.min(95, Math.round((processed / total) * 100)) : 10;
        setProgress(percentage);
        setPhase(`${syncLabels[type] || type}: ${processed}/${total || "?"} elaborati`);
      };
      let result;
      if (type === "products") result = await invokeProductsSync(updateProgress);
      else if (type === "stocks") result = await invokeStocksSync(updateProgress);
      else if (type === "clients") result = await invokeClientsSync();
      else if (type === "sales_invoices") result = await invokeSalesInvoicesSync(({ pages, processed }) => {
        setProgress(Math.min(95, 5 + pages));
        setPhase(`Fatture: pagina ${pages}, ${processed} documenti elaborati`);
      }, () => cancelInvoiceSyncRef.current);
      else result = await startMexalSync(type);
      if (result?.cancelled) {
        setMessage({ type: "warning", text: `Sincronizzazione ${syncLabels[type] || type} arrestata.` });
        await refreshData(result.sync_run_id || result.runId);
        return;
      }
      setProgress(100);
      setMessage({ type: "success", text: `Sincronizzazione ${syncLabels[type] || type} completata.` });
      await refreshData();
    } catch (error) {
      if (error?.cancelled) {
        setMessage({ type: "warning", text: "Sincronizzazione Fatture arrestata. I documenti già elaborati sono stati conservati." });
      } else {
        setMessage({ type: "error", text: error.message || "Sincronizzazione Mexal interrotta." });
      }
      await refreshData();
    } finally {
      if (type === "sales_invoices") setStoppingInvoiceSync(false);
      setActiveSync(null);
      window.setTimeout(() => {
        setProgress(0);
        setPhase("");
      }, 500);
    }
  }

  async function stopInvoiceSync() {
    if (activeSync !== "sales_invoices" || stoppingInvoiceSync) return;
    if (!await window.workspaceConfirm("Arrestare la sincronizzazione Fatture? I documenti già elaborati verranno conservati.")) return;
    cancelInvoiceSyncRef.current = true;
    setStoppingInvoiceSync(true);
    setPhase("Arresto sincronizzazione Fatture in corso...");
  }

  async function toggleSyncSchedule(syncType, enabled) {
    const schedule = syncSchedules[syncType];
    if (!canConfigure || !schedule || savingScheduleType) return;
    setSavingScheduleType(syncType);
    try {
      const saved = await saveMexalAutomationRule({
        supabase,
        ruleType: "schedule",
        rule: { ...schedule, enabled },
      });
      setSyncSchedules((current) => ({ ...current, [syncType]: saved }));
      setMessage({ type: "success", text: `Sincronizzazione automatica ${syncLabels[syncType] || syncType} ${enabled ? "attivata" : "disattivata"}.` });
    } catch (error) {
      setMessage({ type: "error", text: error.message || "Impossibile aggiornare la pianificazione." });
    } finally {
      setSavingScheduleType(null);
    }
  }

  async function stopRun(run) {
    if (!canSync(run?.sync_type) || stoppingRunId || run?.status !== "running") return;
    if (!await window.workspaceConfirm(`Arrestare la sincronizzazione ${syncLabels[run.sync_type] || "selezionata"}?`)) return;
    setStoppingRunId(run.id);
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

  function openHistory(run = null) {
    if (run) setSelectedRun(run);
    window.requestAnimationFrame(() => historyRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  const commercialCount = useMemo(() => {
    const values = [counts.matrix, counts.particularities, counts.payments];
    if (values.some((value) => value == null)) return null;
    return values.reduce((sum, value) => sum + value, 0);
  }, [counts]);

  const latestRunsByType = useMemo(() => runs.reduce((latest, run) => {
    if (!latest[run.sync_type]) latest[run.sync_type] = run;
    return latest;
  }, {}), [runs]);

  const cards = [
    { icon: Users, title: "Clienti", description: "Anagrafiche, categorie commerciali e condizioni cliente.", recordLabel: "clienti attivi", recordCount: entityCounts.clients, enabled: true, type: "clients", lastRunData: latestRunsByType.clients || entityRuns.clients },
    { icon: Building2, title: "Agenti", description: "Agenti Mexal e associazioni con Area Manager.", recordLabel: "agenti", enabled: false, type: "agents", lastRunData: latestRunsByType.agents },
    { icon: PackageSearch, title: "Prodotti", description: "Catalogo, categorie, immagini e schede tecniche.", recordLabel: "prodotti visibili", recordCount: entityCounts.products, enabled: true, type: "products", lastRunData: latestRunsByType.products || entityRuns.products },
    { icon: Tags, title: "Categorie prodotto", description: "Categorie ricavate dagli articoli Mexal sincronizzati.", recordLabel: "categorie attive", recordCount: entityCounts.productCategories, enabled: true, type: "product_categories", lastRunData: latestRunsByType.product_categories },
    { icon: ScrollText, title: "Condizioni commerciali", description: "Matrice sconti, particolarità e regole pagamento.", recordLabel: "regole attive", recordCount: commercialCount, enabled: true, type: "commercial_conditions", lastRunData: latestRunsByType.commercial_conditions },
    { icon: Warehouse, title: "Giacenze", description: "Disponibilità per magazzino e controllo evasione ordini.", recordLabel: "prodotti sincronizzati", recordCount: entityCounts.stocks, enabled: true, type: "stocks", lastRunData: latestRunsByType.stocks || entityRuns.stocks },
    { icon: Percent, title: "Provvigioni listini", description: "Regole provvigionali associate ai listini Mexal.", recordLabel: "regole attive", recordCount: entityCounts.listPriceCommissions, enabled: true, type: "list_price_commissions", lastRunData: latestRunsByType.list_price_commissions },

    { icon: ShoppingCart, title: "Ordini", description: "Controlla i documenti OCM, OCI e OCX di ORDINIPR e ORDINIPH.", recordLabel: "documenti controllati nell’ultimo run", recordCount: (latestRunsByType.orders || entityRuns.orders)?.processed, enabled: true, type: "orders", actionLabel: "Esegui ora", runningLabel: "Sincronizzazione...", lastRunData: latestRunsByType.orders || entityRuns.orders },
    { icon: FileText, title: "Fatture", description: "Importa da Mexal i documenti FTE, FTS e COX completi di testata e righe.", recordLabel: "documenti importati", recordCount: entityCounts.salesInvoices, enabled: true, type: "sales_invoices", actionLabel: "Sincronizza ora", runningLabel: "Importazione documenti...", lastRun: entityCounts.salesInvoicesLastSync },
  ];

  const runningRuns = runs.filter((item) => item.status === "running").length;
  const failedRuns = runs.filter((item) => ["failed", "timeout", "completed_with_errors"].includes(item.status)).length;

  if (loading) return <div className="integrations-loading"><RefreshCw className="spin" size={24} /> Caricamento Centro Mexal...</div>;

  return (
    <div className="mexal-page">
      {message && <div className={`mexal-alert alert-${message.type}`}>{message.type === "error" || message.type === "warning" ? <AlertTriangle size={19} /> : <Boxes size={19} />}<span>{message.text}</span><button type="button" onClick={() => setMessage(null)}>×</button></div>}

      <nav className="mexal-main-tabs" aria-label="Sezioni Centro Mexal">
        <button type="button" className={activeTab === "syncs" ? "active" : ""} onClick={() => setActiveTab("syncs")}>Sincronizzazioni</button>
        <button type="button" className={activeTab === "configuration" ? "active" : ""} onClick={() => setActiveTab("configuration")}>Configurazioni</button>
      </nav>

      {activeTab === "syncs" && <>
        <section className="mexal-kpi-grid mexal-summary-grid">
          <button type="button" className="mexal-kpi" onClick={() => setActiveTab("configuration")}><span>Connessione</span><IntegrationStatusBadge status="connected" /></button>
          <button type="button" className="mexal-kpi" onClick={() => openHistory()}><span>Ultima sincronizzazione</span><strong>{formatDate(latestRun?.started_at)}</strong></button>
          <button type="button" className="mexal-kpi" onClick={() => openHistory()}><span>Run in corso</span><strong>{runningRuns}</strong></button>
          <button type="button" className="mexal-kpi" onClick={() => openHistory()}><span>Sincronizzazioni con errori</span><strong>{failedRuns}</strong></button>
          <button type="button" className="mexal-kpi" onClick={() => openHistory()}><span>Cronologia sincronizzazioni</span><strong>{runs.length}</strong></button>
        </section>

        <section className="mexal-sync-grid">
          {cards.filter((card) => canSync(card.type)).map((card) => <MexalSyncCard
            key={card.title}
            {...card}
            running={activeSync === card.type || (card.type === "commercial_conditions" && running) || card.lastRunData?.status === "running"}
            stopping={card.type === "sales_invoices" ? stoppingInvoiceSync : stoppingRunId === card.lastRunData?.id}
            canStop={card.type === "sales_invoices" || card.type === "product_categories"}
            lastRun={formatDate(card.lastRun || card.lastRunData?.started_at)}
            run={card.lastRunData}
            onSync={() => card.type === "commercial_conditions" ? runCommercialSync() : runEntitySync(card.type)}
            onStop={() => card.type === "sales_invoices" ? stopInvoiceSync() : stopRun(card.lastRunData)}
            onOpen={() => card.type === "agents" && navigate("/integrations/mexal/agenti")}
            automaticEnabled={syncSchedules[card.type] ? syncSchedules[card.type].enabled === true : undefined}
            automaticSaving={savingScheduleType === card.type}
            onToggleAutomatic={(enabled) => toggleSyncSchedule(card.type, enabled)}
          />)}
        </section>

        <MexalProgress running={running || Boolean(activeSync)} progress={progress} phase={phase} />

        <section ref={historyRef} className="mexal-history-section">
          <MexalHistory runs={runs} selectedRunId={selectedRun?.id} onSelect={setSelectedRun} />
        </section>
      </>}

      {activeTab === "configuration" && <>
        <nav className="mexal-main-tabs" aria-label="Configurazioni Mexal">
          <button type="button" className={configurationTab === "settings" ? "active" : ""} onClick={() => setConfigurationTab("settings")}>Configurazione</button>
          <button type="button" className={configurationTab === "automations" ? "active" : ""} onClick={() => setConfigurationTab("automations")}>Automazioni</button>
          <button type="button" className={configurationTab === "series" ? "active" : ""} onClick={() => setConfigurationTab("series")}>Serie documenti</button><button type="button" className={configurationTab === "orders" ? "active" : ""} onClick={() => setConfigurationTab("orders")}>Ordini PROF / PH</button><button type="button" className={configurationTab === "maintenance" ? "active" : ""} onClick={() => setConfigurationTab("maintenance")}>Manutenzione</button>
        </nav>
        {configurationTab === "settings" && <div className="mexal-two-columns"><MexalSettings settings={settings} onChange={setSettings} disabled={running} /><section className="mexal-data-summary"><div className="mexal-section-heading"><div><h3>Stato ambiente</h3><p>Configurazione disponibile senza mostrare credenziali.</p></div></div><div className="mexal-data-summary-grid"><div><span>Matrice sconti</span><strong>{counts.matrix ?? "—"}</strong></div><div><span>Particolarità</span><strong>{counts.particularities ?? "—"}</strong></div><div><span>Regole pagamento</span><strong>{counts.payments ?? "—"}</strong></div></div></section></div>}
        {configurationTab === "automations" && <MexalAutomations canManage={canConfigure} />}
        {configurationTab === "series" && <OrdersDocumentSeriesSettings canManage={canConfigure} />}
        {configurationTab === "orders" && <OrderModuleSettings />}
        {configurationTab === "maintenance" && <MexalOrderMaintenance canManage={canConfigure} />}
      </>}
    </div>
  );
}
