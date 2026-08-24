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

  const [catalogAllowed, setCatalogAllowed] = useState(screenCode ? null : true);

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
      if (active) setCatalogAllowed(!screenResult.error && !linkResult.error && Boolean(screenResult.data) && Boolean(linkResult.data));
    };
    void verify();
    const refresh = () => void verify();
    window.addEventListener("workspace:module-catalog-changed", refresh);
    return () => {
      active = false;
      window.removeEventListener("workspace:module-catalog-changed", refresh);
    };
  }, [moduleCode, screenCode]);

  if (catalogAllowed === null) return <div className="workspace-route-loading">Verifica autorizzazioni...</div>;
  const allowed = moduleAllowed && catalogAllowed && (!screenCode || hasScreenAccess(screenCode, moduleCode));
  return allowed ? children : <Navigate to={redirectTo} replace />;
}
