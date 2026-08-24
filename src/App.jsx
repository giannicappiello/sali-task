import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { AuthProvider } from "./contexts/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import Layout from "./components/Layout";
import OrdersDataPreloader from "./components/OrdersDataPreloader";
import GlobalWindowShortcuts from "./components/GlobalWindowShortcuts";
import BrandedDialogProvider from "./components/BrandedDialogProvider";
import NotificationManager from "./components/NotificationManager";
import WorkspaceAccessGuard from "./components/WorkspaceAccessGuard";
import SettingsAccessGuard from "./components/SettingsAccessGuard";

import Login from "./pages/Login/Login";

const Home = lazy(() => import("./pages/Home/Home"));
const ActivitiesModule = lazy(() => import("./pages/Activities/ActivitiesModule"));
const Agenda = lazy(() => import("./pages/Agenda/Agenda"));
const Products = lazy(() => import("./pages/Products/Products"));
const Documentation = lazy(() => import("./pages/Documentation/Documentation"));
const ManualiUso = lazy(() => import("./pages/Documentation/ManualiUso"));
const Messages = lazy(() => import("./pages/Messages/Messages"));
const Team = lazy(() => import("./pages/Team/Team"));
const Calendar = lazy(() => import("./pages/Calendar/Calendar"));
const Settings = lazy(() => import("./pages/Settings/Settings"));
const SettingsHub = lazy(() => import("./pages/Settings/SettingsHub"));
const AccessUsers = lazy(() => import("./pages/Settings/AccessUsers"));
const AccessRules = lazy(() => import("./pages/Settings/AccessRules"));
const AccessCheck = lazy(() => import("./pages/Settings/AccessCheck"));
const MexalDiagnostics = lazy(() => import("./pages/Settings/MexalDiagnostics"));
const NotificationSettings = lazy(() => import("./pages/Settings/NotificationSettings"));
const ModuleManagement = lazy(() => import("./pages/Settings/ModuleManagement"));
const MenuManagement = lazy(() => import("./pages/Settings/MenuManagement"));
const WorkspaceMenuContainer = lazy(() => import("./pages/Modules/WorkspaceMenuContainer"));
const AISettings = lazy(() => import("./pages/Settings/AISettings"));
const Notifications = lazy(() => import("./pages/Notifications/Notifications"));
const AIAssistant = lazy(() => import("./pages/AIAssistant/AIAssistant"));
const Production = lazy(() => import("./pages/Production/Production"));
const WorkspaceModuleContainer = lazy(() => import("./pages/Modules/WorkspaceModuleContainer"));
const ProgreMesLaunch = lazy(() => import("./pages/ProgreMes/ProgreMesLaunch"));

const PharmacyModule = lazy(() =>
  import("./modules/pharmacy/PharmacyModule")
);

const OrdersModule = lazy(() =>
  import("./modules/orders/OrdersModule")
);

const IntegrationsModule = lazy(() =>
  import("./modules/integrations/IntegrationsModule")
);
const AnalyticsModule = lazy(() =>
  import("./modules/analytics/AnalyticsModule")
);

import "./styles/App.css";
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
      <BrandedDialogProvider />
      <OrdersDataPreloader />
      <GlobalWindowShortcuts />
      <NotificationManager />
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
              <Route path="manuali-uso" element={<WorkspaceAccessGuard moduleCode="manuali_uso"><ManualiUso /></WorkspaceAccessGuard>} />
              <Route path="messages" element={<Messages />} />
              <Route path="team" element={<WorkspaceAccessGuard moduleCode="team"><Team /></WorkspaceAccessGuard>} />
              <Route path="calendar" element={<Calendar />} />
              <Route path="reports" element={<Navigate to="/analisi-dati/attivita" replace />} />
              <Route path="analysis-data" element={<Navigate to="/analisi-dati/attivita" replace />} />
              <Route path="analisi-dati/*" element={<AnalyticsModule />} />
              <Route path="settings" element={<SettingsAccessGuard><SettingsHub /></SettingsAccessGuard>} />
              <Route path="settings/users" element={<SettingsAccessGuard adminOnly><AccessUsers /></SettingsAccessGuard>} />
              <Route path="settings/access-rules" element={<SettingsAccessGuard adminOnly><AccessRules /></SettingsAccessGuard>} />
              <Route path="settings/access-check" element={<SettingsAccessGuard adminOnly><AccessCheck /></SettingsAccessGuard>} />
              <Route path="settings/team" element={<Navigate to="/settings/users" replace />} />
              <Route path="settings/organization" element={<Navigate to="/settings/access-rules" replace />} />
              <Route path="settings/projects" element={<SettingsAccessGuard any={["settings.manage"]}><Settings section="projects" /></SettingsAccessGuard>} />
              <Route path="settings/mexal-diagnostics" element={<SettingsAccessGuard any={["settings.manage"]}><MexalDiagnostics /></SettingsAccessGuard>} />
              <Route path="settings/notifications" element={<NotificationSettings />} />
              <Route path="settings/modules" element={<SettingsAccessGuard adminOnly><ModuleManagement /></SettingsAccessGuard>} />
              <Route path="settings/menu" element={<SettingsAccessGuard adminOnly><MenuManagement /></SettingsAccessGuard>} />
              <Route path="settings/ai" element={<SettingsAccessGuard any={["settings.manage"]}><AISettings /></SettingsAccessGuard>} />
              <Route path="notifications" element={<Notifications />} />
              <Route path="assistente-ai" element={<WorkspaceAccessGuard moduleCode="assistente_ai"><AIAssistant /></WorkspaceAccessGuard>} />
              <Route path="produzione/*" element={<WorkspaceAccessGuard moduleCode="progremes"><Production /></WorkspaceAccessGuard>} />
              <Route path="moduli/:moduleCode" element={<WorkspaceModuleContainer />} />
              <Route path="menu/:menuCode" element={<WorkspaceMenuContainer />} />
              <Route path="progremes/accesso" element={<WorkspaceAccessGuard moduleCode="progremes"><ProgreMesLaunch /></WorkspaceAccessGuard>} />
              <Route path="progremes" element={<Navigate to="/home" replace />} />
              <Route path="farmacie/*" element={<WorkspaceAccessGuard moduleCode="beauty_days"><PharmacyModule /></WorkspaceAccessGuard>} />
              <Route path="ordini/*" element={<Navigate to="/ordini-prof" replace />} />
              <Route path="ordini-prof/*" element={<WorkspaceAccessGuard moduleCode="ordini_pr"><OrdersModule moduleCode="prof" title="Ordini PR" basePath="/ordini-prof" /></WorkspaceAccessGuard>} />
              <Route path="ordini-ph/*" element={<WorkspaceAccessGuard moduleCode="ordini_ph"><OrdersModule moduleCode="ph" title="Ordini PH" basePath="/ordini-ph" /></WorkspaceAccessGuard>} />
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
