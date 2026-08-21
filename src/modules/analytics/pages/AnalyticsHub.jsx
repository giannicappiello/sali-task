import { useEffect, useMemo, useState } from "react";
import { Activity, BarChart3, CalendarHeart, FileText, LayoutGrid, ShoppingCart } from "lucide-react";
import ModuleContainerLayout from "../../../components/ModuleContainerLayout";
import { getModuleIcon } from "../../../config/moduleIcons";
import { useAuth } from "../../../contexts/AuthContext";
import { supabase } from "../../../lib/supabaseClient";

const SCREEN_PRESENTATION = Object.freeze({
  "analisi.fatture": { icon: FileText },
  "analisi.ordini_ph": { icon: ShoppingCart },
  "analisi.beauty_days": { icon: CalendarHeart },
  "analisi.attivita": { icon: Activity },
});

export default function AnalyticsHub() {
  const { profile, hasModuleAccess, hasAreaAccess, hasScreenAccess, canUseModule, isAdminUser } = useAuth();
  const departmentIds = useMemo(() => profile?.reparto_ids || [], [profile?.reparto_ids]);
  const [catalog, setCatalog] = useState({ screens: [], links: [], progremesAccess: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadCards() {
      const queries = [
        supabase.from("workspace_schermate").select("codice,nome,descrizione,provider,percorso,metadati,attiva,area,icona").eq("attiva", true),
        supabase.from("workspace_moduli_schermate").select("schermata_codice,ordine,visibile_menu").eq("modulo_codice", "analisi_dati").eq("visibile_menu", true).order("ordine"),
      ];
      if (!isAdminUser && departmentIds.length) {
        queries.push(supabase.from("progremes_reparti_moduli").select("modulo_codice").in("reparto_id", departmentIds));
      }
      const [screensResult, linksResult, progremesResult] = await Promise.all(queries);
      const loadError = screensResult.error || linksResult.error || progremesResult?.error;
      if (loadError) throw loadError;
      if (active) {
        setCatalog({
          screens: screensResult.data || [],
          links: linksResult.data || [],
          progremesAccess: (progremesResult?.data || []).map((row) => row.modulo_codice),
        });
        setError("");
      }
    }

    const refresh = () => {
      if (active) setLoading(true);
      loadCards().catch((loadError) => {
        if (active) setError(loadError.message || "Impossibile caricare le aree del modulo.");
      }).finally(() => {
        if (active) setLoading(false);
      });
    };
    refresh();
    window.addEventListener("workspace:module-catalog-changed", refresh);
    return () => {
      active = false;
      window.removeEventListener("workspace:module-catalog-changed", refresh);
    };
  }, [departmentIds, isAdminUser]);

  const visibleCards = useMemo(() => {
    const screenByCode = new Map(catalog.screens.map((screen) => [screen.codice, screen]));
    const allowedProgremes = new Set(catalog.progremesAccess);
    return catalog.links
      .map((link) => ({ ...screenByCode.get(link.schermata_codice), ...link }))
      .filter((screen) => screen.codice && screen.metadati?.kind !== "topic" && screen.percorso !== "/analisi-dati")
      .filter((screen) => hasScreenAccess(screen.codice, "analisi_dati"))
      .filter((screen) => hasAreaAccess(screen.area))
      .filter((screen) => {
        if (screen.provider === "progremes") {
          const externalCode = screen.metadati?.external_code || screen.codice.replace(/^progremes\./, "");
          return hasModuleAccess("progremes")
            && canUseModule("progremes", "lettura")
            && (isAdminUser || allowedProgremes.has(externalCode));
        }
        const sourceModule = String(screen.metadati?.source_module || screen.metadati?.required_module || "").trim();
        if (sourceModule && !hasModuleAccess(sourceModule)) return false;
        if (sourceModule && !canUseModule(sourceModule, "lettura")) return false;
        return true;
      });
  }, [canUseModule, catalog.links, catalog.progremesAccess, catalog.screens, hasAreaAccess, hasModuleAccess, hasScreenAccess, isAdminUser]);

  return <ModuleContainerLayout
    icon={BarChart3}
    eyebrow="Analisi Workspace"
    title="Analisi dati"
    description="Cruscotti, pivot ed esportazioni Excel dell’intero Workspace."
    items={visibleCards.map((screen) => ({
      code: screen.codice,
      name: screen.nome,
      description: screen.descrizione,
      to: screen.percorso,
      external: screen.provider === "progremes",
      icon: getModuleIcon(screen.icona,SCREEN_PRESENTATION[screen.codice]?.icon || LayoutGrid),
      onOpen: screen.provider === "progremes" ? () => window.dispatchEvent(new CustomEvent("workspace:launch-progremes", { detail: { screenCode: screen.codice } })) : undefined,
    }))}
    loading={loading}
    error={error}
    onRetry={() => window.dispatchEvent(new CustomEvent("workspace:module-catalog-changed"))}
    ariaLabel="Aree di analisi disponibili"
    emptyTitle="Nessuna analisi disponibile"
    emptyDescription="Non risultano analisi visibili in base ai moduli e alle autorizzazioni dell’utente."
  />;
}
