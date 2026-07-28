import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import AnalyticsHub from "./pages/AnalyticsHub";
import CommercialPivotAnalysis from "./pages/CommercialPivotAnalysis";
import BeautyAnalysis from "./pages/BeautyAnalysis";
import "./analytics.css";

const ActivitiesAnalysis = lazy(() => import("../../pages/Reports/Reports"));

export default function AnalyticsModule() {
  return <div className="analytics-module v4-page">
    <Suspense fallback={<div className="panel">Caricamento analisi...</div>}>
      <Routes>
        <Route index element={<AnalyticsHub />} />
        <Route path="fatture" element={<CommercialPivotAnalysis source="invoices" />} />
        <Route path="ordini-ph" element={<CommercialPivotAnalysis source="orders-ph" />} />
        <Route path="beauty-days" element={<BeautyAnalysis />} />
        <Route path="attivita" element={<ActivitiesAnalysis />} />
        <Route path="*" element={<Navigate to="/analisi-dati" replace />} />
      </Routes>
    </Suspense>
  </div>;
}
