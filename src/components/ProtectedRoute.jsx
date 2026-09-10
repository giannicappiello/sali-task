import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

function ProtectedRoute() {
  const { session, loading, authError } = useAuth();
  const location = useLocation();

  if (authError) {
    return <div className="auth-loading"><div className="auth-loading-card" role="alert">
      <p>{authError}</p>
      <button type="button" onClick={() => window.location.reload()}>Riprova</button>
    </div></div>;
  }

  if (loading) {
    return (
      <div className="auth-loading">
        <div className="auth-loading-card">
          <div className="auth-spinner" />
          <p>Caricamento Progre Workspace...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}

export default ProtectedRoute;
