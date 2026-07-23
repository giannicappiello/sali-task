import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import IntegrationsDashboard from "./pages/IntegrationsDashboard";
import MexalDashboard from "./pages/MexalDashboard";
import DocumentSeriesSettings from "./pages/DocumentSeriesSettings";
import OrderModuleSettings from "./components/OrderModuleSettings";
import "./integrations.css";

export default function IntegrationsModule() {
  const { isAdminUser } = useAuth();

  if (!isAdminUser) {
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
      <Route path="mexal" element={<MexalDashboard />} />
      <Route path="mexal/serie-documenti" element={<DocumentSeriesSettings />} />
      <Route path="orders/prof" element={<OrderModuleSettings moduleCode="prof" />} />
      <Route path="orders/ph" element={<OrderModuleSettings moduleCode="ph" />} />
      <Route path="*" element={<Navigate to="/integrations" replace />} />
    </Routes>
  );
}
