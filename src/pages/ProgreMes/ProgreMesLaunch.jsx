import { reconcilePlanningView, planningSyncFailure, planningSyncResolution } from "./planningSync.js";
import PackagingActivityDialog from '../Dashboard/PackagingActivityDialog';
import BatchActivitiesDialog from '../Dashboard/BatchActivitiesDialog';
import { batchActivitiesMessage } from './batchActivitiesMessage.js';
import { fillingActivityMessage } from './fillingActivityMessage';
import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Navigate, useNavigate } from "react-router-dom";
import { operationalMesRoute } from "../../lib/operationalMesRoute";
import { useAuth } from "../../contexts/AuthContext";
import { progremesWorkspaceDestination, requestProgremesNavigation, rememberProgremesSession, forgetProgremesSession } from "./progremesWindow";
import { observeProgremesFrame } from "./progremesHandshake";
import "./progremes-frame.css";
import StationUiPopup from "./StationUiPopup";
import PlanningActionModal from "./PlanningActionModal";
import { useWorkspaceChrome } from "../../components/workspaceChromeContext";

export default function ProgreMesLaunch({ screenCode = "", search = "", inDialog = false }) {
  const { session, hasScreenAccess, loading: authLoading, authorizationRevision } = useAuth();
  const navigate = useNavigate();
  const [fillingActivity, setFillingActivity] = useState(null);
  const [batchActivities, setBatchActivities] = useState(null);
  const accessToken = session?.access_token;
  const currentToken = useRef(accessToken);
  useEffect(() => { currentToken.current = accessToken; }, [accessToken]);
  const allowed = hasScreenAccess(screenCode)
    || (operationalMesRoute(`/produzione/${screenCode}`, search) && hasScreenAccess("attivita.dashboard"));
  const frame = useRef(null);
  const [stationPath, setStationPath] = useState("");
  const [popupPath, setPopupPath] = useState("");
  const [planningView, setPlanningView] = useState({ screenCode, fullscreen: true });
  const planningScreen = !inDialog && ["progremes.Planning", "progremes.PlanningProduction"].includes(screenCode)
    && !["station", "station-overview", "filling-overview"].includes(new URLSearchParams(search).get("destination"));
  const planningFullscreen = planningScreen && (planningView.screenCode !== screenCode || planningView.fullscreen);
  const [retry, setRetry] = useState(0);
  const [connection, setConnection] = useState({ requestKey: "", url: "", error: "" });
  const [frameStatus, setFrameStatus] = useState({ url: "", ready: false, error: "" });
  const [syncError, setSyncError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncComplete, setSyncComplete] = useState(false);
  const [syncResolution, setSyncResolution] = useState(null);
  const syncAttempt = useRef(0);
  const alignWorkspace = useCallback(async () => {
    const attempt = ++syncAttempt.current;
    setSyncing(true); setSyncComplete(false); setSyncResolution(null); setSyncError("");
    try {
      await reconcilePlanningView(currentToken.current);
      if (attempt === syncAttempt.current) { setSyncError(""); setSyncComplete(true); }
    } catch (error) {
      if (attempt === syncAttempt.current) { setSyncError(planningSyncFailure(error)); setSyncResolution(planningSyncResolution(error)); }
    } finally {
      if (attempt === syncAttempt.current) setSyncing(false);
    }
  }, []);
  useEffect(() => () => { syncAttempt.current += 1; }, []);
  const [mesHeader, setMesHeader] = useState(null);
  const sessionKey = JSON.stringify([session?.user?.id, authorizationRevision]);
  const requestKey = JSON.stringify([session?.user?.id, authorizationRevision, screenCode, search, retry]);
  const url = allowed && accessToken && connection.requestKey === requestKey ? connection.url : "";
  const goBackInMes = useCallback(() => {
    if (url && mesHeader?.url === url && mesHeader.canGoBack) frame.current?.contentWindow?.postMessage({ type: "workspace-mes-back" }, new URL(url).origin);
    else navigate("/produzione");
  }, [url, mesHeader, navigate]);
  useWorkspaceChrome({ title: !inDialog && mesHeader?.url === url ? mesHeader.title : undefined,
    description: mesHeader?.description, backLabel: "schermata precedente", onBack: goBackInMes, priority: 10 });

  useEffect(() => {
    if (authLoading || !accessToken || !allowed || !screenCode) return undefined;
    // A refreshed Workspace token must not recreate an already authenticated
    // MES iframe, discard its circuit and load the entire planning again.
    if (connection.requestKey === requestKey && connection.url) return undefined;
    const controller = new AbortController();
    requestProgremesNavigation(accessToken, { screenCode, search, sessionKey, signal: controller.signal })
      .then((nextUrl) => {
        if (!controller.signal.aborted) setConnection({ requestKey, url: nextUrl, error: "" });
      })
      .catch((error) => {
        if (!controller.signal.aborted) setConnection({ requestKey, url: "", error: error.message || "Collegamento a ProgreMES non riuscito." });
      });
    return () => controller.abort();
  }, [accessToken, allowed, authLoading, screenCode, search, sessionKey, requestKey, connection.requestKey, connection.url]);

  useEffect(() => {
    if (!url) return undefined;
    const origin = new URL(url).origin;
    const receive = (event) => {
      if (event.data.type === "progremes-planning-fullscreen") {
        setPlanningView({ screenCode, fullscreen: event.data.active });
        return;
      }
      if (event.data.type === 'progremes-production-changed') {
        window.dispatchEvent(new Event('workspace:production-changed')); return;
      }
      if (event.data.type === 'progremes-batch-activities') { setBatchActivities(batchActivitiesMessage(event.data)); return; }
      if (event.data.type === "progremes-filling-activity") { setFillingActivity(fillingActivityMessage(event.data)); return; }
      if (event.data.type === "progremes-open-assistant") {
        window.dispatchEvent(new CustomEvent('workspace:open-assistant'));
        return;
      }
      if (event.data.type === "progremes-page-header") {
        setMesHeader(current => current?.url === url && current.title === event.data.title && current.description === event.data.description && current.canGoBack === event.data.canGoBack
          ? current : { url, title: event.data.title, description: event.data.description, canGoBack: event.data.canGoBack });
        return;
      }
      if (event.data.type === "progremes-planning-applied") {
        void alignWorkspace();
        return;
      }
      if (event.data.type === "progremes-workspace-navigate") {
        const destination = progremesWorkspaceDestination(event.data);
        if (new URL(destination, window.location.origin).searchParams.get('destination') === 'station') {
          setStationPath(destination);
        } else if (event.data.popup === true) setPopupPath(destination);
        else navigate(progremesWorkspaceDestination(event.data));
        return;
      }
      if (event.data.type === "progremes-workspace-return") {
        navigate("/produzione", { replace: true });
      } else {
        const ready = event.data.type === "progremes-embedded-ready";
        if (ready) rememberProgremesSession(sessionKey);
        else if (event.data.type === "progremes-embedded-auth-error") forgetProgremesSession();
        setFrameStatus({ url, ready, error: ready ? "" : "Sessione MES non disponibile nella finestra Workspace. Premi Riprova per rinnovare l’accesso." });
      }
    };
    // Retry only the handshake when the load event precedes the MES listener.
    return observeProgremesFrame({ origin, getFrameWindow: () => frame.current?.contentWindow,
      onMessage: receive, onTimeout: () => setFrameStatus({ url, ready: false,
        error: "MES non ha confermato il collegamento integrato. Verifica che MES sia aggiornato e che il browser consenta la sessione incorporata.",
      }) });
  }, [url, navigate, sessionKey, screenCode, alignWorkspace]);

  const error = !authLoading && !allowed ? "Accesso al modulo ProgreMES non autorizzato."
    : !authLoading && !accessToken ? "Sessione Workspace non disponibile."
      : connection.requestKey === requestKey && connection.error ? connection.error
        : frameStatus.url === url ? frameStatus.error : "";
  const ready = Boolean(url && frameStatus.url === url && frameStatus.ready);
  if (!screenCode) return <Navigate to="/produzione" replace />;

  return <section style={["station-overview", "filling-overview"].includes(new URLSearchParams(search).get("destination")) ? { position: "fixed", inset: 0, zIndex: 1100, margin: 0, border: 0, borderRadius: 0, height: "100dvh", width: "100vw", background: "#020f17" } : undefined} className={`${inDialog ? "progremes-card-frame" : "progremes-workspace-frame"}${["progremes.Planning", "progremes.PlanningProduction"].includes(screenCode) ? " progremes-planning-frame" : ""}${planningFullscreen ? " progremes-planning-fullscreen" : ""}`}>
    {stationPath && <StationUiPopup station={new URL(stationPath, window.location.origin).searchParams.get("station")} onClose={() => setStationPath("")}><ProgreMesLaunch key={stationPath} screenCode="progremes.PlanningProduction" search={new URL(stationPath, window.location.origin).search} inDialog /></StationUiPopup>}
    {fillingActivity && <PackagingActivityDialog activity={fillingActivity} onClose={() => setFillingActivity(null)} onStarted={() => setFillingActivity(current => current ? {...current, stato: "In Lavorazione"} : current)}/> }
    {batchActivities && <BatchActivitiesDialog activities={batchActivities} onClose={() => {
      setBatchActivities(null);
      if (url) frame.current?.contentWindow?.postMessage({ type: 'workspace-mes-refresh-planning' }, new URL(url).origin);
    }} onChanged={() => {
      window.dispatchEvent(new Event('workspace:production-changed'));
      if (url) frame.current?.contentWindow?.postMessage({ type: 'workspace-mes-refresh-planning' }, new URL(url).origin);
    }}/>}
    {popupPath && <PlanningActionModal path={popupPath} onClose={() => { setPopupPath(""); if (url) frame.current?.contentWindow?.postMessage({ type: "workspace-mes-refresh-planning" }, new URL(url).origin); }} onNavigate={setPopupPath} />}
    {(syncError || syncing || syncComplete) && <div className="progremes-frame-status" role={syncError ? "alert" : "status"}>{syncError || (syncing ? "Piano salvato in MES. Allineamento Workspace in corso…" : "Piano salvato e Workspace allineato correttamente.")}{syncResolution && <button type="button" onClick={() => setPopupPath(syncResolution.path)}>{syncResolution.label}</button>}{syncError && <button type="button" disabled={syncing} onClick={alignWorkspace}>Riprova allineamento</button>}</div>}
    {(!ready || error) && <div className="progremes-frame-status" role={error ? "alert" : "status"}>
      <h2>{error ? "Collegamento non disponibile" : "Apertura schermata MES..."}</h2>
      <p>{error || "Collegamento automatico alla schermata richiesta."}</p>
      {error && allowed && accessToken && <button type="button" className="primary-action" onClick={() => { forgetProgremesSession(); setRetry((value) => value + 1); }}><RefreshCw size={18} />Riprova</button>}
    </div>}
    {url && <iframe ref={frame} key={url} src={url} data-assistant-mes-frame="true" title="Schermata MES integrata in Workspace"
      className={ready && !error ? "is-ready" : "is-connecting"} referrerPolicy="no-referrer" allowFullScreen
      sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-modals allow-popups allow-popups-to-escape-sandbox"
      onLoad={() => frame.current?.contentWindow?.postMessage({ type: "workspace-mes-connect", unifiedChrome: true }, new URL(url).origin)} />}
  </section>;
}
