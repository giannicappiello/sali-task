import { useLocation } from 'react-router-dom';
import WorkspaceAccessGuard from './WorkspaceAccessGuard';
import ProgreMesLaunch from '../pages/ProgreMes/ProgreMesLaunch';
import { operationalMesRoute } from '../lib/operationalMesRoute';

export default function ProductionEntry({ children }) {
  const location = useLocation();
  if (operationalMesRoute(location.pathname, location.search)) return (
    <WorkspaceAccessGuard moduleCode="attivita" screenCode="attivita.dashboard">
      <ProgreMesLaunch screenCode="progremes.PlanningProduction" search={location.search} />
    </WorkspaceAccessGuard>
  );
  return <WorkspaceAccessGuard moduleCode="progremes">{children}</WorkspaceAccessGuard>;
}
