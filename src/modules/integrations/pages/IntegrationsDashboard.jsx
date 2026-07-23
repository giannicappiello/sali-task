import { useNavigate } from "react-router-dom";
import { Activity, Archive, Database, Fingerprint, Network, ShoppingCart } from "lucide-react";
import IntegrationCard from "../components/IntegrationCard";

export default function IntegrationsDashboard() {
  const navigate = useNavigate();

  const integrations = [
    {
      icon: Database,
      title: "Mexal ERP",
      description: "Sincronizzazione di clienti, prodotti, condizioni commerciali, giacenze e ordini.",
      status: "connected",
      meta: "WebAPI Mexal · ambiente configurato",
      onOpen: () => navigate("/integrations/mexal"),
    },
    {
      icon: ShoppingCart,
      title: "Ordini PROF",
      description: "Configurazione invio Mexal, serie documenti e destinatari email per gli ordini PROF.",
      status: "configuration",
      meta: "Configurazione indipendente",
      onOpen: () => navigate("/integrations/orders/prof"),
    },
    {
      icon: ShoppingCart,
      title: "Ordini PH",
      description: "Configurazione invio Mexal, serie documenti e destinatari email per gli ordini PH.",
      status: "configuration",
      meta: "Configurazione indipendente",
      onOpen: () => navigate("/integrations/orders/ph"),
    },
    {
      icon: Activity,
      title: "Gestione Farmacie",
      description: "Collegamento con il modulo Beauty Days e i dati delle giornate promozionali.",
      status: "active",
      meta: "Modulo interno Workspace",
      disabled: true,
    },
    {
      icon: Archive,
      title: "Documentale",
      description: "Accesso centralizzato a schede tecniche, certificazioni e materiali aziendali.",
      status: "configuration",
      meta: "Repository cloud in configurazione",
      disabled: true,
    },
    {
      icon: Fingerprint,
      title: "Presenze",
      description: "Integrazione futura con dispositivi RFID, impronta digitale e controllo accessi.",
      status: "unavailable",
      meta: "Hardware non ancora collegato",
      disabled: true,
    },
    {
      icon: Network,
      title: "API Esterne",
      description: "Area per connettori, webhook e servizi esterni del Workspace.",
      status: "unavailable",
      meta: "Nessuna API aggiuntiva configurata",
      disabled: true,
    },
  ];

  return (
    <div className="integrations-page">
      <div className="integrations-hero">
        <div>
          <span className="integrations-eyebrow">AMMINISTRAZIONE</span>
          <h1>Centro Integrazioni</h1>
          <p>Controlla da un unico punto le connessioni tra Progre Workspace e i sistemi aziendali.</p>
        </div>
        <div className="integrations-hero-summary">
          <strong>1</strong><span>integrazione connessa</span>
        </div>
      </div>

      <div className="integrations-grid">
        {integrations.map((integration) => (
          <IntegrationCard key={integration.title} {...integration} />
        ))}
      </div>
    </div>
  );
}
