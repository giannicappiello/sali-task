import { createElement, useEffect, useMemo, useState } from "react";
import { LayoutGrid } from "lucide-react";
import { Navigate, useLocation } from "react-router-dom";
import useBackNavigation from "../hooks/useBackNavigation";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabaseClient";
import { getModuleIcon } from "../config/moduleIcons";
import WorkspacePageHeader from "./WorkspacePageHeader";
import "./workspace-screen-layout.css";

const BUILT_IN_CONTAINER_PATHS = new Set([
  "/home",
  "/settings",
  "/analisi-dati",
  "/produzione",
  "/integrations",
  "/crm",
  "/crm/online",
]);

const isDynamicContainerPath = (pathname) => /^\/(?:menu|moduli)\/[^/]+$/.test(pathname);

export default function WorkspaceScreenLayout({ fallbackTitle, fallbackDescription, children }) {
  const location = useLocation();
  const { hasAreaAccess, hasModuleAccess, hasScreenAccess } = useAuth();
  const [catalog, setCatalog] = useState({ modules: [], screens: [], links: [] });

  useEffect(() => {
    let active = true;
    const load = async () => {
      const [modulesResult, screensResult, linksResult] = await Promise.all([
        supabase.from("workspace_moduli").select("codice,nome,descrizione,tipo,percorso,attivo,icona,area").eq("attivo", true),
        supabase.from("workspace_schermate").select("codice,nome,descrizione,percorso,attiva,area,icona").eq("attiva", true),
        supabase.from("workspace_moduli_schermate").select("modulo_codice,schermata_codice,predefinita"),
      ]);
      const error = modulesResult.error || screensResult.error || linksResult.error;
      if (error) throw error;
      if (active) setCatalog({ modules: modulesResult.data || [], screens: screensResult.data || [], links: linksResult.data || [] });
    };
    const refresh = () => void load().catch((error) => console.error("Errore caricamento layout schermata:", error));
    refresh();
    window.addEventListener("workspace:module-catalog-changed", refresh);
    return () => {
      active = false;
      window.removeEventListener("workspace:module-catalog-changed", refresh);
    };
  }, []);

  const presentation = useMemo(() => {
    const pathname = location.pathname.replace(/\/$/, "") || "/";
    const exactModule = catalog.modules.find((module) => (module.percorso || "").replace(/\/$/, "") === pathname);
    const exactScreen = catalog.screens.find((screen) => (screen.percorso || "").replace(/\/$/, "") === pathname);
    const isContainer = BUILT_IN_CONTAINER_PATHS.has(pathname)
      || isDynamicContainerPath(pathname)
      || (exactModule?.tipo === "contenitore" && !exactScreen);
    if (isContainer) return { container: true, denied: Boolean(exactModule && (!hasModuleAccess(exactModule.codice) || (exactModule.area && !hasAreaAccess(exactModule.area)))) };

    const screen = catalog.screens
      .filter((item) => item.percorso && (pathname === item.percorso || pathname.startsWith(`${item.percorso}/`)))
      .toSorted((left, right) => right.percorso.length - left.percorso.length)[0];
    const parentModules = screen
      ? catalog.links
        .filter((item) => item.schermata_codice === screen.codice)
        .map((link) => catalog.modules.find((module) => module.codice === link.modulo_codice))
        .filter(Boolean)
      : [];
    const contextualParent = location.state?.workspaceModuleCode
      ? parentModules.find((module) => module.codice === location.state.workspaceModuleCode)
      : null;
    const parentModule = contextualParent
      || parentModules
      .filter((module) => module.percorso && (pathname === module.percorso || pathname.startsWith(`${module.percorso}/`)))
      .toSorted((left, right) => right.percorso.length - left.percorso.length)[0]
      || parentModules.find((module) => module.tipo === "contenitore")
      || parentModules[0];
    const containerParent = catalog.modules
      .filter((module) => module.tipo === "contenitore" && module.percorso && module.percorso !== pathname && pathname.startsWith(`${module.percorso.replace(/\/$/, "")}/`))
      .toSorted((left, right) => right.percorso.length - left.percorso.length)[0];
    const navigationParent = parentModule?.percorso && parentModule.percorso !== pathname ? parentModule : containerParent;
    const parentPath = navigationParent?.percorso || "";

    return {
      container: false,
      denied: Boolean((screen && !hasScreenAccess(screen.codice, parentModule?.codice)) || (screen?.area && !hasAreaAccess(screen.area))),
      moduleTitle: parentModule?.nome || "Modulo Workspace",
      moduleDescription: parentModule?.descrizione || "Accedi alle funzioni disponibili in base alle tue autorizzazioni.",
      moduleIcon: parentModule?.icona || "",
      screenIcon: screen?.icona || "",
      title: screen?.nome || fallbackTitle || "Schermata Workspace",
      description: screen?.descrizione || fallbackDescription || "Funzioni e dati disponibili in base alle autorizzazioni dell’utente.",
      parentName: navigationParent?.nome || "",
      parentPath,
    };
  }, [catalog, fallbackDescription, fallbackTitle, hasAreaAccess, hasModuleAccess, hasScreenAccess, location.pathname, location.state]);
  const goBack = useBackNavigation(presentation.parentPath || "/home");
  const screenIcon = createElement(getModuleIcon(presentation.screenIcon, LayoutGrid), { size:29 });

  if (presentation.denied) return <Navigate to="/home" replace />;
  if (presentation.container) return children;

  return (
    <div className="workspace-screen-layout">
      <WorkspacePageHeader
        icon={screenIcon}
        backLabel={presentation.parentPath ? presentation.parentName : ""}
        onBack={presentation.parentPath ? goBack : undefined}
        title={presentation.title}
        description={presentation.description}
      />
      <div className="workspace-screen-content">{children}</div>
    </div>
  );
}
