import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { openProgremesWorkspaceWindow, progremesWorkspaceDestination, requestProgremesNavigation } from "./progremesWindow";
import { observeProgremesFrame } from "./progremesHandshake";
import "./progremes-frame.css";
import PlanningActionModal from "./PlanningActionModal";
import { useWorkspaceChrome } from "../../components/workspaceChromeContext";

export default function ProgreMesLaunch({ screenCode = "", search = "", inDialog = false }) {
  const { session, hasModuleAccess, hasScreenAccess, loading: authLoading, authorizationRevision } = useAuth();
  const navigate = useNavigate();
  const accessToken = session?.access_token;
  const currentToken = useRef(accessToken);
  useEffect(() => { currentToken.current = accessToken; }, [accessToken]);
  const allowed = screenCode === "progremes.PlanningProduction"
    ? hasScreenAccess(screenCode)
    : hasModuleAccess("progremes");
  const frame = useRef(null);
  const [popupPath, setPopupPath] = useState("");
  const [retry, setRetry] = useState(0);
  const [connection, setConnection] = useState({ requestKey: "", url: "", error: "" });
  const [frameStatus, setFrameStatus] = useState({ url: "", ready: false, error: "" });
  const [syncError, setSyncError] = useState("");
  const [mesHeader, setMesHeader] = useState(null);
  const requestKey = JSON.stringify([session?.user?.id, authorizationRevision, screenCode, search, retry]);
  const url = allowed && accessToken && connection.requestKey === requestKey ? connection.url : "";
  const goBackInMes = useCallback(() => {
    if (url && mesHeader?.url === url && mesHeader.canGoBack) frame.current?.contentWindow?.postMessage({ type: "workspace-mes-back" }, new URL(url).origin);
    else navigate("/produzione");
  }, [url, mesHeader, navigate]);
  useWorkspaceChrome({ title: mesHeader?.url === url ? mesHeader.title : undefined,
    description: mesHeader?.description, backLabel: "schermata precedente", onBack: goBackInMes, priority: 10 });

  useEffect(() => {
    if (authLoading || !accessToken || !allowed || !screenCode) return undefined;
    // A refreshed Workspace token must not recreate an already authenticated
    // MES iframe, discard its circuit and load the entire planning again.
    if (connection.requestKey === requestKey && connection.url) return undefined;
    const controller = new AbortController();
    requestProgremesNavigation(accessToken, { screenCode, search, signal: controller.signal })
      .then((nextUrl) => {
        if (!controller.signal.aborted) setConnection({ requestKey, url: nextUrl, error: "" });
      })
      .catch((error) => {
        if (!controller.signal.aborted) setConnection({ requestKey, url: "", error: error.message || "Collegamento a ProgreMES non riuscito." });
      });
    return () => controller.abort();
  }, [accessToken, allowed, authLoading, screenCode, search, requestKey, connection.requestKey, connection.url]);

  useEffect(() => {
    if (!url) return undefined;
    const origin = new URL(url).origin;
    const receive = (event) => {
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
        setSyncError("");
        fetch("/api/workspace/planning", { method: "POST", headers: { Authorization: `Bearer ${currentToken.current}`, "Content-Type": "application/json" }, body: JSON.stringify({ action: "planning_reconcile" }) })
          .then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error || "Allineamento non riuscito"); })
          .catch(() => setSyncError("Piano salvato in MES. Completa l’allineamento da Versioni e revisioni del piano con Allinea stato Workspace; non ripetere la generazione."));
        return;
      }
      if (event.data.type === "progremes-workspace-navigate") {
        const destination = progremesWorkspaceDestination(event.data);
        if (new URL(destination, window.location.origin).searchParams.get('destination') === 'station') {
          try { openProgremesWorkspaceWindow(destination); }
          catch (error) { setSyncError(error.message); }
        } else if (event.data.popup === true) setPopupPath(destination);
        else navigate(progremesWorkspaceDestination(event.data));
        return;
      }
      if (event.data.type === "progremes-workspace-return") {
        navigate("/produzione", { replace: true });
      } else {
        const ready = event.data.type === "progremes-embedded-ready";
        setFrameStatus({ url, ready, error: ready ? "" : "Sessione MES non disponibile nella finestra Workspace. Premi Riprova per rinnovare l’accesso." });
      }
    };
    // Retry only the handshake when the load event precedes the MES listener.
    return observeProgremesFrame({ origin, getFrameWindow: () => frame.current?.contentWindow,
      onMessage: receive, onTimeout: () => setFrameStatus({ url, ready: false,
        error: "MES non ha confermato il collegamento integrato. Verifica che MES sia aggiornato e che il browser consenta la sessione incorporata.",
      }) });
  }, [url, navigate]);

  const error = !authLoading && !allowed ? "Accesso al modulo ProgreMES non autorizzato."
    : !authLoading && !accessToken ? "Sessione Workspace non disponibile."
      : connection.requestKey === requestKey && connection.error ? connection.error
        : frameStatus.url === url ? frameStatus.error : "";
  const ready = Boolean(url && frameStatus.url === url && frameStatus.ready);
  if (!screenCode) return <Navigate to="/produzione" replace />;

  return <section className={`${inDialog ? "progremes-card-frame" : "progremes-workspace-frame"}${["progremes.Planning", "progremes.PlanningProduction"].includes(screenCode) ? " progremes-planning-frame" : ""}`}>
    {popupPath && <PlanningActionModal path={popupPath} onClose={() => { setPopupPath(""); if (url) frame.current?.contentWindow?.postMessage({ type: "workspace-mes-refresh-planning" }, new URL(url).origin); }} onNavigate={setPopupPath} />}
    {syncError && <div className="progremes-frame-status" role="alert">{syncError}</div>}
    {(!ready || error) && <div className="progremes-frame-status" role={error ? "alert" : "status"}>
      <h2>{error ? "Collegamento non disponibile" : "Apertura schermata MES..."}</h2>
      <p>{error || "Collegamento automatico alla schermata richiesta."}</p>
      {error && allowed && accessToken && <button type="button" className="primary-action" onClick={() => setRetry((value) => value + 1)}><RefreshCw size={18} />Riprova</button>}
    </div>}
    {url && <iframe ref={frame} key={url} src={url} data-assistant-mes-frame="true" title="Schermata MES integrata in Workspace"
      className={ready && !error ? "is-ready" : "is-connecting"} referrerPolicy="no-referrer" allowFullScreen
      sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-modals allow-popups"
      onLoad={() => frame.current?.contentWindow?.postMessage({ type: "workspace-mes-connect", unifiedChrome: true }, new URL(url).origin)} />}
  </section>;
}
