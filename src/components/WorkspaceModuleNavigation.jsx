import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { moduleScreenNavigation } from '../config/moduleScreenNavigation';
import { isProgremesScreenPath, requestProgremesWorkspaceWindow } from '../pages/ProgreMes/progremesWindow';
import './workspace-module-navigation.css';

export default function WorkspaceModuleNavigation({ catalog, canRead }) {
 const location = useLocation();
 const navRef = useRef(null);
 const [covered, setCovered] = useState(false);
 const navigation = moduleScreenNavigation(catalog, location.pathname, location.state?.workspaceModuleCode, canRead);
 const destinations = JSON.stringify(navigation?.items.map(screen => screen.percorso) || []);
 useEffect(() => {
  const root = navRef.current?.parentElement;
  if (!root) return;
  const normalize = value => { const url = new URL(value, window.location.origin); return url.pathname.replace(/\/$/, '') + url.search; };
  const expected = JSON.parse(destinations).map(normalize);
  const check = () => {
   const local = root.querySelectorAll('.activities-tabs, .production-module-navigation, .crm-section-nav, .orders-module-navigation, .settings-workspace-nav, .pharmacy-subnav');
   const matches = Array.from(local).some(bar => {
    const paths = new Set(Array.from(bar.querySelectorAll('a[href]'), link => normalize(link.href)));
    return expected.length > 0 && expected.every(path => paths.has(path));
   });
   setCovered(matches);
  };
  check();
  const observer = new MutationObserver(check);
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
  return () => observer.disconnect();
 }, [destinations, location.pathname]);
 if (!navigation) return null;
 return <nav ref={navRef} style={covered ? {display: 'none'} : undefined} className="workspace-module-navigation" aria-label={`Schermate ${navigation.module.nome}`}>
  {navigation.items.map(screen => <NavLink key={screen.codice} to={screen.percorso} state={{workspaceModuleCode:navigation.module.codice}} end onClick={event => {
   if (isProgremesScreenPath(screen.percorso) && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
    event.preventDefault(); requestProgremesWorkspaceWindow(screen.percorso);
   }
  }}>{screen.nome}</NavLink>)}
 </nav>;
}
