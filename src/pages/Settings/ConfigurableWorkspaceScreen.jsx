import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import WorkspaceScreenComposition from "../../components/WorkspaceScreenComposition";
import { supabase } from "../../lib/supabaseClient";

export default function ConfigurableWorkspaceScreen() {
  const { screenCode = "" } = useParams();
  const [state, setState] = useState({ loading: true, layout: null, error: "" });
  const load = useCallback(async () => {
    const [screenResult, layoutResult] = await Promise.all([
      supabase.from("workspace_schermate").select("codice,nome,attiva,chiave_componente").eq("codice", screenCode).eq("attiva", true).maybeSingle(),
      supabase.from("workspace_builder_layouts").select("layout").eq("target_type", "screen").eq("target_code", screenCode).maybeSingle(),
    ]);
    const error = screenResult.error || layoutResult.error;
    if (error) throw error;
    if (!screenResult.data || screenResult.data.chiave_componente !== "screen-builder") throw new Error("Schermata configurabile non disponibile.");
    setState({ loading: false, layout: layoutResult.data?.layout || { version: 1, blocks: [] }, error: "" });
  }, [screenCode]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load().catch((error) => setState({ loading: false, layout: null, error: error.message })), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  if (state.loading) return <div className="module-container-loading">Caricamento schermata…</div>;
  if (state.error) return <div className="module-message error">{state.error}</div>;
  return <WorkspaceScreenComposition layout={state.layout} />;
}
