import { Blocks, Monitor, FolderTree, Menu, UsersRound, Shield, Eye } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import "./settings-workspace-nav.css";

const SECTIONS = [
  { id: "modules", label: "Moduli", to: "/settings/modules", screen: "impostazioni.moduli", Icon: Blocks },
  { id: "screens", label: "Schermate", to: "/settings/modules?view=screens", screen: "impostazioni.moduli", Icon: Monitor },
  { id: "areas", label: "Aree", to: "/settings/menu?view=areas", screen: "impostazioni.menu", Icon: FolderTree },
  { id: "menu", label: "Menu", to: "/settings/menu?view=menu", screen: "impostazioni.menu", Icon: Menu },
  { id: "users", label: "Utenti", to: "/settings/users", screen: "impostazioni.utenti_accessi", Icon: UsersRound },
  { id: "roles", label: "Ruoli", to: "/settings/access-rules", screen: "impostazioni.regole_accesso", Icon: Shield },
  { id: "access", label: "Verifica accessi", to: "/settings/access-check", screen: "impostazioni.verifica_accessi", Icon: Eye },
];

export default function SettingsWorkspaceNav({ active, localSections = [], onSelect }) {
  const { isAdminUser, hasScreenAccess } = useAuth();
  // Reuse the existing protected pages; navigation must not grant new access.
  if (!isAdminUser) return null;
  return <nav className="settings-workspace-nav" aria-label="Configurazione Workspace">
    {SECTIONS.filter((item) => hasScreenAccess(item.screen, "impostazioni")).map(({ id, label, to, Icon }) => {
      const content = <><Icon size={17} aria-hidden="true" />{label}</>;
      return localSections.includes(id) && onSelect
        ? <button key={id} type="button" className={active === id ? "active" : ""} aria-pressed={active === id} onClick={() => onSelect(id)}>{content}</button>
        : <Link key={id} to={to} className={active === id ? "active" : ""} aria-current={active === id ? "page" : undefined}>{content}</Link>;
    })}
  </nav>;
}
