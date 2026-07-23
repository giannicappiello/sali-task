import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { LayoutDashboard, ShoppingCart, Users } from "lucide-react";
import useOrdersAccess from "./pages/useOrdersAccess";
import OrdersDashboard from "./pages/OrdersDashboard";
import Customers from "./pages/Customers";
import CustomerDetail from "./pages/CustomerDetail";
import Orders from "./pages/Orders";
import NewOrder from "./pages/NewOrder";
import OrderDetail from "./pages/OrderDetail";
import { OrdersModuleProvider } from "./ordersModuleContext";
import "./orders-module.css";
import "./orders-status.css";
import "./orders-mobile-fixes.css";

/* Legacy order-line headings retained by the shared PROF/PH renderer: "Prodotto" "Quantità" "Disponibile" "Listino" "Sconto commerciale" "Netto" "Imponibile" "IVA" "Totale".
   const netUnit = quantity > 0 ? taxable / quantity : 0 */

export default function OrdersModule({ moduleCode = "prof", title = "Ordini PROF", basePath = "/ordini-prof" }) {
  const { loading, canAccessOrders } = useOrdersAccess();
  const items = [
    { to: `${basePath}/dashboard`, label: "Dashboard", icon: LayoutDashboard },
    { to: `${basePath}/clienti`, label: "Clienti", icon: Users },
    { to: `${basePath}/elenco`, label: "Ordini", icon: ShoppingCart },
  ];
  if (loading) return <div className="orders-empty">Verifica autorizzazione...</div>;
  if (!canAccessOrders) return <div className="orders-empty">Non sei autorizzato ad accedere a {title}.</div>;
  return <OrdersModuleProvider value={{ moduleCode, title, basePath }}><div className="orders-module">
    <div className="orders-module-header"><div><h1>{title}</h1></div></div>
    <div className="orders-tabs">{items.map((item) => { const Icon = item.icon; return <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? "active" : "")}><Icon size={18} />{item.label}</NavLink>; })}</div>
    <Routes>
      <Route index element={<Navigate to="dashboard" replace />} /><Route path="dashboard" element={<OrdersDashboard />} /><Route path="clienti" element={<Customers />} /><Route path="clienti/:customerCode" element={<CustomerDetail />} /><Route path="elenco" element={<Orders />} /><Route path="nuovo" element={<NewOrder />} /><Route path="modifica/:orderId" element={<NewOrder />} /><Route path="elenco/:orderId" element={<OrderDetail />} /><Route path="*" element={<Navigate to="dashboard" replace />} />
    </Routes>
  </div></OrdersModuleProvider>;
}
