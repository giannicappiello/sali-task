import { useEffect } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { LayoutDashboard, ShoppingCart, Users } from "lucide-react";
import useOrdersAccess from "./pages/useOrdersAccess";
import OrdersDashboard from "./pages/OrdersDashboard";
import Customers from "./pages/Customers";
import CustomerDetail from "./pages/CustomerDetail";
import Orders from "./pages/Orders";
import NewOrder from "./pages/NewOrder";
import OrderDetail from "./pages/OrderDetail";
import "./orders-module.css";

const items = [
  { to: "/ordini/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/ordini/clienti", label: "Clienti", icon: Users },
  { to: "/ordini/elenco", label: "Ordini", icon: ShoppingCart },
];

export default function OrdersModule() {
  const { loading, canAccessOrders } = useOrdersAccess();

  useEffect(() => {
    const updateLoadingText = () => {
      document.querySelectorAll(".orders-empty").forEach((element) => {
        if (element.textContent?.trim().toLowerCase() === "caricamento nuovo ordine...") {
          element.textContent = "CARICAMENTO";
        }
      });
    };

    updateLoadingText();
    const observer = new MutationObserver(updateLoadingText);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  if (loading) return <div className="orders-empty">Verifica autorizzazione...</div>;
  if (!canAccessOrders) {
    return <div className="orders-empty">Non sei autorizzato ad accedere alla Gestione Ordini.</div>;
  }

  return (
    <div className="orders-module">
      <style>{`
        .orders-status.bozza { background: #e2e8f0; color: #475569; }
        .orders-status.inviato { background: #dcfce7; color: #166534; }
        .orders-status.errore { background: #fee2e2; color: #991b1b; }
      `}</style>

      <div className="orders-module-header">
        <div>
          <h1>Gestione Ordini</h1>
        </div>
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
        <Route path="clienti/:customerCode" element={<CustomerDetail />} />
        <Route path="elenco" element={<Orders />} />
        <Route path="nuovo" element={<NewOrder />} />
        <Route path="modifica/:orderId" element={<NewOrder />} />
        <Route path="elenco/:orderId" element={<OrderDetail />} />
        <Route path="*" element={<Navigate to="dashboard" replace />} />
      </Routes>
    </div>
  );
}
