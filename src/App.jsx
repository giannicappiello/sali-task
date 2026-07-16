import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { AuthProvider } from "./contexts/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import Layout from "./components/Layout";

import Login from "./pages/Login/Login";

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

const PharmacyModule = lazy(() =>
  import("./modules/pharmacy/PharmacyModule")
);

const OrdersModule = lazy(() =>
  import("./modules/orders/OrdersModule")
);

import "./styles/App.css";

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
      <Suspense fallback={<Loader />}>
        <Routes>
          <Route path="/login" element={<Login />} />

          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<Layout />}>
              <Route index element={<Navigate to="/dashboard" replace />} />

              <Route path="dashboard" element={<Dashboard />} />
              <Route path="agenda" element={<Agenda />} />
              <Route path="reminders" element={<Agenda />} />
              <Route path="tasks" element={<Tasks />} />
              <Route path="projects" element={<Projects />} />
              <Route path="products" element={<Products />} />
              <Route path="documentation" element={<Documentation />} />
              <Route path="messages" element={<Messages />} />
              <Route path="team" element={<Team />} />
              <Route path="calendar" element={<Calendar />} />
              <Route path="reports" element={<Reports />} />
              <Route path="analysis-data" element={<Reports />} />
              <Route path="settings" element={<Settings />} />
              <Route path="farmacie/*" element={<PharmacyModule />} />
              <Route path="ordini/*" element={<OrdersModule />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Suspense>
    </AuthProvider>
  );
}

export default App;