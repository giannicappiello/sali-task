import { useState } from "react";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Tasks from "./pages/Tasks";
import Projects from "./pages/Projects";
import Products from "./pages/Products";
import Team from "./pages/Team";
import Calendar from "./pages/Calendar";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";
import "./styles/App.css";

function App() {
  const [activePage, setActivePage] = useState("dashboard");

  const pages = {
    dashboard: <Dashboard />,
    tasks: <Tasks />,
    projects: <Projects />,
    products: <Products />,
    team: <Team />,
    calendar: <Calendar />,
    reports: <Reports />,
    settings: <Settings />,
  };

  return (
    <Layout activePage={activePage} setActivePage={setActivePage}>
      {pages[activePage]}
    </Layout>
  );
}

export default App;