import { useMemo } from "react";
import { Home as HomeIcon } from "lucide-react";
import { useOutletContext } from "react-router-dom";
import ModuleContainerLayout from "../../components/ModuleContainerLayout";

const DESCRIPTION_BY_PATH = Object.freeze({
  "/activities": "Task, reminder, progetti, fasi e analisi dati del reparto.",
  "/farmacie/dashboard": "Giornate promozionali, farmacie, consulenti e report.",
  "/ordini-prof": "Clienti, ordini e attività commerciali collegate a Mexal.",
  "/ordini-ph": "Clienti, ordini e attività commerciali collegate a Mexal.",
  "/products": "Catalogo articoli attivi sincronizzato da Mexal.",
  "/documentation": "Schede tecniche, certificazioni e documentazione aziendale.",
  "/analisi-dati": "Cruscotti e analisi disponibili in base agli accessi dell’utente.",
  "/progremes": "Accesso transitorio alla pianificazione e gestione della produzione.",
  "/produzione": "Aree operative e analisi della produzione integrate nel Workspace.",
  "/assistente-ai": "Assistente sui dati e sui processi autorizzati del Workspace.",
  "/messages": "Conversazioni, allegati e notifiche interne.",
  "/notifications": "Avvisi personali e aggiornamenti operativi.",
  "/team": "Componenti dei reparti associati all’utente.",
  "/integrations": "Connessioni e servizi dei sistemi esterni.",
  "/settings": "Permessi, accessi e configurazioni del Workspace.",
});

export default function Home() {
  const visibleMenuItems = useOutletContext();
  const cards = useMemo(() => (visibleMenuItems || [])
    .filter((item) => item.path !== "/home")
    .map((card) => {
      const isProductionHub = card.module === "progremes" && card.path === "/produzione";
      let launchesProgremes = false;
      if (!isProductionHub && (card.module === "progremes" || card.provider === "progremes")) launchesProgremes = true;
      return {
        code: card.module || card.path,
        name: card.label,
        description: card.description || DESCRIPTION_BY_PATH[card.path] || "Apri il modulo del Workspace.",
        to: card.path,
        icon: card.icon,
        external: launchesProgremes,
        onOpen: launchesProgremes ? () => window.dispatchEvent(new CustomEvent("workspace:launch-progremes")) : undefined,
      };
    }), [visibleMenuItems]);

  return <ModuleContainerLayout
    icon={HomeIcon}
    eyebrow="Workspace"
    title="Home"
    description="Accedi ai moduli disponibili in base alle tue autorizzazioni."
    items={cards}
    ariaLabel="Moduli disponibili"
    openLabel="Apri modulo"
    emptyTitle="Nessun modulo disponibile"
    emptyDescription="Non risultano moduli visibili per questo utente."
  />;
}
