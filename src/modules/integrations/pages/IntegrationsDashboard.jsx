import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, Bot, Database, FileCog, PlugZap, ShoppingCart, UserRound } from "lucide-react";
import ModuleContainerLayout from "../../../components/ModuleContainerLayout";
import { getModuleIcon } from "../../../config/moduleIcons";
import { useAuth } from "../../../contexts/AuthContext";
import { supabase } from "../../../lib/supabaseClient";

const SCREEN_ICONS = Object.freeze({
  "integrazioni.mexal": Database,
  "integrazioni.mexal_agenti": UserRound,
  "integrazioni.serie_documenti": FileCog,
  "integrazioni.ordini_pr": ShoppingCart,
  "integrazioni.ordini_ph": ShoppingCart,
  "integrazioni.ordini_private": ShoppingCart,
  "integrazioni.documentale": Archive,
  "integrazioni.progremes": Bot,
});

export default function IntegrationsDashboard() {
  const { hasPermission, hasScreenAccess, isAdminUser } = useAuth();
  const [catalog, setCatalog] = useState({ module: null, screens: [], links: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadSections = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [moduleResult, screensResult, linksResult] = await Promise.all([
        supabase.from("workspace_moduli").select("codice,nome,descrizione,icona").eq("codice", "integrazioni").eq("attivo", true).maybeSingle(),
        supabase.from("workspace_schermate").select("codice,nome,descrizione,percorso,attiva,icona,metadati").eq("attiva", true),
        supabase.from("workspace_moduli_schermate").select("schermata_codice,ordine,visibile_menu").eq("modulo_codice", "integrazioni").eq("visibile_menu", true).order("ordine"),
      ]);
      const loadError = moduleResult.error || screensResult.error || linksResult.error;
      if (loadError) throw loadError;
      setCatalog({ module: moduleResult.data, screens: screensResult.data || [], links: linksResult.data || [] });
    } catch (loadError) {
      setError(loadError?.message || "Caricamento delle integrazioni non riuscito.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadSections(), 0);
    const refresh = () => void loadSections();
    window.addEventListener("workspace:module-catalog-changed", refresh);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("workspace:module-catalog-changed", refresh);
    };
  }, [loadSections]);

  const sections = useMemo(() => {
    const screenByCode = new Map(catalog.screens.map((screen) => [screen.codice, screen]));
    return catalog.links
      .map((link) => ({ ...screenByCode.get(link.schermata_codice), ordine: link.ordine }))
      .filter((screen) => screen.codice && screen.metadati?.kind !== "topic")
      .filter((screen) => hasScreenAccess(screen.codice, "integrazioni"))
      .filter((screen) => {
        const required = Array.isArray(screen.metadati?.required_permissions) ? screen.metadati.required_permissions : [];
        return isAdminUser || !required.length || required.some((permission) => hasPermission(permission));
      });
  }, [catalog.links, catalog.screens, hasPermission, hasScreenAccess, isAdminUser]);

  const ModuleIcon = getModuleIcon(catalog.module?.icona, PlugZap);

  return <ModuleContainerLayout
    icon={ModuleIcon}
    eyebrow="Amministrazione Workspace"
    title={catalog.module?.nome || "Integrazioni"}
    description={catalog.module?.descrizione || "Connessioni, sincronizzazioni e servizi esterni del Workspace."}
    items={sections.map((section) => ({
      code: section.codice,
      name: section.nome,
      description: section.descrizione,
      to: section.percorso,
      icon: getModuleIcon(section.icona,SCREEN_ICONS[section.codice] || PlugZap),
    }))}
    loading={loading}
    error={error}
    onRetry={loadSections}
    ariaLabel="Aree delle integrazioni"
    emptyTitle="Nessuna integrazione disponibile"
    emptyDescription="Il modulo è attivo, ma non contiene schermate visibili per questo utente."
  />;
}
