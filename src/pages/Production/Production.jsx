import { useEffect, useRef, useState } from "react";
import { Factory, RefreshCw, Workflow } from "lucide-react";
import { useParams } from "react-router-dom";
import ModuleContainerLayout from "../../components/ModuleContainerLayout";
import { useAuth } from "../../contexts/AuthContext";
import useBackNavigation from "../../hooks/useBackNavigation";
import "./production.css";

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

function SectionLauncher({ sectionCode }) {
  const { session } = useAuth();
  const accessToken = session?.access_token;
  const [error, setError] = useState("");
  const launched = useRef(false);
  const goBack = useBackNavigation("/produzione");

  async function launch() {
    setError("");
    try {
      if (!accessToken) throw new Error("Sessione Workspace non disponibile.");
      const payload = await requestProgremes("progremes_sso", accessToken, { screenCode: sectionCode });
      if (!payload.url) throw new Error("Impossibile aprire l’area di produzione.");
      window.location.assign(payload.url);
    } catch (launchError) {
      setError(launchError?.message || "Collegamento alla gestione produzione non riuscito.");
    }
  }

  useEffect(() => {
    if (launched.current || !accessToken) return;
    launched.current = true;
    requestProgremes("progremes_sso", accessToken, { screenCode: sectionCode })
      .then((payload) => {
        if (!payload.url) throw new Error("Impossibile aprire l’area di produzione.");
        window.location.assign(payload.url);
      })
      .catch((launchError) => setError(launchError?.message || "Collegamento alla gestione produzione non riuscito."));
  }, [accessToken, sectionCode]);

  return (
    <div className="production-launch-state">
      <div className="production-launch-icon"><Factory size={32} /></div>
      <h2>{error ? "Apertura non riuscita" : "Apertura area di produzione..."}</h2>
      <p>{error || "Verifica dell’identità Workspace e collegamento sicuro in corso."}</p>
      {error ? <button type="button" className="primary-action" onClick={launch}><RefreshCw size={17} />Riprova</button> : <div className="auth-spinner" aria-label="Caricamento" />}
      <button type="button" onClick={goBack}>Torna a Gestione produzione</button>
    </div>
  );
}

export default function Production() {
  const { "*": sectionPath } = useParams();
  const { session } = useAuth();
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

  if (sectionPath) return <SectionLauncher sectionCode={decodeURIComponent(sectionPath)} />;

  return <ModuleContainerLayout
    icon={Workflow}
    eyebrow="Area operativa"
    title="Gestione produzione"
    description="Accedi direttamente alle sezioni autorizzate. Ogni area si apre autonomamente in una nuova scheda."
    items={sections.map((section) => ({ code: section.code, name: section.name, description: section.description, to: `/produzione/${encodeURIComponent(section.code)}`, external: true, icon: Factory }))}
    loading={loading}
    error={error}
    onRetry={loadSections}
    ariaLabel="Aree di produzione disponibili"
    emptyDescription="Non risultano ancora sezioni di produzione assegnate al tuo reparto."
  />;
}
