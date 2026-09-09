import { useEffect, useRef, useState } from "react";
import { Factory, RefreshCw } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { isProgremesPopup, openPendingProgremesWindow } from "./progremesWindow";

async function requestProgremesAccess(accessToken) {
  const response = await fetch("/api/mexal/automation", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "progremes_sso" }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.url) throw new Error(payload.error || "Impossibile avviare ProgreMES.");
  return payload.url;
}

export default function ProgreMesLaunch() {
  const { session, hasModuleAccess } = useAuth();
  const accessToken = session?.access_token;
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const launched = useRef(false);
  const dedicatedWindow = isProgremesPopup(window.location.search);

  async function launch() {
    setLoading(true);
    setError("");
    let popup;
    try {
      if (!hasModuleAccess("progremes")) throw new Error("Accesso al modulo ProgreMES non autorizzato.");
      if (!accessToken) throw new Error("Sessione Workspace non disponibile.");
      popup = openPendingProgremesWindow();
      popup.location.replace(await requestProgremesAccess(accessToken));
    } catch (launchError) {
      popup?.close();
      setError(launchError?.message || "Impossibile avviare ProgreMES.");
      setLoading(false);
    }
  }

  useEffect(() => {
    if (launched.current || !accessToken || !dedicatedWindow) return;
    launched.current = true;
    requestProgremesAccess(accessToken)
      .then((url) => window.location.assign(url))
      .catch((launchError) => {
        setError(launchError?.message || "Impossibile avviare ProgreMES.");
        setLoading(false);
      });
  }, [accessToken, dedicatedWindow]);

  return (
    <div className="v4-page">
      <div className="panel" style={{ maxWidth: 620, margin: "48px auto", padding: 32, textAlign: "center" }}>
        <span style={{ width: 64, height: 64, margin: "0 auto 20px", borderRadius: 18, display: "grid", placeItems: "center", background: "#e0f2fe", color: "#075985" }}>
          <Factory size={32} />
        </span>
        <h2>{error ? "Accesso non riuscito" : dedicatedWindow && loading ? "Accesso a ProgreMES..." : "Apri ProgreMES in una nuova scheda"}</h2>
        <p className="muted">{error || (dedicatedWindow ? "Verifica dell'identità Workspace e apertura dell'ambiente di produzione." : "Workspace resterà aperto in questa scheda.")}</p>
        {(error || !dedicatedWindow) && <button type="button" className="primary-action" onClick={launch}><RefreshCw size={18} />{error ? "Riprova" : "Apri ProgreMES"}</button>}
      </div>
    </div>
  );
}
