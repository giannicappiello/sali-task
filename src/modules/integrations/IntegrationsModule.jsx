import { Navigate, Route, Routes } from "react-router-dom";
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
  const { hasPermission, hasModuleAccess } = useAuth();

  if (!hasModuleAccess("integrazioni") || !hasPermission("integrations.read")) {
    return (
      <div className="integrations-denied">
        <h2>Accesso riservato</h2>
        <p>Il Centro Integrazioni è disponibile solo agli amministratori del Workspace.</p>
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
      <Route path="documentale" element={<IntegrationPermissionGate any={["integrations.configure","integrations.sync.documents"]}><DocumentGatewaySettings /></IntegrationPermissionGate>} />
      <Route path="progremes" element={<IntegrationPermissionGate any={["integrations.configure","integrations.sync.progremes_modules"]}><ProgremesSettings /></IntegrationPermissionGate>} />
      <Route path="crm-digital" element={<IntegrationPermissionGate any={["integrations.configure"]}><DigitalIntegrationStatus /></IntegrationPermissionGate>} />
      <Route path="*" element={<Navigate to="/integrations" replace />} />
    </Routes>
  );
}

function IntegrationPermissionGate({ any, children }) {
  const { hasPermission } = useAuth();
  if (!any.some((permission) => hasPermission(permission))) {
    return <div className="integrations-denied"><h2>Accesso non autorizzato</h2><p>Il ruolo non dispone dell'autorizzazione richiesta.</p></div>;
  }
  return children;
}
