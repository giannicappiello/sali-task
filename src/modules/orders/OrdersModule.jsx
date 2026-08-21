import { Navigate, Route, Routes } from "react-router-dom";
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
  const { loading, canAccessOrders } = useOrdersAccess(moduleCode);
  if (loading) return <div className="orders-empty">Verifica autorizzazione...</div>;
  if (!canAccessOrders) return <div className="orders-empty">Non sei autorizzato ad accedere a {title}.</div>;
  return <OrdersModuleProvider value={{ moduleCode, title, basePath }}><div className="orders-module">
    <Routes>
      <Route index element={<Navigate to="dashboard" replace />} /><Route path="dashboard" element={<OrdersDashboard />} /><Route path="clienti" element={<Customers />} /><Route path="clienti/:customerCode" element={<CustomerDetail />} /><Route path="elenco" element={<Orders />} /><Route path="nuovo" element={<NewOrder />} /><Route path="nuovo-da-documento" element={<AIOrderImport />} /><Route path="modifica/:orderId" element={<NewOrder />} /><Route path="elenco/:orderId" element={<OrderDetail />} /><Route path="fatture" element={<Invoices />} /><Route path="fatture/:invoiceId" element={<InvoiceDetail />} /><Route path="*" element={<Navigate to="dashboard" replace />} />
    </Routes>
  </div></OrdersModuleProvider>;
}
