import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import IntegrationsDashboard from "./pages/IntegrationsDashboard";
import MexalDashboard from "./pages/MexalDashboard";
import MexalAgents from "./pages/MexalAgents";
import DocumentSeriesSettings from "./pages/DocumentSeriesSettings";
import OrderModuleSettings from "./components/OrderModuleSettings";
import DocumentGatewaySettings from "./pages/DocumentGatewaySettings";
import ProgremesSettings from "./pages/ProgremesSettings";
import DigitalIntegrationStatus from "./pages/DigitalIntegrationStatus";
import "./integrations.css";
import "./document-gateway.css";
import "./document-sync.css";

export default function IntegrationsModule() {
  const { hasModuleAccess, hasScreenAccess, getScreenCodeForPath, getModuleScreenGrant } = useAuth();
  const { pathname } = useLocation();
  const screenCode = getScreenCodeForPath(pathname, "integrazioni");
  const screenAllowed = screenCode && hasScreenAccess(screenCode, "integrazioni");
  const isIndex = pathname.replace(/\/$/, "") === "/integrations";

  if (screenCode ? !screenAllowed : !(isIndex && (hasModuleAccess("integrazioni") || getModuleScreenGrant("integrazioni")))) {
    return (
      <div className="integrations-denied">
        <h2>Accesso riservato</h2>
        <p>Non disponi dell’autorizzazione per questa schermata.</p>
      </div>
    );
  }

  return (
    <Routes>
      <Route index element={<IntegrationsDashboard />} />
      <Route path="mexal" element={<IntegrationPermissionGate any={["integrations.configure","integrations.sync.clients","integrations.sync.agents","integrations.sync.products","integrations.sync.product_categories","integrations.sync.commercial_conditions","integrations.sync.stocks","integrations.sync.list_price_commissions","integrations.sync.orders","integrations.sync.sales_invoices"]}><MexalDashboard /></IntegrationPermissionGate>} />
      <Route path="mexal/agenti" element={<IntegrationPermissionGate any={["integrations.configure","integrations.sync.agents"]}><MexalAgents /></IntegrationPermissionGate>} />
      <Route path="mexal/serie-documenti" element={<IntegrationPermissionGate any={["integrations.configure","integrations.sync.document_series"]}><DocumentSeriesSettings /></IntegrationPermissionGate>} />
      <Route path="orders/prof" element={<IntegrationPermissionGate any={["integrations.configure"]}><OrderModuleSettings moduleCode="prof" /></IntegrationPermissionGate>} />
      <Route path="orders/ph" element={<IntegrationPermissionGate any={["integrations.configure"]}><OrderModuleSettings moduleCode="ph" /></IntegrationPermissionGate>} />
      <Route path="orders/private" element={<IntegrationPermissionGate any={["integrations.configure"]}><OrderModuleSettings moduleCode="private" /></IntegrationPermissionGate>} />
      <Route path="documentale" element={<IntegrationPermissionGate any={["integrations.configure","integrations.sync.documents"]}><DocumentGatewaySettings /></IntegrationPermissionGate>} />
      <Route path="progremes" element={<IntegrationPermissionGate any={["integrations.configure","integrations.sync.progremes_modules"]}><ProgremesSettings /></IntegrationPermissionGate>} />
      <Route path="crm-digital" element={<IntegrationPermissionGate any={["integrations.configure"]}><DigitalIntegrationStatus /></IntegrationPermissionGate>} />
      <Route path="*" element={<Navigate to="/integrations" replace />} />
    </Routes>
  );
}

function IntegrationPermissionGate({ any, children }) {
  const { hasPermission, hasScreenAccess, canUseScreen, getScreenCodeForPath } = useAuth();
  const { pathname } = useLocation();
  const screenCode = getScreenCodeForPath(pathname, "integrazioni");
  // Opening a screen is distinct from permission to run its operations.
  if (screenCode && hasScreenAccess(screenCode, "integrazioni") && canUseScreen(screenCode, "lettura")) return children;
  if (!any.some((permission) => hasPermission(permission))) {
    return <div className="integrations-denied"><h2>Accesso non autorizzato</h2><p>Il ruolo non dispone dell'autorizzazione richiesta.</p></div>;
  }
  return children;
}
