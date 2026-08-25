import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabaseClient";

export default function WorkspaceAccessGuard({ moduleCode, screenCode, featureCode, redirectTo = "/home", children }) {
  const { hasModuleAccess, hasScreenAccess, hasWorkspaceFeature } = useAuth();
  const moduleAllowed = moduleCode
    ? hasModuleAccess(moduleCode)
    : featureCode
      ? hasWorkspaceFeature(featureCode)
      : false;

  const [catalogState, setCatalogState] = useState(screenCode ? "checking" : "available");

  useEffect(() => {
    if (!screenCode) return undefined;
    let active = true;
    const verify = async () => {
      const [screenResult, linkResult] = await Promise.all([
        supabase.from("workspace_schermate").select("codice,attiva").eq("codice", screenCode).eq("attiva", true).maybeSingle(),
        moduleCode
          ? supabase.from("workspace_moduli_schermate").select("schermata_codice").eq("modulo_codice", moduleCode).eq("schermata_codice", screenCode).maybeSingle()
          : Promise.resolve({ data: true, error: null }),
      ]);
      if (!active) return;
      if (screenResult.error || linkResult.error) setCatalogState("error");
      else if (!screenResult.data || !linkResult.data) setCatalogState("missing");
      else setCatalogState("available");
    };
    void verify();
    const refresh = () => void verify();
    window.addEventListener("workspace:module-catalog-changed", refresh);
    return () => {
      active = false;
      window.removeEventListener("workspace:module-catalog-changed", refresh);
    };
  }, [moduleCode, screenCode]);

  if (!moduleAllowed || (screenCode && catalogState === "available" && !hasScreenAccess(screenCode, moduleCode))) {
    return <Navigate to={redirectTo} replace />;
  }
  if (catalogState === "checking") return <div className="workspace-route-loading">Verifica autorizzazioni...</div>;
  if (catalogState !== "available") {
    return (
      <section className="workspace-route-error" role="alert">
        <h2>Schermata Workspace non configurata</h2>
        <p>{catalogState === "error" ? "Il catalogo non è al momento verificabile." : `La schermata ${screenCode} non è collegata al modulo ${moduleCode}.`}</p>
      </section>
    );
  }
  return children;
}
