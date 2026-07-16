import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import { useAuth } from "../../../contexts/AuthContext";

export default function useOrdersAccess() {
  const { profile, isAdminUser } = useAuth();
  const [loading, setLoading] = useState(true);
  const [access, setAccess] = useState(null);

  useEffect(() => {
    let active = true;

    async function load() {
      if (!profile?.id) {
        if (active) {
          setAccess(null);
          setLoading(false);
        }
        return;
      }

      if (isAdminUser) {
        if (active) {
          setAccess({ enabled: true, codice_agente_mexal: null, admin: true });
          setLoading(false);
        }
        return;
      }

      const { data, error } = await supabase
        .from("integrazioni_utenti")
        .select("enabled,codice_agente_mexal")
        .eq("utente_id", profile.id)
        .eq("modulo", "gestione_ordini")
        .maybeSingle();

      if (error) console.error("Errore accesso ordini:", error);
      if (active) {
        setAccess(data || null);
        setLoading(false);
      }
    }

    load();
    return () => { active = false; };
  }, [profile?.id, isAdminUser]);

  return { loading, access, agentCode: access?.codice_agente_mexal || null, isAdmin: access?.admin === true };
}
