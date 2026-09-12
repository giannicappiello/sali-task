import { useEffect, useMemo, useState } from "react";
import { LayoutGrid } from "lucide-react";
import { Navigate, useLocation, useParams } from "react-router-dom";
import ModuleContainerLayout from "../../components/ModuleContainerLayout";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabaseClient";
import { getModuleIcon } from "../../config/moduleIcons";
import { requestProgremesWorkspaceWindow } from "../ProgreMes/progremesWindow";

export default function WorkspaceModuleContainer() {
  const { moduleCode = "" } = useParams();
  const location = useLocation();
  const { profile, hasModuleAccess, hasScreenAccess, getModuleScreenGrant, canUseModule, canUseScreen, isAdminUser } = useAuth();
  const departmentIds = useMemo(() => profile?.reparto_ids || [], [profile?.reparto_ids]);
  const [catalog, setCatalog] = useState({ module: null, screens: [], links: [], progremesAccess: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const allowed = hasModuleAccess(moduleCode) || Boolean(getModuleScreenGrant(moduleCode));

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const queries = [
          supabase.from("workspace_moduli").select("codice,nome,descrizione,attivo,tipo,icona").eq("codice", moduleCode).eq("attivo", true).maybeSingle(),
          supabase.from("workspace_schermate").select("codice,nome,descrizione,provider,percorso,attiva,area,icona,metadati").eq("attiva", true),
          supabase.from("workspace_moduli_schermate").select("schermata_codice,ordine,visibile_menu").eq("modulo_codice", moduleCode).eq("visibile_menu", true).order("ordine"),
        ];
        if (!isAdminUser && departmentIds.length) queries.push(supabase.from("progremes_reparti_moduli").select("modulo_codice").in("reparto_id", departmentIds));
        const [moduleResult, screensResult, linksResult, progremesResult] = await Promise.all(queries);
        const loadError = moduleResult.error || screensResult.error || linksResult.error || progremesResult?.error;
        if (loadError) throw loadError;
        if (active) setCatalog({ module: moduleResult.data, screens: screensResult.data || [], links: linksResult.data || [], progremesAccess: (progremesResult?.data || []).map((row) => row.modulo_codice) });
      } catch (loadError) {
        if (active) setError(loadError?.message || "Caricamento del modulo non riuscito.");
      } finally {
        if (active) setLoading(false);
      }
    }
    const timer = window.setTimeout(() => void load(), 0);
    const refresh = () => void load();
    window.addEventListener("workspace:module-catalog-changed", refresh);
    return () => {
      active = false;
      window.clearTimeout(timer);
      window.removeEventListener("workspace:module-catalog-changed", refresh);
    };
  }, [departmentIds, isAdminUser, moduleCode]);

  const screens = useMemo(() => {
    const screenByCode = new Map(catalog.screens.map((screen) => [screen.codice, screen]));
    const allowedProgremes = new Set(catalog.progremesAccess);
    return catalog.links
      .map((link) => ({ ...screenByCode.get(link.schermata_codice), ordine: link.ordine }))
      .filter((screen) => screen.codice && screen.metadati?.kind !== "topic")
      .filter((screen) => hasScreenAccess(screen.codice, moduleCode))
      .filter((screen) => !screen.metadati?.admin_only || isAdminUser)
      .filter((screen) => {
        if (!canUseScreen(screen.codice, "lettura")) return false;
        const sourceModule = String(screen.metadati?.source_module || screen.metadati?.required_module || "").trim();
        if (sourceModule && !canUseScreen(screen.codice, "lettura")) return false;
        if (screen.provider !== "progremes") return true;
        const externalCode = screen.metadati?.external_code || screen.codice.replace(/^progremes\./, "");
        return hasModuleAccess("progremes") && canUseModule("progremes", "lettura") && (isAdminUser || allowedProgremes.has(externalCode));
      });
  }, [canUseModule, canUseScreen, catalog.links, catalog.progremesAccess, catalog.screens, hasModuleAccess, hasScreenAccess, isAdminUser, moduleCode]);

  const ModuleIcon = getModuleIcon(catalog.module?.icona, LayoutGrid);

  if (!loading && !allowed) return <Navigate to="/home" replace />;

  return <ModuleContainerLayout
    icon={ModuleIcon}
    title={catalog.module?.nome || "Modulo"}
    description={catalog.module?.descrizione || "Accedi alle aree disponibili in base alle tue autorizzazioni."}
    items={screens.map((screen) => ({ code: screen.codice, name: screen.nome, description: screen.descrizione, to: screen.percorso, onOpen: screen.provider === "progremes" ? () => requestProgremesWorkspaceWindow(screen.percorso) : undefined, state:{ workspaceMenuCode:location.state?.workspaceMenuCode || "",workspaceModuleCode:moduleCode }, icon:getModuleIcon(screen.icona,LayoutGrid) }))}
    loading={loading}
    loadingLabel="Caricamento aree disponibili..."
    error={error}
    onRetry={() => window.dispatchEvent(new CustomEvent("workspace:module-catalog-changed"))}
    ariaLabel="Aree del modulo"
    emptyDescription="Il modulo è attivo, ma non contiene aree visibili per questo utente."
  />;
}
