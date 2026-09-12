import { useEffect, useState } from "react";
import { AlertTriangle, Factory, RefreshCw, ShieldCheck, Workflow } from "lucide-react";
import { Navigate, useLocation, useParams } from "react-router-dom";
import ModuleContainerLayout from "../../components/ModuleContainerLayout";
import InfoTooltip from "../../components/InfoTooltip";
import { useAuth } from "../../contexts/AuthContext";
import "./production.css";
import RdpWorkbench from "./RdpWorkbench";
import PurchaseRequirements from "./PurchaseRequirements";
import ProgreMesLaunch from "../ProgreMes/ProgreMesLaunch";
import { supabase } from "../../lib/supabaseClient";
import { configuredProductionSections } from "./production-sections";
import { requestProgremesWorkspaceWindow } from "../ProgreMes/progremesWindow";

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
      <div><span>Stato globale WorkspaceMES<InfoTooltip label="Stato globale WorkspaceMES" text="Indicatore derivato dalle diagnostiche aperte: i servizi centrali indisponibili e le anomalie bloccanti determinano lo stato complessivo." /></span><h1>{lamp}</h1><p>Blocking {health?.blocking ?? "—"} · Critical {health?.critical ?? "—"} · Warning {health?.warning ?? "—"} · Outbox {health?.pendingOutbox ?? "—"}</p></div>
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
  const location = useLocation();
  return <ProgreMesLaunch key={sectionCode} screenCode={sectionCode} search={location.search} />;
}

export default function Production() {
  const { "*": sectionPath } = useParams();
  const { session, hasPermission, dataScope, isAdminUser, hasScreenAccess, hasAreaAccess, hasExplicitScreenGrant } = useAuth();
  const accessToken = session?.access_token;
  const [sections, setSections] = useState([]);
  const [catalog, setCatalog] = useState({ screens: [], links: [] });

  async function fetchSections() {
    const payload = await requestProgremes("progremes_user_sections", accessToken);
    const [screens, links] = await Promise.all([
      supabase.from("workspace_schermate").select("codice,nome,descrizione,percorso,attiva,area,aree").eq("attiva", true),
      supabase.from("workspace_moduli_schermate").select("modulo_codice,schermata_codice,ordine,visibile_menu").eq("modulo_codice", "progremes").eq("visibile_menu", true).order("ordine"),
    ]);
    if (screens.error || links.error) throw screens.error || links.error;
    return { sections: payload.sections || [], screens: screens.data || [], links: links.data || [] };
  }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadSections() {
    setLoading(true);
    setError("");
    try {
      const payload = await fetchSections();
      setSections(payload.sections);
      setCatalog(payload);
    } catch (loadError) {
      setError(loadError?.message || "Caricamento delle aree non riuscito.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (sectionPath || !accessToken) return undefined;
    let active = true;
    const refresh = () => fetchSections()
      .then((payload) => {
        if (!active) return;
        setSections(payload.sections);
        setCatalog(payload);
        setLoading(false);
      })
      .catch((loadError) => {
        if (!active) return;
        setError(loadError?.message || "Caricamento delle aree non riuscito.");
        setLoading(false);
      });
    refresh();
    window.addEventListener("workspace:module-catalog-changed", refresh);
    return () => { active = false; window.removeEventListener("workspace:module-catalog-changed", refresh); };
  }, [accessToken, sectionPath]);

  const customerScoped = Boolean(dataScope?.customerCode);
  if (sectionPath === "diagnostica") return isAdminUser ? <DiagnosticsCenter /> : <Navigate to="/produzione" replace />;
  if (sectionPath === "rdp-workbench") return hasPermission?.("rdp.view") ? <RdpWorkbench /> : <Navigate to="/produzione" replace />;
  if (sectionPath === "fabbisogni-acquisto") return hasPermission?.("rdp.view") && !customerScoped ? <PurchaseRequirements /> : <Navigate to="/produzione" replace />;
  if (sectionPath) return <SectionLauncher sectionCode={decodeURIComponent(sectionPath)} />;

  const visibleSections = configuredProductionSections(sections, catalog.screens, catalog.links, {
    hasPermission, isAdminUser, customerScoped, hasScreenAccess, hasAreaAccess, hasExplicitScreenGrant,
  });

  return <ModuleContainerLayout
    icon={Workflow}
    eyebrow="Area operativa"
    title="Gestione Produzione"
    description="Le schermate MES si aprono in una nuova finestra Workspace, lasciando aperta quella corrente."
    items={visibleSections.map((section) => ({ code: section.code, name: section.name, description: section.description, to: `/produzione/${encodeURIComponent(section.code)}`, onOpen: section.workspaceLocal ? undefined : () => requestProgremesWorkspaceWindow(`/produzione/${encodeURIComponent(section.code)}`), icon: section.icon || (section.workspaceLocal ? AlertTriangle : Factory) }))}
    loading={loading}
    error={error}
    onRetry={loadSections}
    ariaLabel="Aree di produzione disponibili"
    emptyDescription="Non risultano ancora sezioni di produzione assegnate al tuo reparto."
  />;
}
