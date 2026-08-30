import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ClipboardList, Factory, RefreshCw, ShieldCheck, ShoppingCart, Workflow } from "lucide-react";
import { useLocation, useParams } from "react-router-dom";
import ModuleContainerLayout from "../../components/ModuleContainerLayout";
import { useAuth } from "../../contexts/AuthContext";
import useBackNavigation from "../../hooks/useBackNavigation";
import "./production.css";
import RdpWorkbench from "./RdpWorkbench";
import PurchaseRequirements from "./PurchaseRequirements";

async function requestProgremes(action, accessToken, extra = {}) {
  const response = await fetch("/api/mexal/automation", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...extra }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Operazione di produzione non riuscita.");
  return payload;
}

async function readProgremes(resource, accessToken) {
  const response = await fetch(`/api/progremes/${resource}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Diagnostica ProgreMES non disponibile.");
  return payload;
}

function DiagnosticsCenter() {
  const { session, hasPermission } = useAuth();
  const accessToken = session?.access_token;
  const [health, setHealth] = useState(null);
  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState({ severity: "", status: "", search: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyDiagnosticId, setBusyDiagnosticId] = useState("");
  const [archiveDiagnosticId, setArchiveDiagnosticId] = useState("");
  const [reasons, setReasons] = useState({});
  const canManage = hasPermission?.("diagnostics.manage");

  async function applyDiagnosticAction(row, diagnosticAction) {
    const reason = String(reasons[row.diagnosticId] || "").trim();
    if (diagnosticAction === "archive" && !reason) {
      setError("Inserire una motivazione prima di eliminare la diagnostica dalla vista operativa.");
      return;
    }
    setBusyDiagnosticId(row.diagnosticId); setError("");
    try {
      await requestProgremes("progremes_diagnostic_action", accessToken, { diagnosticId: row.diagnosticId, diagnosticAction, reason });
      setArchiveDiagnosticId("");
      await load();
    } catch (actionError) { setError(actionError?.message || "Aggiornamento diagnostica non riuscito."); }
    finally { setBusyDiagnosticId(""); }
  }

  async function load() {
    setLoading(true); setError("");
    try {
      const [nextHealth, nextRows] = await Promise.all([
        readProgremes("diagnostics-health", accessToken), readProgremes("diagnostics", accessToken),
      ]);
      setHealth(nextHealth); setRows(nextRows);
    } catch (loadError) { setError(loadError?.message || "Centro Diagnostico non disponibile."); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    if (!accessToken) return undefined;
    let active = true;
    Promise.all([readProgremes("diagnostics-health", accessToken), readProgremes("diagnostics", accessToken)])
      .then(([nextHealth, nextRows]) => { if (active) { setHealth(nextHealth); setRows(nextRows); } })
      .catch((loadError) => { if (active) setError(loadError?.message || "Centro Diagnostico non disponibile."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [accessToken]);
  const visible = rows.filter((row) => {
    if (filters.severity && row.severity !== filters.severity) return false;
    if (filters.status && (row.workspaceDisposition || row.status) !== filters.status) return false;
    const text = `${row.errorCode} ${row.entityId} ${row.articleCode} ${row.title} ${row.phase} ${row.sourceSystem}`.toLowerCase();
    return !filters.search || text.includes(filters.search.toLowerCase());
  });
  const lamp = health?.globalStatus || "UNAVAILABLE";
  const gates = health?.productionGates;
  return <div className="production-page diagnostics-center">
    <section className={`diagnostics-summary diagnostics-${lamp.toLowerCase()}`}>
      {lamp === "GREEN" ? <ShieldCheck /> : <AlertTriangle />}
      <div><span>Stato globale WorkspaceMES</span><h1>{lamp}</h1><p>Blocking {health?.blocking ?? "—"} · Critical {health?.critical ?? "—"} · Warning {health?.warning ?? "—"} · Outbox {health?.pendingOutbox ?? "—"}</p></div>
      <button type="button" onClick={load}><RefreshCw size={17} />Aggiorna</button>
    </section>
    <section className="diagnostics-integrations">
      <strong>Integrazioni</strong><span>Database: {health?.database ? "OK" : "KO"}</span><span>Workspace ↔ ProgreMES: {health?.workspaceCallbacks ? "OK" : "KO"}</span><span>Invio RdP Workspace: {gates?.workspace?.requests ? "ON" : "OFF"}</span><span>Gate Production: {gates?.allOn ? "ON" : "OFF"}</span><span>Ultimo Mexal OK: {health?.lastMexalSuccess ? new Date(health.lastMexalSuccess).toLocaleString("it-IT") : "non disponibile"}</span>
    </section>
    {canManage && <p className="diagnostics-help"><strong>Prendi in carico</strong> riconosce l’errore senza chiuderlo; <strong>Risolvi</strong> lo chiude mantenendo audit e storico; <strong>Elimina</strong> lo archivia dalla vista operativa dopo conferma e motivazione.</p>}
    <div className="diagnostics-filters">
      <select value={filters.severity} onChange={(event) => setFilters({ ...filters, severity: event.target.value })}><option value="">Tutte le severità</option>{["Info", "Warning", "Blocking", "Critical"].map((value) => <option key={value}>{value}</option>)}</select>
      <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">Tutti gli stati</option>{["Open", "Acknowledged", "Resolved", "Ignored", "Archived", "Historical"].map((value) => <option key={value}>{value}</option>)}</select>
      <input value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} placeholder="OCT, RdP, articolo, OdP, errore, fase..." />
    </div>
    {error && <div className="production-message">{error}<button onClick={load}>Riprova</button></div>}
    {loading ? <div className="production-loading">Caricamento diagnostica...</div> : <div className="diagnostics-table-wrap"><table className="diagnostics-table"><thead><tr><th>Severità</th><th>Stato</th><th>Codice</th><th>Entità</th><th>Messaggio</th><th>Ultima occorrenza</th>{canManage && <th>Gestione</th>}</tr></thead><tbody>{visible.map((row) => {
      const disposition = row.workspaceDisposition || row.status;
      const manageable = canManage && disposition !== "Historical" && row.status !== "Archived";
      const busy = busyDiagnosticId === row.diagnosticId;
      const confirmingArchive = archiveDiagnosticId === row.diagnosticId;
      return <tr key={row.diagnosticId} className={`severity-${row.severity.toLowerCase()}`}><td>{row.severity}</td><td>{disposition}</td><td><code>{row.errorCode}</code><small>{row.sourceSystem} / {row.phase}</small></td><td>{row.entityType} {row.entityId}<small>{row.articleCode || ""} {row.ordineProduzioneId ? `· OdP ${row.ordineProduzioneId}` : ""}</small></td><td><strong>{row.title}</strong><small>{row.description}</small><em>{row.actionRequired}</em></td><td>{new Date(row.lastSeenAt).toLocaleString("it-IT")}<small>× {row.occurrenceCount}</small></td>{canManage && <td className="diagnostics-management">{manageable ? <>
        <input aria-label={`Motivazione ${row.errorCode}`} value={reasons[row.diagnosticId] || ""} onChange={(event) => setReasons({ ...reasons, [row.diagnosticId]: event.target.value })} placeholder="Motivazione (obbligatoria per elimina)" disabled={busy} />
        {confirmingArchive ? <><small>Resterà nello storico con audit.</small><div><button type="button" className="danger-action" disabled={busy} onClick={() => applyDiagnosticAction(row, "archive")}>Conferma elimina</button><button type="button" disabled={busy} onClick={() => setArchiveDiagnosticId("")}>Annulla</button></div></> : <div><button type="button" disabled={busy} onClick={() => applyDiagnosticAction(row, "acknowledge")}>Prendi in carico</button><button type="button" disabled={busy} onClick={() => applyDiagnosticAction(row, "resolve")}>Risolvi</button><button type="button" disabled={busy} onClick={() => setArchiveDiagnosticId(row.diagnosticId)}>Elimina</button></div>}
      </> : <small>Solo storico</small>}</td>}</tr>;
    })}</tbody></table></div>}
  </div>;
}

function SectionLauncher({ sectionCode }) {
  const { session } = useAuth();
  const accessToken = session?.access_token;
  const [error, setError] = useState("");
  const launched = useRef(false);
  const goBack = useBackNavigation("/produzione");
  const location = useLocation();
  const context = useMemo(() => Object.fromEntries(new URLSearchParams(location.search)), [location.search]);

  async function launch() {
    setError("");
    try {
      if (!accessToken) throw new Error("Sessione Workspace non disponibile.");
      const payload = await requestProgremes("progremes_sso", accessToken, { screenCode: sectionCode, context });
      if (!payload.url) throw new Error("Impossibile aprire l’area di produzione.");
      window.location.assign(payload.url);
    } catch (launchError) {
      setError(launchError?.message || "Collegamento alla gestione produzione non riuscito.");
    }
  }

  useEffect(() => {
    if (launched.current || !accessToken) return;
    launched.current = true;
    requestProgremes("progremes_sso", accessToken, { screenCode: sectionCode, context })
      .then((payload) => {
        if (!payload.url) throw new Error("Impossibile aprire l’area di produzione.");
        window.location.assign(payload.url);
      })
      .catch((launchError) => setError(launchError?.message || "Collegamento alla gestione produzione non riuscito."));
  }, [accessToken, sectionCode, context]);

  return (
    <div className="production-launch-state">
      <div className="production-launch-icon"><Factory size={32} /></div>
      <h2>{error ? "Apertura non riuscita" : "Apertura area di produzione..."}</h2>
      <p>{error || "Verifica dell’identità Workspace e collegamento sicuro in corso."}</p>
      {error ? <button type="button" className="primary-action" onClick={launch}><RefreshCw size={17} />Riprova</button> : <div className="auth-spinner" aria-label="Caricamento" />}
      <button type="button" onClick={goBack}>Torna a Gestione Produzione</button>
    </div>
  );
}

export default function Production() {
  const { "*": sectionPath } = useParams();
  const { session, hasPermission } = useAuth();
  const accessToken = session?.access_token;
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadSections() {
    setLoading(true);
    setError("");
    try {
      const payload = await requestProgremes("progremes_user_sections", accessToken);
      setSections(payload.sections || []);
    } catch (loadError) {
      setError(loadError?.message || "Caricamento delle aree non riuscito.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (sectionPath || !accessToken) return undefined;
    let active = true;
    requestProgremes("progremes_user_sections", accessToken)
      .then((payload) => {
        if (!active) return;
        setSections(payload.sections || []);
        setLoading(false);
      })
      .catch((loadError) => {
        if (!active) return;
        setError(loadError?.message || "Caricamento delle aree non riuscito.");
        setLoading(false);
      });
    return () => { active = false; };
  }, [accessToken, sectionPath]);

  if (sectionPath === "diagnostica") return <DiagnosticsCenter />;
  if (sectionPath === "rdp-workbench") return <RdpWorkbench />;
  if (sectionPath === "fabbisogni-acquisto") return <PurchaseRequirements />;
  if (sectionPath) return <SectionLauncher sectionCode={decodeURIComponent(sectionPath)} />;

  const visibleSections = [...sections];
  if (hasPermission?.("diagnostics.view")) visibleSections.unshift({ code: "diagnostica", name: "Centro Diagnostico", description: "Stato globale, alert operativi e integrazioni senza esporre configurazioni riservate.", workspaceLocal: true });
  if (hasPermission?.("rdp.view")) visibleSections.unshift({ code: "rdp-workbench", name: "RdP Workbench", description: "Gestione OCT, richieste di produzione, analisi MES e decisioni operative.", workspaceLocal: true, icon: ClipboardList });
  if (hasPermission?.("rdp.view")) visibleSections.splice(1, 0, { code: "fabbisogni-acquisto", name: "Fabbisogni acquisto", description: "Calcolo mensile, coperture, fornitori e creazione controllata dei PF Mexal.", workspaceLocal: true, icon: ShoppingCart });

  return <ModuleContainerLayout
    icon={Workflow}
    eyebrow="Area operativa"
    title="Gestione Produzione"
    description="Accedi direttamente alle sezioni autorizzate. Ogni area si apre autonomamente in una nuova scheda."
    items={visibleSections.map((section) => ({ code: section.code, name: section.name, description: section.description, to: `/produzione/${encodeURIComponent(section.code)}`, external: !section.workspaceLocal, icon: section.icon || (section.workspaceLocal ? AlertTriangle : Factory) }))}
    loading={loading}
    error={error}
    onRetry={loadSections}
    ariaLabel="Aree di produzione disponibili"
    emptyDescription="Non risultano ancora sezioni di produzione assegnate al tuo reparto."
  />;
}
