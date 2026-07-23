import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { LayoutDashboard, ShoppingCart, Users } from "lucide-react";
import useOrdersAccess from "./pages/useOrdersAccess";
import OrdersDashboard from "./pages/OrdersDashboard";
import Customers from "./pages/Customers";
import CustomerDetail from "./pages/CustomerDetail";
import Orders from "./pages/Orders";
import NewOrderPresentation from "./pages/NewOrderPresentation";
import OrderDetail from "./pages/OrderDetail";
import "./orders-module.css";
import "./orders-mobile-fixes.css";

const items = [
  { to: "/ordini/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/ordini/clienti", label: "Clienti", icon: Users },
  { to: "/ordini/elenco", label: "Ordini", icon: ShoppingCart },
];

export default function OrdersModule() {
  const { loading, canAccessOrders } = useOrdersAccess();

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

        .orders-order-lines {
          min-width: 1080px;
        }

        .orders-order-lines thead tr:first-child,
        .orders-order-lines tbody > tr:not(.orders-calculation-row) {
          display: grid;
          grid-template-columns: minmax(165px, 1.45fr) 120px 105px 95px minmax(135px, 1fr) 95px 105px 115px 115px 44px;
          align-items: center;
          width: 100%;
        }

        .orders-order-lines thead tr:first-child > th,
        .orders-order-lines tbody > tr:not(.orders-calculation-row) > td {
          display: none;
          min-width: 0;
        }

        .orders-order-lines thead tr:first-child > th:nth-child(2),
        .orders-order-lines tbody > tr:not(.orders-calculation-row) > td:nth-child(2) {
          display: table-cell;
          order: 1;
        }

        .orders-order-lines thead tr:first-child > th:nth-child(4),
        .orders-order-lines tbody > tr:not(.orders-calculation-row) > td:nth-child(4) {
          display: table-cell;
          order: 2;
          text-align: center;
        }

        .orders-order-lines thead tr:first-child > th:nth-child(3),
        .orders-order-lines tbody > tr:not(.orders-calculation-row) > td:nth-child(3) {
          display: table-cell;
          order: 3;
          text-align: center;
        }

        .orders-order-lines thead tr:first-child > th:nth-child(5),
        .orders-order-lines tbody > tr:not(.orders-calculation-row) > td:nth-child(5) {
          display: table-cell;
          order: 4;
        }

        .orders-order-lines thead tr:first-child > th:nth-child(6) {
          display: table-cell;
          order: 5;
        }

        .orders-order-lines tbody > tr:not(.orders-calculation-row) > td:nth-child(7) {
          display: table-cell;
          order: 5;
        }

        .orders-order-lines thead tr:first-child > th:nth-child(7),
        .orders-order-lines tbody > tr:not(.orders-calculation-row) > td:nth-child(8) {
          display: table-cell;
          order: 6;
        }

        .orders-order-lines thead tr:first-child > th:nth-child(8),
        .orders-order-lines tbody > tr:not(.orders-calculation-row) > td:nth-child(9) {
          display: table-cell;
          order: 7;
        }

        .orders-order-lines thead tr:first-child > th:nth-child(9),
        .orders-order-lines tbody > tr:not(.orders-calculation-row) > td:nth-child(10) {
          display: table-cell;
          order: 8;
        }

        .orders-order-lines thead tr:first-child > th:nth-child(10),
        .orders-order-lines tbody > tr:not(.orders-calculation-row) > td:nth-child(11) {
          display: table-cell;
          order: 9;
        }

        .orders-order-lines thead tr:first-child > th:nth-child(12),
        .orders-order-lines tbody > tr:not(.orders-calculation-row) > td:nth-child(13) {
          display: table-cell;
          order: 10;
        }

        .orders-order-lines tbody > tr:not(.orders-calculation-row) > td:nth-child(2) small {
          display: none;
        }

        .orders-order-lines .orders-quantity-control {
          justify-content: center;
        }
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
        <Route path="nuovo" element={<NewOrderPresentation />} />
        <Route path="modifica/:orderId" element={<NewOrderPresentation />} />
        <Route path="elenco/:orderId" element={<OrderDetail />} />
        <Route path="*" element={<Navigate to="dashboard" replace />} />
      </Routes>
    </div>
  );
}
