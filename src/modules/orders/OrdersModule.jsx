import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import {
  FolderOpen,
  LayoutDashboard,
  LoaderCircle,
  ShoppingCart,
  Users,
} from "lucide-react";
import useOrdersAccess from "./pages/useOrdersAccess";
import OrdersDashboard from "./pages/OrdersDashboard";
import Customers from "./pages/Customers";
import Orders from "./pages/Orders";
import Materials from "./pages/Materials";
import {
  startStockSync,
  subscribeToStockSyncRequest,
  subscribeToStockSyncStatus,
} from "./services/stockSync";
import "./orders-module.css";

const items = [
  { to: "/ordini/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/ordini/clienti", label: "Clienti", icon: Users },
  { to: "/ordini/elenco", label: "Ordini", icon: ShoppingCart },
  { to: "/ordini/materiali", label: "Materiali", icon: FolderOpen },
];

export default function OrdersModule() {
  const { loading, canAccessOrders } = useOrdersAccess();
  const [stockStatus, setStockStatus] = useState({ running: false });

  useEffect(() => {
    if (loading || !canAccessOrders) return undefined;

    const unsubscribeStatus = subscribeToStockSyncStatus(setStockStatus);
    const unsubscribeRequest = subscribeToStockSyncRequest(() => {
      startStockSync().catch(() => {});
    });

    // Parte in background ogni volta che si entra nel modulo Ordini.
    startStockSync().catch(() => {});

    return () => {
      unsubscribeStatus();
      unsubscribeRequest();
    };
  }, [loading, canAccessOrders]);

  if (loading) {
    return <div className="orders-empty">Verifica autorizzazione...</div>;
  }

  if (!canAccessOrders) {
    return (
      <div className="orders-empty">
        Non sei autorizzato ad accedere alla Gestione Ordini.
      </div>
    );
  }

  return (
    <div className="orders-module">
      <div className="orders-module-header">
        <div>
          <h1>Gestione Ordini</h1>
          <p>Clienti, ordini e materiali commerciali collegati a Mexal.</p>
        </div>

        <div
          className={`orders-stock-status ${
            stockStatus.running ? "is-running" : ""
          } ${stockStatus.error ? "is-error" : ""}`}
          title={stockStatus.message || ""}
        >
          {stockStatus.running && <LoaderCircle className="spin" size={17} />}
          <span>
            {stockStatus.running
              ? "Aggiornamento disponibilità..."
              : stockStatus.error
                ? "Aggiornamento non riuscito"
                : stockStatus.completedAt
                  ? "Disponibilità aggiornate"
                  : "Disponibilità in attesa"}
          </span>
        </div>
      </div>

      <div className="orders-tabs">
        {items.map((item) => {
          const Icon = item.icon;

          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => (isActive ? "active" : "")}
            >
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
        <Route path="materiali" element={<Materials />} />
        <Route path="*" element={<Navigate to="dashboard" replace />} />
      </Routes>
    </div>
  );
}
