import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import { useAuth } from "../../../contexts/AuthContext";
import Analisi from "../../pharmacy/pages/Analisi";

export default function BeautyAnalysis() {
  const { profile, isAdminUser } = useAuth();
  const [context, setContext] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    supabase.functions.invoke("report-giornate-api", { body: { action: "context" } }).then(({ data, error: invokeError }) => {
      if (!active) return;
      setError(data?.error || invokeError?.message || "");
      setContext(data || null);
    });
    return () => { active = false; };
  }, [profile?.id]);
  const user = useMemo(() => ({
    id: context?.external_user_id || null,
    nome: profile?.nome || profile?.email || "Utente",
    cognome: profile?.cognome || "",
    email: profile?.email,
    ruolo: context?.external_role || (isAdminUser ? "admin" : "beauty"),
    beauty_id: context?.external_beauty_id || null,
    beauty_consultant_id: context?.external_beauty_id || null,
    agent_id: context?.external_agent_id || null,
    external_role: context?.external_role,
    external_user_id: context?.external_user_id,
    external_beauty_id: context?.external_beauty_id,
    external_agent_id: context?.external_agent_id,
    access_level: context?.access_level || "read",
    allowed_pages: context?.allowed_pages || [],
  }), [context, profile, isAdminUser]);
  if (error) return <div className="panel analytics-error">{error}</div>;
  if (!context) return <div className="panel">Caricamento analisi Beauty Days...</div>;
  return <Analisi utente={user} />;
}
