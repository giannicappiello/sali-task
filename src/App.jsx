import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { AuthProvider } from "./contexts/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import Layout from "./components/Layout";
import OrdersDataPreloader from "./components/OrdersDataPreloader";

import Login from "./pages/Login/Login";

const Home = lazy(() => import("./pages/Home/Home"));
const ActivitiesModule = lazy(() => import("./pages/Activities/ActivitiesModule"));
const Dashboard = lazy(() => import("./pages/Dashboard/Dashboard"));
const Agenda = lazy(() => import("./pages/Agenda/Agenda"));
const Tasks = lazy(() => import("./pages/Tasks/Tasks"));
const Projects = lazy(() => import("./pages/Projects/Projects"));
const Products = lazy(() => import("./pages/Products/Products"));
const Documentation = lazy(() => import("./pages/Documentation/Documentation"));
const Messages = lazy(() => import("./pages/Messages/Messages"));
const Team = lazy(() => import("./pages/Team/Team"));
const Calendar = lazy(() => import("./pages/Calendar/Calendar"));
const Reports = lazy(() => import("./pages/Reports/Reports"));
const Settings = lazy(() => import("./pages/Settings/Settings"));
const MexalDiagnostics = lazy(() => import("./pages/Settings/MexalDiagnostics"));

const PharmacyModule = lazy(() =>
  import("./modules/pharmacy/PharmacyModule")
);

const OrdersModule = lazy(() =>
  import("./modules/orders/OrdersModule")
);

const IntegrationsModule = lazy(() =>
  import("./modules/integrations/IntegrationsModule")
);

import "./styles/App.css";
import "./styles/team-navigation-hidden.css";
import "./styles/settings-menu-groups.css";

function Loader() {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        minHeight: "300px",
        fontSize: "18px",
      }}
    >
      Caricamento modulo...
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <OrdersDataPreloader />
      <Suspense fallback={<Loader />}>
        <Routes>
          <Route path="/login" element={<Login />} />

          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<Layout />}>
              <Route index element={<Navigate to="/home" replace />} />

              <Route path="home" element={<Home />} />
              <Route path="activities/*" element={<ActivitiesModule />} />
              <Route path="dashboard" element={<Navigate to="/activities/dashboard" replace />} />
              <Route path="agenda" element={<Agenda />} />
              <Route path="reminders" element={<Navigate to="/activities/reminders" replace />} />
              <Route path="tasks" element={<Navigate to="/activities/tasks" replace />} />
              <Route path="projects" element={<Navigate to="/activities/projects" replace />} />
              <Route path="products" element={<Products />} />
              <Route path="documentation" element={<Documentation />} />
              <Route path="messages" element={<Messages />} />
              <Route path="team" element={<Team />} />
              <Route path="calendar" element={<Calendar />} />
              <Route path="reports" element={<Navigate to="/activities/analysis-data" replace />} />
              <Route path="analysis-data" element={<Navigate to="/activities/analysis-data" replace />} />
              <Route path="settings" element={<Settings />} />
              <Route path="settings/mexal-diagnostics" element={<MexalDiagnostics />} />
              <Route path="farmacie/*" element={<PharmacyModule />} />
              <Route path="ordini/*" element={<Navigate to="/ordini-prof" replace />} />
              <Route path="ordini-prof/*" element={<OrdersModule moduleCode="prof" title="Ordini PROF" basePath="/ordini-prof" />} />
              <Route path="ordini-ph/*" element={<OrdersModule moduleCode="ph" title="Ordini PH" basePath="/ordini-ph" />} />
              <Route path="integrations/*" element={<IntegrationsModule />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/home" replace />} />
        </Routes>
      </Suspense>
    </AuthProvider>
  );
}

export default App;
