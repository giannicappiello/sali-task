import { useEffect, useMemo, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { BarChart3, CalendarDays, ContactRound, MapPinned, Package, ShieldCheck, Store } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../contexts/AuthContext";
import Dashboard from "./pages/Dashboard";
import ApertureContatti from "./pages/ApertureContatti";
import Giornate from "./pages/Giornate";
import Analisi from "./pages/Analisi";
import Prodotti from "./pages/Prodotti";
import Farmacie from "./pages/Farmacie";
import Utenti from "./pages/Utenti";
import "./report-style.css";
import "./report-app.css";
import "./pharmacy-module.css";

const items = [
  ["dashboard", "Dashboard", BarChart3], ["aperture", "Aperture/Contatti", ContactRound],
  ["giornate", "Giornate", CalendarDays], ["analisi", "Analisi dati", BarChart3],
  ["prodotti", "Prodotti", Package], ["farmacie", "Farmacie", Store], ["utenti", "Utenti", ShieldCheck],
];

export default function PharmacyModule() {
  const { profile, isAdminUser } = useAuth();
  const [context, setContext] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => { loadContext(); }, [profile?.id]);
  async function loadContext() {
    setLoading(true); setError("");
    const { data, error: invokeError } = await supabase.functions.invoke("report-giornate-api", { body: { action: "context" } });
    if (invokeError || data?.error) setError(data?.error || invokeError?.message || "Accesso non configurato");
    else setContext(data);
    setLoading(false);
  }

  const legacyUser = useMemo(() => {
    const externalBeautyId = context?.external_beauty_id || null;
    const externalAgentId = context?.external_agent_id || null;
    const externalRole = context?.external_role || (isAdminUser ? "admin" : "beauty");

    return {
      id: context?.external_user_id || profile?.auth_user_id || profile?.id,
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

  if (loading) return <div className="pharmacy-state panel">Caricamento Gestione Farmacie...</div>;
  if (error) return <div className="pharmacy-state panel"><MapPinned size={36}/><h3>Accesso non disponibile</h3><p>{error}</p><p>L'amministratore deve abilitare il modulo da Impostazioni → Accessi Farmacie.</p></div>;

  const allowed = context?.allowed_pages || items.map(([id]) => id);
  return <div className="pharmacy-module">
    <div className="pharmacy-module-header">
      <div><h1>Gestione Farmacie</h1><p>Giornate promozionali, aperture, farmacie e analisi.</p></div>
      <span className="pharmacy-access-badge">{legacyUser.ruolo} · {context?.access_level}</span>
    </div>
    <nav className="pharmacy-subnav">{items.filter(([id]) => allowed.includes(id)).map(([id,label,Icon]) => <NavLink key={id} to={`/farmacie/${id}`}><Icon size={17}/>{label}</NavLink>)}</nav>
    <div className="pharmacy-content"><Routes>
      <Route index element={<Navigate to="dashboard" replace/>}/>
      <Route path="dashboard" element={<Dashboard utente={legacyUser}/>}/>
      <Route path="aperture" element={<ApertureContatti utente={legacyUser}/>}/>
      <Route path="giornate" element={<Giornate utente={legacyUser}/>}/>
      <Route path="analisi" element={<Analisi utente={legacyUser}/>}/>
      <Route path="prodotti" element={<Prodotti utente={legacyUser}/>}/>
      <Route path="farmacie" element={<Farmacie utente={legacyUser}/>}/>
      <Route path="utenti" element={isAdminUser ? <Utenti utente={legacyUser}/> : <Navigate to="dashboard" replace/>}/>
      <Route path="*" element={<Navigate to="dashboard" replace/>}/>
    </Routes></div>
  </div>;
}
