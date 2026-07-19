import { useEffect, useMemo, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { FolderOpen, LayoutDashboard, LoaderCircle, ShoppingCart, Users } from "lucide-react";
import useOrdersAccess from "./pages/useOrdersAccess";
import OrdersDashboard from "./pages/OrdersDashboard";
import Customers from "./pages/Customers";
import Orders from "./pages/Orders";
import NewOrder from "./pages/NewOrder";
import OrderDetail from "./pages/OrderDetail";
import Materials from "./pages/Materials";
import {
  startAutomaticOrderSyncs,
  startOrderSync,
  subscribeToOrderSyncRequests,
  subscribeToOrderSyncStatus,
} from "./services/orderSync";
import "./orders-module.css";
import useOrdersModuleAutomation from "./hooks/useOrdersModuleAutomation";

const items = [
  { to: "/ordini/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/ordini/clienti", label: "Clienti", icon: Users },
  { to: "/ordini/elenco", label: "Ordini", icon: ShoppingCart },
  { to: "/ordini/materiali", label: "Materiali", icon: FolderOpen },
];

export default function OrdersModule() {
  const { loading, canAccessOrders } = useOrdersAccess();
  const [statuses, setStatuses] = useState({});
  const automationStatus = useOrdersModuleAutomation({ ready: !loading, enabled: canAccessOrders });

  useEffect(() => {
    if (loading || !canAccessOrders) return undefined;

    const unsubscribeStatus = subscribeToOrderSyncStatus((detail) => {
      if (!detail?.type) return;
      setStatuses((current) => ({ ...current, [detail.type]: detail }));
    });

    const unsubscribeRequest = subscribeToOrderSyncRequests(({ type, options }) => {
      if (type) startOrderSync(type, options).catch(() => {});
    });

    startAutomaticOrderSyncs();

    return () => {
      unsubscribeStatus();
      unsubscribeRequest();
    };
  }, [loading, canAccessOrders]);

  const runningLabels = useMemo(() => {
    const labels = { giacenze: "giacenze", clienti: "clienti", prodotti: "prodotti" };
    return Object.entries(statuses)
      .filter(([, status]) => status?.running)
      .map(([type]) => labels[type] || type);
  }, [statuses]);

  const hasError = Object.values(statuses).some(
    (status) => status && status.running === false && status.success === false
  );

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

        <div className={`orders-stock-status ${runningLabels.length ? "is-running" : ""} ${hasError ? "is-error" : ""}`}>
          {runningLabels.length > 0 && <LoaderCircle className="spin" size={17} />}
          <span>
            {runningLabels.length > 0
              ? `Sincronizzazione ${runningLabels.join(", ")}...`
              : automationStatus === "running"
                ? "Aggiornamento Mexal in background..."
              : hasError
                ? "Aggiornamento Mexal con avvisi"
                : "Dati sincronizzati in background"}
          </span>
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
        <Route path="elenco" element={<Orders />} />
        <Route path="nuovo" element={<NewOrder />} />
        <Route path="elenco/:orderId" element={<OrderDetail />} />
        <Route path="materiali" element={<Materials />} />
        <Route path="*" element={<Navigate to="dashboard" replace />} />
      </Routes>
    </div>
  );
}
