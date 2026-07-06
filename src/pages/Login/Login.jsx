import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Eye, EyeOff, Lock, Mail } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";

function Login() {
  const { session, signIn, resetPassword } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const from = location.state?.from?.pathname || "/dashboard";

  if (session) {
    return <Navigate to={from} replace />;
  }

  async function handleSubmit(e) {
    e.preventDefault();

    setMessage("");
    setErrorMessage("");

    if (!email.trim() || !password.trim()) {
      setErrorMessage("Inserisci email e password.");
      return;
    }

    setSubmitting(true);

    const result = await signIn(email.trim(), password);

    setSubmitting(false);

    if (!result.success) {
      setErrorMessage("Email o password non corretti.");
      return;
    }

    navigate(from, { replace: true });
  }

  async function handleResetPassword() {
    setMessage("");
    setErrorMessage("");

    if (!email.trim()) {
      setErrorMessage("Inserisci prima la tua email.");
      return;
    }

    const result = await resetPassword(email.trim());

    if (!result.success) {
      setErrorMessage("Non è stato possibile inviare il recupero password.");
      return;
    }

    setMessage("Ti abbiamo inviato una email per reimpostare la password.");
  }

  return (
    <div className="login-page">
      <div className="login-left">
        <div className="login-brand">
          <div className="login-logo">P</div>
          <div>
            <h1>PROGRE</h1>
            <p>WORKSPACE</p>
          </div>
        </div>

        <div className="login-copy">
          <span>Gestionale interno</span>
          <h2>Organizza task, progetti, prodotti e deadline in un unico workspace.</h2>
          <p>
            Accesso riservato al team Progre. Le attività, lo storico e i dati
            aziendali sono protetti da autenticazione.
          </p>
        </div>
      </div>

      <div className="login-right">
        <form className="login-card" onSubmit={handleSubmit}>
          <div className="login-card-header">
            <h2>Accedi</h2>
            <p>Inserisci le tue credenziali per entrare nel workspace.</p>
          </div>

          {errorMessage && <div className="auth-alert error">{errorMessage}</div>}
          {message && <div className="auth-alert success">{message}</div>}

          <label className="login-field">
            <span>Email</span>
            <div>
              <Mail size={18} />
              <input
                type="email"
                placeholder="nome@progre.it"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </div>
          </label>

          <label className="login-field">
            <span>Password</span>
            <div>
              <Lock size={18} />
              <input
                type={showPassword ? "text" : "password"}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
              <button
                type="button"
                className="show-password-btn"
                onClick={() => setShowPassword((value) => !value)}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </label>

          <div className="login-options">
            <label>
              <input type="checkbox" defaultChecked />
              Ricordami
            </label>

            <button type="button" onClick={handleResetPassword}>
              Password dimenticata?
            </button>
          </div>

          <button type="submit" className="login-submit" disabled={submitting}>
            {submitting ? "Accesso in corso..." : "Accedi"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default Login;
