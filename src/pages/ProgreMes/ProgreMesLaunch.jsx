import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { isProgremesFrameMessage, requestProgremesNavigation } from "./progremesWindow";
import "./progremes-frame.css";

export default function ProgreMesLaunch({ screenCode = "", search = "" }) {
  const { session, hasModuleAccess, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const accessToken = session?.access_token;
  const allowed = hasModuleAccess("progremes");
  const frame = useRef(null);
  const [retry, setRetry] = useState(0);
  const [connection, setConnection] = useState({ requestKey: "", url: "", error: "" });
  const [frameStatus, setFrameStatus] = useState({ url: "", ready: false, error: "" });
  const requestKey = JSON.stringify([screenCode, search, retry]);
  const url = connection.requestKey === requestKey ? connection.url : "";

  useEffect(() => {
    if (authLoading || !accessToken || !allowed || !screenCode) return undefined;
    const controller = new AbortController();
    requestProgremesNavigation(accessToken, { screenCode, search, signal: controller.signal })
      .then((nextUrl) => {
        if (!controller.signal.aborted) setConnection({ requestKey, url: nextUrl, error: "" });
      })
      .catch((error) => {
        if (!controller.signal.aborted) setConnection({ requestKey, url: "", error: error.message || "Collegamento a ProgreMES non riuscito." });
      });
    return () => controller.abort();
  }, [accessToken, allowed, authLoading, screenCode, search, requestKey]);

  useEffect(() => {
    if (!url) return undefined;
    const origin = new URL(url).origin;
    const timer = window.setTimeout(() => setFrameStatus({
      url, ready: false, error: "MES non ha confermato il collegamento integrato. Verifica che MES sia aggiornato e che il browser consenta la sessione incorporata.",
    }), 30000);
    const receive = (event) => {
      if (!isProgremesFrameMessage(event, frame.current?.contentWindow, origin)) return;
      window.clearTimeout(timer);
      if (event.data.type === "progremes-workspace-return") {
        navigate("/produzione", { replace: true });
      } else {
        const ready = event.data.type === "progremes-embedded-ready";
        setFrameStatus({ url, ready, error: ready ? "" : "Sessione MES non disponibile nella finestra Workspace. Premi Riprova per rinnovare l’accesso." });
      }
    };
    window.addEventListener("message", receive);
    return () => { window.clearTimeout(timer); window.removeEventListener("message", receive); };
  }, [url, navigate]);

  const error = !authLoading && !allowed ? "Accesso al modulo ProgreMES non autorizzato."
    : !authLoading && !accessToken ? "Sessione Workspace non disponibile."
      : connection.requestKey === requestKey && connection.error ? connection.error
        : frameStatus.url === url ? frameStatus.error : "";
  const ready = Boolean(url && frameStatus.url === url && frameStatus.ready);
  if (!screenCode) return <Navigate to="/produzione" replace />;

  return <section className="progremes-workspace-frame">
    {(!ready || error) && <div className="progremes-frame-status" role={error ? "alert" : "status"}>
      <h2>{error ? "Collegamento non disponibile" : "Apertura schermata MES..."}</h2>
      <p>{error || "Collegamento automatico alla schermata richiesta."}</p>
      {error && allowed && accessToken && <button type="button" className="primary-action" onClick={() => setRetry((value) => value + 1)}><RefreshCw size={18} />Riprova</button>}
    </div>}
    {url && <iframe ref={frame} key={url} src={url} title="Schermata MES integrata in Workspace"
      className={ready && !error ? "is-ready" : "is-connecting"} referrerPolicy="no-referrer"
      sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-modals allow-popups"
      onLoad={() => frame.current?.contentWindow?.postMessage({ type: "workspace-mes-connect" }, new URL(url).origin)} />}
  </section>;
}
