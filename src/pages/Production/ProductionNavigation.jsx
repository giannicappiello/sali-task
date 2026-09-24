import { NavLink, useLocation } from 'react-router-dom';
import { requestProgremesWorkspaceWindow } from '../ProgreMes/progremesWindow';
import './production-navigation.css';

export default function ProductionNavigation({ sections }) {
  const { pathname } = useLocation();
  if (!sections.length) return null;
  return <nav className="production-module-navigation" aria-label="Schermate Gestione produzione">
    {sections.map(section => {
      const path = section.workspaceLocal ? section.path : `/produzione/${encodeURIComponent(section.code)}`;
      return <NavLink key={section.code} to={path} end onClick={event => {
        if (!section.workspaceLocal && pathname !== path && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
          event.preventDefault();
          requestProgremesWorkspaceWindow(path);
        }
      }}>{section.name}</NavLink>;
    })}
  </nav>;
}
