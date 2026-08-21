import { useCallback, useEffect, useMemo, useState } from "react";
import { FolderTree } from "lucide-react";
import { Navigate, useParams } from "react-router-dom";
import ModuleContainerLayout from "../../components/ModuleContainerLayout";
import { getModuleIcon } from "../../config/moduleIcons";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabaseClient";

export default function WorkspaceMenuContainer() {
  const { menuCode = "" } = useParams();
  const { hasModuleAccess, hasWorkspaceFeature } = useAuth();
  const [catalog, setCatalog] = useState({ menu: null, modules: [], links: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [menuResult, modulesResult, linksResult] = await Promise.all([
        supabase.from("workspace_menu_voci").select("*").eq("codice", menuCode).eq("attiva", true).maybeSingle(),
        supabase.from("workspace_moduli").select("codice,nome,descrizione,percorso,provider,attivo,mostra_menu,icona,area"),
        supabase.from("workspace_menu_moduli").select("modulo_codice,ordine").eq("voce_codice", menuCode).order("ordine"),
      ]);
      const loadError = menuResult.error || modulesResult.error || linksResult.error;
      if (loadError) throw loadError;
      setCatalog({ menu: menuResult.data, modules: modulesResult.data || [], links: linksResult.data || [] });
    } catch (loadError) { setError(loadError.message || "Caricamento della voce di menu non riuscito."); }
    finally { setLoading(false); }
  }, [menuCode]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(),0);
    const refresh = () => void load();
    window.addEventListener("workspace:module-catalog-changed", refresh);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("workspace:module-catalog-changed", refresh);
    };
  }, [load]);

  const modules = useMemo(() => {
    const byCode = new Map(catalog.modules.map((module) => [module.codice,module]));
    return catalog.links.map((link) => byCode.get(link.modulo_codice))
      .filter((module) => module?.attivo && module.mostra_menu && (
        module.codice === "analisi_dati"
          ? hasWorkspaceFeature("analisi_dati")
          : hasModuleAccess(module.codice)
      ));
  }, [catalog.links,catalog.modules,hasModuleAccess,hasWorkspaceFeature]);

  if (!loading && !catalog.menu) return <Navigate to="/home" replace />;
  const MenuIcon = getModuleIcon(catalog.menu?.icona,FolderTree);
  return <ModuleContainerLayout icon={MenuIcon} eyebrow="Voce di menu" title={catalog.menu?.nome || "Menu"} description={catalog.menu?.descrizione || "Moduli disponibili in questa voce di menu."} items={modules.map((module) => ({ code:module.codice,name:module.nome,description:module.descrizione,to:module.percorso,state:{ workspaceMenuCode:menuCode,workspaceModuleCode:module.codice },icon:getModuleIcon(module.icona,FolderTree) }))} loading={loading} error={error} onRetry={load} ariaLabel="Moduli della voce di menu" emptyTitle="Nessun modulo disponibile" emptyDescription="Questa voce non contiene moduli visibili per il tuo profilo." />;
}
