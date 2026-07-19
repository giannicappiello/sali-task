import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  Boxes,
  Building2,
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
import MexalLog from "../components/MexalLog";
import MexalProgress from "../components/MexalProgress";
import MexalSettings from "../components/MexalSettings";
import MexalSyncCard from "../components/MexalSyncCard";
import IntegrationStatusBadge from "../components/IntegrationStatusBadge";
import {
  invokeCommercialConditionsSync,
  loadCommercialCounts,
  invokeClientsSync,
  invokeProductsSync,
  invokeStocksSync,
  loadMexalEntityCounts,
  loadMexalRuns,
  loadRunDetails,
  loadSyncRuns,
} from "../services/mexalSyncService";

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

function formatDuration(milliseconds) {
  if (milliseconds == null) return "—";
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export default function MexalDashboard() {
  const navigate = useNavigate();
  const { profile, isAdminUser } = useAuth();
  const [runs, setRuns] = useState([]);
  const [counts, setCounts] = useState({ matrix: null, particularities: null, payments: null });
  const [selectedRun, setSelectedRun] = useState(null);
  const [logItems, setLogItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState(null);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState("");
  const [settings, setSettings] = useState({ mode: "full", dryRun: false, syncPayments: true });
  const [entityCounts, setEntityCounts] = useState({ products: null, clients: null, stocks: null, orders: null });
  const [entityRuns, setEntityRuns] = useState({ products: null, clients: null, stocks: null, orders: null });
  const [activeSync, setActiveSync] = useState(null);

  const latestRun = runs[0] || null;

  const refreshData = useCallback(async (preferredRunId = null) => {
    const [runRows, countRows, entityCountRows, productRuns, clientRuns, stockRuns, orderRuns] = await Promise.all([loadSyncRuns(25), loadCommercialCounts(), loadMexalEntityCounts(), loadMexalRuns("products"), loadMexalRuns("clients"), loadMexalRuns("stocks"), loadMexalRuns("orders")]);
    setRuns(runRows);
    setCounts(countRows);
    setEntityCounts(entityCountRows);
    setEntityRuns({ products: productRuns[0] || null, clients: clientRuns[0] || null, stocks: stockRuns[0] || null, orders: orderRuns[0] || null });

    const nextSelected = preferredRunId
      ? runRows.find((run) => run.id === preferredRunId)
      : (selectedRun ? runRows.find((run) => run.id === selectedRun.id) : runRows[0]);

    if (nextSelected) {
      setSelectedRun(nextSelected);
      const runLog = await loadRunDetails(nextSelected.id);
      setLogItems([
        ...runLog.details.map((item) => ({ ...item, title: item.entity_type })),
        ...runLog.errors.map((item) => ({
          ...item,
          status: "error",
          title: item.entity_type || "Errore",
          message: item.error_message,
        })),
      ].sort((a, b) => new Date(a.created_at) - new Date(b.created_at)));
    } else {
      setSelectedRun(null);
      setLogItems([]);
    }
  }, [selectedRun]);

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
    return () => { active = false; };
  }, []);

  async function selectRun(run) {
    setSelectedRun(run);
    try {
      const runLog = await loadRunDetails(run.id);
      setLogItems([
        ...runLog.details.map((item) => ({ ...item, title: item.entity_type })),
        ...runLog.errors.map((item) => ({ ...item, status: "error", title: item.entity_type || "Errore", message: item.error_message })),
      ].sort((a, b) => new Date(a.created_at) - new Date(b.created_at)));
    } catch (error) {
      setMessage({ type: "error", text: error.message || "Impossibile leggere il log" });
    }
  }

  async function runCommercialSync() {
    if (!isAdminUser) {
      setMessage({ type: "error", text: "La sincronizzazione è riservata agli amministratori." });
      return;
    }

    if (!settings.dryRun) {
      const confirmed = window.confirm(
        "Avviare la sincronizzazione reale? Le condizioni commerciali lette da Mexal saranno salvate in Supabase e, in modalità completa, le regole non più presenti saranno disattivate."
      );
      if (!confirmed) return;
    }

    setRunning(true);
    setMessage(null);
    setProgress(8);
    setPhase("Connessione alla WebAPI Mexal");

    const timers = [
      window.setTimeout(() => { setProgress(28); setPhase("Lettura matrice sconti"); }, 900),
      window.setTimeout(() => { setProgress(52); setPhase("Lettura particolarità commerciali"); }, 2200),
      window.setTimeout(() => { setProgress(76); setPhase("Validazione e salvataggio dati"); }, 4200),
    ];

    try {
      const result = await invokeCommercialConditionsSync(settings);
      setProgress(100);
      setPhase("Sincronizzazione completata");
      setMessage({
        type: result.status === "completed_with_warnings" ? "warning" : "success",
        text: settings.dryRun
          ? `Dry Run completato: ${result.matrix?.read || 0} regole matrice e ${result.particularities?.read || 0} particolarità lette.`
          : `Sincronizzazione completata: ${result.matrix?.written || 0} regole matrice e ${result.particularities?.written || 0} particolarità salvate.`,
      });
      await refreshData(result.runId);
    } catch (error) {
      setProgress(100);
      setPhase("Sincronizzazione interrotta");
      setMessage({ type: "error", text: error.message || "Errore durante la sincronizzazione Mexal" });
      try { await refreshData(); } catch { /* Mantiene il messaggio principale. */ }
    } finally {
      timers.forEach(window.clearTimeout);
      window.setTimeout(() => {
        setRunning(false);
        setProgress(0);
        setPhase("");
      }, 700);
    }
  }

  async function runEntitySync(type) {
    if (!isAdminUser || activeSync) return;
    setActiveSync(type);
    setMessage({ type: "info", text: `Sincronizzazione ${type === "products" ? "prodotti" : "clienti"} avviata...` });
    try {
      const result = type === "products"
        ? await invokeProductsSync(({ processed, total, inserted, updated, errors }) => setMessage({ type: "info", text: `Sincronizzazione prodotti in corso: ${processed}/${total} elaborati, ${inserted} inseriti, ${updated} aggiornati, ${errors.length} errori.` }))
        : type === "stocks" ? await invokeStocksSync(({ processed, total, updated, errors }) => setMessage({ type: "info", text: `Sincronizzazione giacenze in corso: ${processed}/${total} elaborati, ${updated} aggiornati, ${errors.length} errori.` }))
        : await invokeClientsSync();
      const processed = type === "products" || type === "stocks" ? result.processed : result.letti_mexal;
      const inserted = type === "products" ? result.inserted : type === "stocks" ? 0 : result.inseriti;
      const updated = type === "products" || type === "stocks" ? result.updated : result.aggiornati;
      const errors = type === "products" || type === "stocks" ? result.errors.length : result.errori?.length || 0;
      setMessage({ type: errors ? "warning" : "success", text: `Sincronizzazione ${type === "products" ? "prodotti" : type === "stocks" ? "giacenze" : "clienti"} completata: ${processed || 0} elaborati, ${inserted || 0} inseriti, ${updated || 0} aggiornati, ${errors} errori.` });
      await refreshData();
    } catch (error) {
      setMessage({ type: "error", text: error.message || "Sincronizzazione Mexal interrotta." });
      try { await refreshData(); } catch { /* conserva il messaggio */ }
    } finally { setActiveSync(null); }
  }

  const commercialCount = useMemo(() => {
    const values = [counts.matrix, counts.particularities, counts.payments];
    if (values.some((value) => value == null)) return null;
    return values.reduce((sum, value) => sum + value, 0);
  }, [counts]);

  const cards = [
    { icon: Users, title: "Clienti", description: "Anagrafiche, categorie commerciali e condizioni cliente.", recordLabel: "clienti attivi", recordCount: entityCounts.clients, enabled: true, onSync: () => runEntitySync("clients"), lastRunData: entityRuns.clients },
    { icon: Building2, title: "Agenti", description: "Agenti Mexal e associazioni con Area Manager.", recordLabel: "agenti", enabled: false },
    { icon: PackageSearch, title: "Prodotti", description: "Catalogo, categorie, immagini e schede tecniche. Import incrementale, senza disattivazioni preventive.", recordLabel: "prodotti visibili", recordCount: entityCounts.products, enabled: true, onSync: () => runEntitySync("products"), lastRunData: entityRuns.products },
    {
      icon: ScrollText,
      title: "Condizioni commerciali",
      description: "Matrice sconti, particolarità e regole pagamento.",
      recordLabel: "regole attive",
      recordCount: commercialCount,
      enabled: true,
      onSync: runCommercialSync,
    },
    { icon: Warehouse, title: "Giacenze", description: "Disponibilità per magazzino e controllo evasione ordini.", recordLabel: "prodotti con giacenza sincronizzata", recordCount: entityCounts.stocks, enabled: true, onSync: () => runEntitySync("stocks"), lastRunData: entityRuns.stocks },
    { icon: ShoppingCart, title: "Ordini", description: "Invio OCM/OCX, PDF e stato sincronizzazione documenti.", recordLabel: "ordini da inviare", recordCount: entityCounts.orders, enabled: true, onSync: () => navigate("/orders"), lastRunData: entityRuns.orders },
  ];

  if (loading) {
    return <div className="integrations-loading"><RefreshCw className="spin" size={24} /> Caricamento Centro Mexal...</div>;
  }

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
        <div className="mexal-hero-user">
          <span>Operatore</span>
          <strong>{`${profile?.nome || ""} ${profile?.cognome || ""}`.trim() || "Utente"}</strong>
        </div>
      </section>

      {message && (
        <div className={`mexal-alert alert-${message.type}`}>
          {message.type === "error" || message.type === "warning" ? <AlertTriangle size={19} /> : <Boxes size={19} />}
          <span>{message.text}</span>
          <button type="button" onClick={() => setMessage(null)}>×</button>
        </div>
      )}

      <section className="mexal-kpi-grid">
        <div className="mexal-kpi"><span>Ultima sincronizzazione</span><strong>{formatDate(latestRun?.started_at)}</strong></div>
        <div className="mexal-kpi"><span>Durata ultima esecuzione</span><strong>{formatDuration(latestRun?.duration_ms)}</strong></div>
        <div className="mexal-kpi"><span>Record letti</span><strong>{latestRun?.records_read ?? 0}</strong></div>
        <div className="mexal-kpi"><span>Stato ultimo processo</span><IntegrationStatusBadge status={latestRun?.status || "unavailable"} /></div>
      </section>

      <div className="mexal-sync-grid">
        {cards.map((card) => (
          <MexalSyncCard
            key={card.title}
            {...card}
            run={card.lastRunData}
            running={card.title === "Condizioni commerciali" ? running : activeSync === (card.title === "Prodotti" ? "products" : card.title === "Clienti" ? "clients" : card.title === "Giacenze" ? "stocks" : "")}
            lastRun={card.lastRunData ? formatDate(card.lastRunData.completed_at || card.lastRunData.started_at) : (card.title === "Condizioni commerciali" && latestRun ? formatDate(latestRun.completed_at || latestRun.started_at) : null)}
            onOpen={() => setMessage({ type: "warning", text: `${card.title}: funzionalità prevista nei prossimi sprint.` })}
          />
        ))}
      </div>

      <MexalProgress running={running} progress={progress} phase={phase} />

      <div className="mexal-two-columns">
        <MexalSettings settings={settings} onChange={setSettings} disabled={running} />
        <section className="mexal-data-summary">
          <div className="mexal-section-heading"><div><h3>Dati commerciali attivi</h3><p>Record presenti nel database del Workspace.</p></div></div>
          <div className="mexal-data-summary-grid">
            <div><span>Matrice sconti</span><strong>{counts.matrix ?? "—"}</strong></div>
            <div><span>Particolarità</span><strong>{counts.particularities ?? "—"}</strong></div>
            <div><span>Regole pagamento</span><strong>{counts.payments ?? "—"}</strong></div>
          </div>
        </section>
      </div>

      <MexalHistory runs={runs} selectedRunId={selectedRun?.id} onSelect={selectRun} />
      <MexalLog items={logItems} />
    </div>
  );
}
