import { Navigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

export default function WorkspaceAccessGuard({ moduleCode, featureCode, redirectTo = "/home", children }) {
  const { hasModuleAccess, hasWorkspaceFeature } = useAuth();
  const allowed = moduleCode
    ? hasModuleAccess(moduleCode)
    : featureCode
      ? hasWorkspaceFeature(featureCode)
      : false;

  return allowed ? children : <Navigate to={redirectTo} replace />;
}
