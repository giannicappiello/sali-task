import { useCallback, useEffect, useMemo, useState } from "react";
import { BellRing, Blocks, Bot, ClipboardList, Eye, FileText, FolderTree, Settings, SlidersHorizontal, Stethoscope, UserRound } from "lucide-react";
import { Navigate } from "react-router-dom";
import ModuleContainerLayout from "../../components/ModuleContainerLayout";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabaseClient";
import { getModuleIcon } from "../../config/moduleIcons";

const FALLBACK_SECTIONS = Object.freeze([
  { codice: "impostazioni.utenti_accessi", nome: "Utenti e accessi", descrizione: "Dati, sicurezza, organizzazione, eccezioni personali e AI.", percorso: "/settings/users", ordine: 10, metadati: { admin_only: true } },
  { codice: "impostazioni.regole_accesso", nome: "Regole e profili di accesso", descrizione: "Profili, ruoli, aree, reparti e livelli operativi.", percorso: "/settings/access-rules", ordine: 20, metadati: { admin_only: true } },
  { codice: "impostazioni.verifica_accessi", nome: "Verifica accessi", descrizione: "Simula ciò che un utente vede e spiega ogni autorizzazione.", percorso: "/settings/access-check", ordine: 30, metadati: { admin_only: true } },
  { codice: "impostazioni.progetti", nome: "Voci di progetto", descrizione: "Checklist, tipi e regole dei progetti.", percorso: "/settings/projects", ordine: 40, metadati: { required_permissions: ["settings.manage"] } },
  { codice: "impostazioni.moduli", nome: "Moduli e schermate", descrizione: "Catalogo e composizione dei moduli Workspace e ProgreMES.", percorso: "/settings/modules", ordine: 50, metadati: { admin_only: true } },
  { codice: "impostazioni.menu", nome: "Aree e menu", descrizione: "Aree di accesso e composizione personalizzata del menu Workspace.", percorso: "/settings/menu", ordine: 45, metadati: { admin_only: true } },
  { codice: "impostazioni.ai", nome: "Configurazione AI", descrizione: "Capacità, accessi, Web e limiti dell’assistente.", percorso: "/settings/ai", ordine: 50, metadati: { required_permissions: ["settings.manage"] } },
  { codice: "impostazioni.intestazioni_aziendali", nome: "Intestazioni aziendali", descrizione: "Archivio ufficiale, versioni e associazioni dei modelli documentali.", percorso: "/settings/company-letterheads", ordine: 55, metadati: { required_permissions: ["settings.manage"] } },
  { codice: "impostazioni.notifiche", nome: "Notifiche", descrizione: "Dispositivi, suoni, preferenze ed eventi.", percorso: "/settings/notifications", ordine: 60 },
  { codice: "impostazioni.diagnostica_mexal", nome: "Diagnostica Mexal", descrizione: "Controlli tecnici e verifica delle sincronizzazioni Mexal.", percorso: "/settings/mexal-diagnostics", ordine: 70, metadati: { required_permissions: ["settings.manage"] } },
]);

const ICON_BY_CODE = Object.freeze({
  "impostazioni.utenti_accessi": UserRound,
  "impostazioni.regole_accesso": SlidersHorizontal,
  "impostazioni.verifica_accessi": Eye,
  "impostazioni.progetti": ClipboardList,
  "impostazioni.moduli": Blocks,
  "impostazioni.menu": FolderTree,
  "impostazioni.ai": Bot,
  "impostazioni.intestazioni_aziendali": FileText,
  "impostazioni.notifiche": BellRing,
  "impostazioni.diagnostica_mexal": Stethoscope,
});

export default function SettingsHub() {
  const { hasPermission, hasScreenAccess, isAdminUser } = useAuth();
  const [catalog, setCatalog] = useState({ moduleExists: false, screens: [], links: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const canOpenSettings = isAdminUser || hasPermission("settings.manage") || hasPermission("users.manage");

  const loadSections = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [moduleResult, screensResult, linksResult] = await Promise.all([
        supabase.from("workspace_moduli").select("codice").eq("codice", "impostazioni").maybeSingle(),
        supabase.from("workspace_schermate").select("codice,nome,descrizione,percorso,attiva,ordine,icona,metadati").eq("attiva", true),
        supabase.from("workspace_moduli_schermate").select("schermata_codice,ordine,visibile_menu").eq("modulo_codice", "impostazioni").eq("visibile_menu", true).order("ordine"),
      ]);
      const loadError = moduleResult.error || screensResult.error || linksResult.error;
      if (loadError) throw loadError;
      setCatalog({ moduleExists: Boolean(moduleResult.data), screens: screensResult.data || [], links: linksResult.data || [] });
    } catch (loadError) {
      setError(loadError?.message || "Caricamento delle impostazioni non riuscito.");
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
    const configured = catalog.moduleExists
      ? catalog.links.map((link) => ({ ...catalog.screens.find((screen) => screen.codice === link.schermata_codice), ordine: link.ordine }))
      : FALLBACK_SECTIONS;
    return configured
      .filter((screen) => screen.codice && screen.codice !== "impostazioni" && screen.percorso !== "/settings")
      .filter((screen) => hasScreenAccess(screen.codice, "impostazioni"))
      .filter((screen) => !screen.metadati?.admin_only || isAdminUser)
      .filter((screen) => {
        const required = Array.isArray(screen.metadati?.required_permissions) ? screen.metadati.required_permissions : [];
        return !required.length || isAdminUser || required.some((permission) => hasPermission(permission));
      })
      .toSorted((left, right) => (left.ordine || 0) - (right.ordine || 0));
  }, [catalog, hasPermission, hasScreenAccess, isAdminUser]);

  if (!canOpenSettings) return <Navigate to="/home" replace />;

  return <ModuleContainerLayout
    icon={Settings}
    eyebrow="Amministrazione Workspace"
    title="Impostazioni"
    description="Accedi alle aree di configurazione autorizzate. La composizione di questo modulo è gestita dal catalogo moduli e schermate."
    items={sections.map((section) => ({ code: section.codice, name: section.nome, description: section.descrizione, to: section.percorso, icon:getModuleIcon(section.icona,ICON_BY_CODE[section.codice] || Settings) }))}
    loading={loading}
    error={error}
    onRetry={loadSections}
    ariaLabel="Aree delle impostazioni"
    emptyTitle="Nessuna area configurata"
    emptyDescription="Associa almeno una schermata al modulo Impostazioni dal catalogo amministrativo."
  />;
}
