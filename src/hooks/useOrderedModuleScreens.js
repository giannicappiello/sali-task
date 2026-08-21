import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../contexts/AuthContext";
import { getModuleIcon } from "../config/moduleIcons";

export default function useOrderedModuleScreens(moduleCode, definitions) {
  const { hasAreaAccess } = useAuth();
  const [links, setLinks] = useState(null);

  useEffect(() => {
    let active = true;

    async function load() {
      const { data, error } = await supabase
        .from("workspace_moduli_schermate")
        .select("schermata_codice,ordine,predefinita,visibile_menu,workspace_schermate(area,icona)")
        .eq("modulo_codice", moduleCode)
        .eq("visibile_menu", true)
        .order("ordine");
      if (error) throw error;
      if (active) setLinks(data || []);
    }

    const refresh = () => void load().catch((error) => {
      console.error(`Errore caricamento ordine schermate ${moduleCode}:`, error);
      if (active) setLinks(null);
    });
    refresh();
    window.addEventListener("workspace:module-catalog-changed", refresh);
    return () => {
      active = false;
      window.removeEventListener("workspace:module-catalog-changed", refresh);
    };
  }, [moduleCode]);

  return useMemo(() => {
    if (!links) return { items: definitions, defaultItem: definitions[0] || null };
    const definitionByCode = new Map(definitions.map((item) => [item.screenCode, item]));
    const visibleLinks = links.filter((link) => hasAreaAccess(link.workspace_schermate?.area));
    const items = visibleLinks.map((link) => {
      const definition = definitionByCode.get(link.schermata_codice);
      return definition ? { ...definition,icon:getModuleIcon(link.workspace_schermate?.icona,definition.icon) } : null;
    }).filter(Boolean);
    const defaultLink = visibleLinks.find((link) => link.predefinita);
    return {
      items,
      defaultItem: items.find((item) => item.screenCode===defaultLink?.schermata_codice) || items[0] || null,
    };
  }, [definitions, hasAreaAccess, links]);
}
