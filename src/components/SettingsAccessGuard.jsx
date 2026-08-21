import { Navigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

export default function SettingsAccessGuard({ any = ["settings.manage", "users.manage"], adminOnly = false, children }) {
  const { hasPermission, isAdminUser } = useAuth();
  const allowed = isAdminUser || (!adminOnly && any.some((permission) => hasPermission(permission)));
  return allowed ? children : <Navigate to="/home" replace />;
}
