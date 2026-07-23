import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ClipboardList,
  FileArchive,
  MessageCircle,
  Package,
  PlugZap,
  Settings,
  ShoppingCart,
  Store,
} from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../contexts/AuthContext";

const cards = [
  {
    path: "/activities",
    label: "Attività",
    description: "Task, reminder, progetti, fasi e analisi dati del reparto.",
    icon: ClipboardList,
    permission: "dashboard.read",
  },
  {
    path: "/farmacie/dashboard",
    label: "Beauty Days",
    description: "Giornate promozionali, farmacie, consulenti e report.",
    icon: Store,
    permission: "pharmacy.read",
    special: "pharmacy",
  },
  {
    path: "/ordini",
    label: "Ordini",
    description: "Clienti, ordini e attività commerciali collegate a Mexal.",
    icon: ShoppingCart,
    permission: "orders.read",
    special: "orders",
  },
  {
    path: "/products",
    label: "Prodotti",
    description: "Catalogo articoli attivi sincronizzato da Mexal.",
    icon: Package,
    permission: "products.read",
    special: "products",
  },
  {
    path: "/documentation",
    label: "Documenti",
    description: "Schede tecniche, certificazioni e documentazione aziendale.",
    icon: FileArchive,
    permission: "documentation.read",
  },
  {
    path: "/messages",
    label: "Messaggi",
    description: "Conversazioni, allegati e notifiche interne.",
    icon: MessageCircle,
    permission: "messages.read",
  },
  {
    path: "/integrations",
    label: "Integrazioni",
    description: "Connessioni con Mexal e configurazioni dei sistemi esterni.",
    icon: PlugZap,
    permission: "settings.manage",
    adminOnly: true,
  },
  {
    path: "/settings",
    label: "Impostazioni",
    description: "Permessi, accessi e configurazioni del Workspace.",
    icon: Settings,
    permission: "settings.manage",
  },
];

export default function Home() {
  const navigate = useNavigate();
  const { profile, hasPermission, isAdminUser } = useAuth();
  const [pharmacyEnabled, setPharmacyEnabled] = useState(false);
  const [ordersEnabled, setOrdersEnabled] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadIntegrations() {
      if (!profile?.id) return;

      if (isAdminUser) {
        if (active) {
          setPharmacyEnabled(true);
          setOrdersEnabled(true);
        }
        return;
      }

      const { data, error } = await supabase
        .from("integrazioni_utenti")
        .select("modulo,enabled")
        .eq("utente_id", profile.id)
        .in("modulo", ["report_giornate", "gestione_ordini"]);

      if (error) {
        console.error("Accessi home:", error.message);
        return;
      }

      if (active) {
        setPharmacyEnabled(
          (data || []).some(
            (item) => item.modulo === "report_giornate" && item.enabled === true
          )
        );
        setOrdersEnabled(
          (data || []).some(
            (item) => item.modulo === "gestione_ordini" && item.enabled === true
          )
        );
      }
    }

    loadIntegrations();
    return () => {
      active = false;
    };
  }, [profile?.id, isAdminUser]);

  const visibleCards = useMemo(
    () =>
      cards.filter((card) => {
        if (card.adminOnly && !isAdminUser) return false;
        if (card.special === "pharmacy") {
          return pharmacyEnabled || hasPermission("pharmacy.read");
        }
        if (card.special === "orders") {
          return ordersEnabled || hasPermission("orders.read");
        }
        if (card.special === "products") {
          return ordersEnabled || hasPermission("products.read");
        }
        return hasPermission(card.permission);
      }),
    [hasPermission, pharmacyEnabled, ordersEnabled, isAdminUser]
  );

  return (
    <div className="v4-page">
      <div className="page-title-row">
        <div>
          <h1>Home</h1>
          <p>Seleziona il modulo da aprire.</p>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
          gap: 18,
        }}
      >
        {visibleCards.map((card) => {
          const Icon = card.icon;
          return (
            <button
              key={card.path}
              type="button"
              className="panel"
              onClick={() => navigate(card.path)}
              style={{
                minHeight: 180,
                padding: 24,
                textAlign: "left",
                cursor: "pointer",
                border: "1px solid #e2e8f0",
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 18,
              }}
            >
              <span
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 14,
                  display: "grid",
                  placeItems: "center",
                  background: "#e0f2fe",
                  color: "#075985",
                }}
              >
                <Icon size={24} />
              </span>
              <span>
                <strong style={{ display: "block", fontSize: 20, marginBottom: 8 }}>
                  {card.label}
                </strong>
                <small style={{ color: "#64748b", fontSize: 14, lineHeight: 1.5 }}>
                  {card.description}
                </small>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
