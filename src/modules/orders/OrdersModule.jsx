import { useEffect, useState } from "react";
import { Navigate, NavLink, Route, Routes } from "react-router-dom";
import { LayoutDashboard, Package, ShoppingCart, Users, FolderOpen } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabaseClient";
import OrdersDashboard from "./pages/OrdersDashboard";
import Customers from "./pages/Customers";
import Orders from "./pages/Orders";
import Products from "./pages/Products";
import Materials from "./pages/Materials";
import "./orders-module.css";

const items = [
  { to: "/ordini/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/ordini/clienti", label: "Clienti", icon: Users },
  { to: "/ordini/elenco", label: "Ordini", icon: ShoppingCart },
  { to: "/ordini/prodotti", label: "Prodotti", icon: Package },
  { to: "/ordini/materiali", label: "Materiali", icon: FolderOpen },
];

export default function OrdersModule() {
  const { profile, hasPermission, isAdminUser } = useAuth();
  const [integrationEnabled, setIntegrationEnabled] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(true);

  useEffect(() => {
    let active = true;

    async function checkAccess() {
      if (isAdminUser) {
        if (active) { setIntegrationEnabled(true); setCheckingAccess(false); }
        return;
      }

      if (!profile?.id) {
        if (active) { setIntegrationEnabled(false); setCheckingAccess(false); }
        return;
      }

      const { data, error } = await supabase
        .from("integrazioni_utenti")
        .select("enabled")
        .eq("utente_id", profile.id)
        .eq("modulo", "gestione_ordini")
        .maybeSingle();

      if (error) console.error("Errore verifica accesso Gestione Ordini:", error);
      if (active) {
        setIntegrationEnabled(data?.enabled === true);
        setCheckingAccess(false);
      }
    }

    checkAccess();
    return () => { active = false; };
  }, [profile?.id, isAdminUser]);

  const canAccess = isAdminUser || hasPermission("orders.read") || integrationEnabled;

  if (checkingAccess) return <div className="orders-empty">Verifica autorizzazione...</div>;

  if (!canAccess) {
    return <div className="orders-empty">Non sei autorizzato ad accedere alla Gestione Ordini.</div>;
  }

  return (
    <div className="orders-module">
      <div className="orders-module-header">
        <div>
          <h1>Gestione Ordini</h1>
          <p>Clienti, ordini, prodotti e materiali commerciali collegati a Mexal.</p>
        </div>
      </div>

      <div className="orders-tabs">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => isActive ? "active" : ""}>
              <Icon size={18} />
              {item.label}
            </NavLink>
          );
        })}
      </div>

      <Routes>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<OrdersDashboard />} />
        <Route path="clienti" element={<Customers />} />
        <Route path="elenco" element={<Orders />} />
        <Route path="prodotti" element={<Products />} />
        <Route path="materiali" element={<Materials />} />
        <Route path="*" element={<Navigate to="dashboard" replace />} />
      </Routes>
    </div>
  );
}
