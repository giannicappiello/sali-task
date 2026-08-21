import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import AnalyticsHub from "./pages/AnalyticsHub";
import CommercialPivotAnalysis from "./pages/CommercialPivotAnalysis";
import BeautyAnalysis from "./pages/BeautyAnalysis";
import WorkspaceAccessGuard from "../../components/WorkspaceAccessGuard";
import "./analytics.css";

const ActivitiesAnalysis = lazy(() => import("../../pages/Reports/Reports"));

export default function AnalyticsModule() {
  return <div className="analytics-module v4-page">
    <Suspense fallback={<div className="panel">Caricamento analisi...</div>}>
      <Routes>
        <Route index element={<AnalyticsHub />} />
        <Route path="fatture" element={<WorkspaceAccessGuard moduleCode="ordini_pr" redirectTo="/analisi-dati"><CommercialPivotAnalysis source="invoices" /></WorkspaceAccessGuard>} />
        <Route path="ordini-ph" element={<WorkspaceAccessGuard moduleCode="ordini_ph" redirectTo="/analisi-dati"><CommercialPivotAnalysis source="orders-ph" /></WorkspaceAccessGuard>} />
        <Route path="beauty-days" element={<WorkspaceAccessGuard moduleCode="beauty_days" redirectTo="/analisi-dati"><BeautyAnalysis /></WorkspaceAccessGuard>} />
        <Route path="attivita" element={<WorkspaceAccessGuard moduleCode="attivita" redirectTo="/analisi-dati"><ActivitiesAnalysis /></WorkspaceAccessGuard>} />
        <Route path="*" element={<Navigate to="/analisi-dati" replace />} />
      </Routes>
    </Suspense>
  </div>;
}
