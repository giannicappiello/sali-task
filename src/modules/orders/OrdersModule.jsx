import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import useOrdersAccess from "./pages/useOrdersAccess";
import OrdersDashboard from "./pages/OrdersDashboard";
import Customers from "./pages/Customers";
import CustomerDetail from "./pages/CustomerDetail";
import Orders from "./pages/Orders";
import NewOrder from "./pages/NewOrder";
import OrderDetail from "./pages/OrderDetail";
import Invoices from "./pages/Invoices";
import InvoiceDetail from "./pages/InvoiceDetail";
import AIOrderImport from "./pages/AIOrderImport";
import { OrdersModuleProvider } from "./ordersModuleContext";
import "./orders-module.css";
import "./orders-status.css";
import "./orders-mobile-fixes.css";
import "./order-child-documents.css";

/* Legacy order-line headings retained by the shared PROF/PH renderer: "Prodotto" "Quantità" "Disponibile" "Listino" "Sconto commerciale" "Netto" "Imponibile" "IVA" "Totale".
   const netUnit = quantity > 0 ? taxable / quantity : 0 */

export default function OrdersModule({ moduleCode = "prof", title = "Ordini PROF", basePath = "/ordini-prof" }) {
  const { loading, canAccessOrders, canWriteOrders, canUseAIOrderGeneration, isCustomer } = useOrdersAccess(moduleCode);
  const customerPrivateView = moduleCode === "private" && isCustomer;
  if (loading) return <div className="orders-empty">Verifica autorizzazione...</div>;
  if (!canAccessOrders) return <div className="orders-empty">Non sei autorizzato ad accedere a {title}.</div>;
  return <OrdersModuleProvider value={{ moduleCode, title, basePath }}><div className="orders-module">
    <OrdersModuleNavigation title={title} basePath={basePath} hideCustomers={customerPrivateView} />
    <Routes>
      <Route index element={<Navigate to="dashboard" replace />} /><Route path="dashboard" element={<OrdersDashboard />} /><Route path="clienti" element={customerPrivateView ? <Navigate to={`${basePath}/dashboard`} replace /> : <Customers />} /><Route path="clienti/:customerCode" element={customerPrivateView ? <Navigate to={`${basePath}/dashboard`} replace /> : <CustomerDetail />} /><Route path="elenco" element={<Orders />} /><Route path="nuovo" element={canWriteOrders ? <NewOrder /> : <Navigate to={`${basePath}/elenco`} replace />} /><Route path="nuovo-da-documento" element={canUseAIOrderGeneration ? <AIOrderImport /> : <Navigate to={`${basePath}/elenco`} replace />} /><Route path="modifica/:orderId" element={canWriteOrders ? <NewOrder /> : <Navigate to={`${basePath}/elenco`} replace />} /><Route path="elenco/:orderId" element={<OrderDetail />} /><Route path="fatture" element={<Invoices />} /><Route path="fatture/:invoiceId" element={<InvoiceDetail />} /><Route path="*" element={<Navigate to="dashboard" replace />} />
    </Routes>
  </div></OrdersModuleProvider>;
}

const MODULE_NAVIGATION = Object.freeze([
  Object.freeze({ path: "dashboard", label: "Dashboard" }),
  Object.freeze({ path: "clienti", label: "Clienti" }),
  Object.freeze({ path: "elenco", label: "Ordini" }),
  Object.freeze({ path: "fatture", label: "Fatture" }),
]);

function OrdersModuleNavigation({ title, basePath, hideCustomers = false }) {
  return <nav className="orders-module-navigation" aria-label={`Sezioni ${title}`}>
    {MODULE_NAVIGATION.filter((item) => !hideCustomers || item.path !== "clienti").map((item) => <NavLink key={item.path} to={`${basePath}/${item.path}`} className={({ isActive }) => isActive ? "active" : undefined}>{item.label}</NavLink>)}
  </nav>;
}
