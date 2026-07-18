import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import IntegrationsDashboard from "./pages/IntegrationsDashboard";
import MexalDashboard from "./pages/MexalDashboard";
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
      <Route path="*" element={<Navigate to="/integrations" replace />} />
    </Routes>
  );
}
