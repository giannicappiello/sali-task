import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { FolderOpen, LayoutDashboard, ShoppingCart, Users } from "lucide-react";
import useOrdersAccess from "./pages/useOrdersAccess";
import OrdersDashboard from "./pages/OrdersDashboard";
import Customers from "./pages/Customers";
import Orders from "./pages/Orders";
import NewOrder from "./pages/NewOrder";
import OrderDetail from "./pages/OrderDetail";
import Materials from "./pages/Materials";
import "./orders-module.css";

const items = [
  { to: "/ordini/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/ordini/clienti", label: "Clienti", icon: Users },
  { to: "/ordini/elenco", label: "Ordini", icon: ShoppingCart },
  { to: "/ordini/materiali", label: "Materiali", icon: FolderOpen },
];

export default function OrdersModule() {
  const { loading, canAccessOrders } = useOrdersAccess();

  if (loading) return <div className="orders-empty">Verifica autorizzazione...</div>;
  if (!canAccessOrders) {
    return <div className="orders-empty">Non sei autorizzato ad accedere alla Gestione Ordini.</div>;
  }

  return (
    <div className="orders-module">
      <div className="orders-module-header">
        <div>
          <h1>Gestione Ordini</h1>
          <p>Clienti, ordini e materiali commerciali collegati a Mexal.</p>
        </div>

        <div className="orders-stock-status"><span>Dati Mexal letti dalla cache. Per aggiornarli usa il pannello Integrazioni.</span></div>
      </div>

      <div className="orders-tabs">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? "active" : "")}>
              <Icon size={18} />{item.label}
            </NavLink>
          );
        })}
      </div>

      <Routes>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<OrdersDashboard />} />
        <Route path="clienti" element={<Customers />} />
        <Route path="elenco" element={<Orders />} />
        <Route path="nuovo" element={<NewOrder />} />
        <Route path="elenco/:orderId" element={<OrderDetail />} />
        <Route path="materiali" element={<Materials />} />
        <Route path="*" element={<Navigate to="dashboard" replace />} />
      </Routes>
    </div>
  );
}
