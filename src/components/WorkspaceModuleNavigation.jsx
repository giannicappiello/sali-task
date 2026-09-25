import { NavLink, useLocation } from 'react-router-dom';
import { moduleScreenNavigation } from '../config/moduleScreenNavigation';
import { isProgremesScreenPath, requestProgremesWorkspaceWindow } from '../pages/ProgreMes/progremesWindow';
import './workspace-module-navigation.css';

export default function WorkspaceModuleNavigation({ catalog, canRead }) {
 const location = useLocation();
 const navigation = moduleScreenNavigation(catalog, location.pathname, location.state?.workspaceModuleCode, canRead);
 if (!navigation) return null;
 return <nav className="workspace-module-navigation" aria-label={`Schermate ${navigation.module.nome}`}>
  {navigation.items.map(screen => <NavLink key={screen.codice} to={screen.percorso} state={{workspaceModuleCode:navigation.module.codice}} end onClick={event => {
   if (isProgremesScreenPath(screen.percorso) && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
    event.preventDefault(); requestProgremesWorkspaceWindow(screen.percorso);
   }
  }}>{screen.nome}</NavLink>)}
 </nav>;
}
