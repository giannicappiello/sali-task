import { useEffect, useMemo, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { BarChart3, CalendarDays, ContactRound, MapPinned } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../contexts/AuthContext";
import Dashboard from "./pages/Dashboard";
import ApertureContatti from "./pages/ApertureContatti";
import Giornate from "./pages/Giornate";
import Analisi from "./pages/Analisi";
import "./pharmacy-module.css";

const items = [
  ["dashboard", "Dashboard", BarChart3], ["aperture", "Aperture/Contatti", ContactRound],
  ["giornate", "Giornate", CalendarDays], ["analisi", "Analisi dati", BarChart3],
];

export default function PharmacyModule() {
  const { profile, isAdminUser } = useAuth();
  const [context, setContext] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function loadContext() {
      setLoading(true); setError("");
      const { data, error: invokeError } = await supabase.functions.invoke("report-giornate-api", { body: { action: "context" } });
      if (!active) return;
      if (invokeError || data?.error) setError(data?.error || invokeError?.message || "Accesso non configurato");
      else setContext(data);
      setLoading(false);
    }
    const timer = window.setTimeout(loadContext, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [profile?.id]);

  const legacyUser = useMemo(() => {
    const externalBeautyId = context?.external_beauty_id || null;
    const externalAgentId = context?.external_agent_id || null;
    const externalRole = context?.external_role || (isAdminUser ? "admin" : "beauty");

    return {
      id: context?.external_user_id || null,
      nome: profile?.nome || profile?.email || "Utente",
      cognome: profile?.cognome || "",
      email: profile?.email,

      // Campi legacy usati dalle pagine originali di report-giornate.
      ruolo: externalRole,
      beauty_id: externalBeautyId,
      beauty_consultant_id: externalBeautyId,
      agent_id: externalAgentId,

      // Campi del nuovo sistema centralizzato.
      external_role: externalRole,
      external_user_id: context?.external_user_id || null,
      external_beauty_id: externalBeautyId,
      external_agent_id: externalAgentId,
      access_level: context?.access_level || "read",
      allowed_pages: context?.allowed_pages || [],
    };
  }, [context, profile, isAdminUser]);

  if (loading) return <div className="pharmacy-state panel">Caricamento Beauty Days...</div>;
  if (error) return <div className="pharmacy-state panel"><MapPinned size={36}/><h3>Accesso non disponibile</h3><p>{error}</p><p>L'amministratore deve abilitare il modulo da Impostazioni → Accessi Beauty Days.</p></div>;

  const allowed = context?.allowed_pages || items.map(([id]) => id);
  return <div className="pharmacy-module v4-page">
    <div className="pharmacy-module-header">
      <div><h1>Beauty Days</h1><p>Giornate promozionali, attività, clienti Mexal e analisi.</p></div>
      <span className="pharmacy-access-badge">{legacyUser.ruolo} · {context?.access_level}</span>
    </div>
    <nav className="pharmacy-subnav">{items.filter(([id]) => allowed.includes(id)).map(([id,label,Icon]) => <NavLink key={id} to={`/farmacie/${id}`}><Icon size={17}/>{label}</NavLink>)}</nav>
    <div className="pharmacy-content"><Routes>
      <Route index element={<Navigate to="dashboard" replace/>}/>
      <Route path="dashboard" element={<Dashboard utente={legacyUser}/>}/>
      <Route path="aperture" element={<ApertureContatti utente={legacyUser}/>}/>
      <Route path="giornate" element={<Giornate utente={legacyUser}/>}/>
      <Route path="analisi" element={<Analisi utente={legacyUser}/>}/>
      <Route path="prodotti" element={<Navigate to="/farmacie/dashboard" replace/>}/>
      <Route path="clienti" element={<Navigate to="/farmacie/giornate" replace/>}/>
      <Route path="farmacie" element={<Navigate to="/farmacie/giornate" replace/>}/>
      <Route path="*" element={<Navigate to="dashboard" replace/>}/>
    </Routes></div>
  </div>;
}
