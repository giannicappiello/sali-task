import { useEffect, useMemo, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { BarChart3, CalendarDays, ContactRound, MapPinned } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../contexts/AuthContext";
import useOrderedModuleScreens from "../../hooks/useOrderedModuleScreens";
import Dashboard from "./pages/Dashboard";
import ApertureContatti from "./pages/ApertureContatti";
import Giornate from "./pages/Giornate";
import "./pharmacy-module.css";

const items = [
  { id: "dashboard", screenCode: "beauty.dashboard", label: "Dashboard", icon: BarChart3, to: "/farmacie/dashboard" },
  { id: "aperture", screenCode: "beauty.aperture", label: "Aperture/Contatti", icon: ContactRound, to: "/farmacie/aperture" },
  { id: "giornate", screenCode: "beauty.giornate", label: "Giornate", icon: CalendarDays, to: "/farmacie/giornate" },
];

async function getFunctionErrorMessage(invokeError, fallback) {
  if (!invokeError) return fallback;
  try {
    const response = invokeError.context;
    if (response?.clone) {
      const payload = await response.clone().json();
      if (payload?.error || payload?.message) return payload.error || payload.message;
    }
  } catch {
    // La risposta non contiene JSON: usiamo il messaggio standard del client.
  }
  return invokeError.message || fallback;
}

export default function PharmacyModule() {
  const { profile, isAdminUser } = useAuth();
  const [context, setContext] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const { items: orderedItems, defaultItem } = useOrderedModuleScreens("beauty_days", items);

  useEffect(() => {
    let active = true;
    async function loadContext() {
      setLoading(true); setError("");
      const { data, error: invokeError } = await supabase.functions.invoke("report-giornate-api", { body: { action: "context" } });
      if (!active) return;
      if (invokeError || data?.error) {
        const message = data?.error || await getFunctionErrorMessage(invokeError, "Accesso non configurato");
        if (!active) return;
        setError(message);
      }
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
  if (error) return <div className="pharmacy-state panel"><MapPinned size={36}/><h3>{isAdminUser ? "Errore di collegamento" : "Accesso non disponibile"}</h3><p>{error}</p>{!isAdminUser ? <p>L'amministratore deve abilitare il modulo da Impostazioni → Accessi Beauty Days.</p> : <p>L'amministratore dispone sempre di accesso completo: riprova o verifica il servizio Beauty Days.</p>}</div>;

  const allowed = context?.allowed_pages || items.map((item) => item.id);
  const visibleItems = orderedItems.filter((item) => allowed.includes(item.id));
  const firstVisiblePath = (visibleItems.includes(defaultItem) ? defaultItem : visibleItems[0])?.to || "/home";
  return <div className="pharmacy-module v4-page">
    <nav className="pharmacy-subnav">{visibleItems.map((item) => { const Icon = item.icon; return <NavLink key={item.id} to={item.to}><Icon size={17}/>{item.label}</NavLink>; })}</nav>
    <div className="pharmacy-content"><Routes>
      <Route index element={<Navigate to={firstVisiblePath} replace/>}/>
      <Route path="dashboard" element={<Dashboard utente={legacyUser}/>}/>
      <Route path="aperture" element={<ApertureContatti utente={legacyUser}/>}/>
      <Route path="giornate" element={<Giornate utente={legacyUser}/>}/>
      <Route path="analisi" element={<Navigate to="/analisi-dati/beauty-days" replace/>}/>
      <Route path="prodotti" element={<Navigate to="/farmacie/dashboard" replace/>}/>
      <Route path="clienti" element={<Navigate to="/farmacie/giornate" replace/>}/>
      <Route path="farmacie" element={<Navigate to="/farmacie/giornate" replace/>}/>
      <Route path="*" element={<Navigate to={firstVisiblePath} replace/>}/>
    </Routes></div>
  </div>;
}
