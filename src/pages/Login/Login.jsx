import { useEffect, useState } from "react";
import { Eye, EyeOff, Lock, Mail, ShieldCheck } from "lucide-react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";

function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { session, signIn, resetPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    const saved = window.localStorage.getItem("progre-login-email");
    if (saved) setEmail(saved);
  }, []);

  if (session) return <Navigate to={location.state?.from?.pathname || "/dashboard"} replace />;

  async function handleSubmit(e) {
    e.preventDefault();
    setMessage(null);
    if (!email.trim() || !password) {
      setMessage({ type: "error", text: "Inserisci email e password." });
      return;
    }
    setSubmitting(true);
    const result = await signIn(email.trim(), password);
    setSubmitting(false);
    if (!result.success) {
      setMessage({ type: "error", text: result.error?.message || "Credenziali non valide." });
      return;
    }
    if (remember) window.localStorage.setItem("progre-login-email", email.trim());
    else window.localStorage.removeItem("progre-login-email");
    navigate(location.state?.from?.pathname || "/dashboard", { replace: true });
  }

  async function handleResetPassword() {
    setMessage(null);
    if (!email.trim()) {
      setMessage({ type: "error", text: "Inserisci prima la tua email." });
      return;
    }
    const result = await resetPassword(email.trim());
    setMessage(result.success ? { type: "success", text: "Email di recupero inviata." } : { type: "error", text: result.error?.message || "Impossibile inviare il recupero password." });
  }

  return (
    <div className="login-page login-v4">
      <div className="login-left">
        <div className="login-brand"><div className="login-logo">P</div><div><h1>PROGRE</h1><p>WORKSPACE 4.0</p></div></div>
        <div className="login-copy"><span>PLM cosmetico collaborativo</span><h2>Sviluppo prodotto, documentazione, task e reparti in un unico workspace.</h2><p>Agenda personale, progetti con checklist, documentazione regolatoria, prodotti, messaggi e dashboard reparto.</p></div>
        <div className="login-badges"><span>Installabile PWA</span><span>Supabase realtime</span><span>Ruoli e permessi</span></div>
      </div>
      <div className="login-right"><form className="login-card" onSubmit={handleSubmit}><div className="login-card-header"><ShieldCheck size={34} /><h2>Accedi</h2><p>Usa le credenziali abilitate su Supabase Auth.</p></div>{message && <div className={`auth-alert ${message.type}`}>{message.text}</div>}<label className="login-field"><span>Email</span><div><Mail size={19} /><input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@progre.it" /></div></label><label className="login-field"><span>Password</span><div><Lock size={19} /><input type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" /><button type="button" className="show-password-btn" onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></label><div className="login-options"><label><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />Ricorda email</label><button type="button" onClick={handleResetPassword}>Password dimenticata?</button></div><button className="login-submit" disabled={submitting}>{submitting ? "Accesso in corso..." : "Entra nel workspace"}</button></form></div>
    </div>
  );
}

export default Login;
