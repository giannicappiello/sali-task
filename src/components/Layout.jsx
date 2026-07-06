import {
  LayoutDashboard,
  CheckSquare,
  Folder,
  Package,
  Users,
  CalendarDays,
  BarChart3,
  Settings,
  Search,
  Bell,
  MessageCircle,
  Sun,
  Moon,
  Menu,
} from "lucide-react";

const menuItems = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "tasks", label: "Task", icon: CheckSquare },
  { id: "projects", label: "Progetti", icon: Folder },
  { id: "products", label: "Prodotti", icon: Package },
  { id: "team", label: "Team", icon: Users },
  { id: "calendar", label: "Calendario", icon: CalendarDays },
  { id: "reports", label: "Report", icon: BarChart3 },
  { id: "settings", label: "Impostazioni", icon: Settings },
];

function Layout({ children, activePage, setActivePage }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-box">
          <div className="brand-logo">P</div>
          <div>
            <h1>PROGRE</h1>
            <p>WORKSPACE</p>
          </div>
        </div>

        <nav className="sidebar-nav">
          {menuItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={`nav-item ${activePage === item.id ? "active" : ""}`}
                onClick={() => setActivePage(item.id)}
              >
                <Icon size={21} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="favorites">
          <div className="favorites-title">
            <span>Preferiti</span>
            <strong>+</strong>
          </div>

          <div className="favorite-item violet">Nuova linea solari 2027</div>
          <div className="favorite-item green">Shampoo Riparatore</div>
          <div className="favorite-item orange">Rebranding linea viso</div>
          <div className="favorite-item blue">Campagna Autunno</div>
        </div>

        <div className="sidebar-user">
          <div className="avatar">GC</div>
          <div>
            <strong>Giulia Conti</strong>
            <span>Product Manager</span>
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <Menu size={24} />
            <div>
              <h2>Buongiorno, Giulia 👋</h2>
              <p>Ecco cosa sta succedendo oggi in Progre.</p>
            </div>
          </div>

          <div className="topbar-actions">
            <div className="search-box">
              <Search size={18} />
              <input placeholder="Cerca..." />
              <span>⌘ K</span>
            </div>

            <button className="icon-btn">
              <Bell size={21} />
              <small>3</small>
            </button>

            <button className="icon-btn">
              <MessageCircle size={21} />
            </button>

            <div className="theme-toggle">
              <Sun size={17} />
              <Moon size={17} />
            </div>
          </div>
        </header>

        <section className="content-area">{children}</section>
      </main>
    </div>
  );
}

export default Layout;