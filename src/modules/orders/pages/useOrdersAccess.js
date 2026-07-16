import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import { useAuth } from "../../../contexts/AuthContext";

const MODULE_CODE = "gestione_ordini";

function normalizeAgentCode(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeAgentCodes(values) {
  const source = Array.isArray(values)
    ? values
    : String(values || "").split(/[\n,;]+/);

  return [
    ...new Set(
      source
        .map((value) => normalizeAgentCode(value))
        .filter(Boolean)
    ),
  ];
}

function emptyAccess() {
  return {
    enabled: false,
    ruolo_ordini: null,
    codice_agente_mexal: null,
    agenti_gestiti: [],
    admin: false,
  };
}

export default function useOrdersAccess() {
  const { profile, isAdminUser } = useAuth();
  const [loading, setLoading] = useState(true);
  const [access, setAccess] = useState(emptyAccess());
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;

    async function loadAccess() {
      setLoading(true);
      setError(null);

      if (!profile?.id) {
        if (active) {
          setAccess(emptyAccess());
          setLoading(false);
        }
        return;
      }

      if (isAdminUser) {
        if (active) {
          setAccess({
            enabled: true,
            ruolo_ordini: "admin",
            codice_agente_mexal: null,
            agenti_gestiti: [],
            admin: true,
          });
          setLoading(false);
        }
        return;
      }

      const { data, error: queryError } = await supabase
        .from("integrazioni_utenti")
        .select("enabled,codice_agente_mexal,ruolo_ordini,agenti_gestiti")
        .eq("utente_id", profile.id)
        .eq("modulo", MODULE_CODE)
        .maybeSingle();

      if (!active) return;

      if (queryError) {
        console.error("Errore caricamento accesso Gestione Ordini:", queryError);
        setError(queryError);
        setAccess(emptyAccess());
        setLoading(false);
        return;
      }

      setAccess({
        enabled: data?.enabled === true,
        ruolo_ordini: data?.ruolo_ordini || "agente",
        codice_agente_mexal:
          normalizeAgentCode(data?.codice_agente_mexal) || null,
        agenti_gestiti: normalizeAgentCodes(data?.agenti_gestiti),
        admin: false,
      });

      setLoading(false);
    }

    loadAccess();

    return () => {
      active = false;
    };
  }, [profile?.id, isAdminUser]);

  const permissions = useMemo(() => {
    const enabled = access.enabled === true;
    const role = access.ruolo_ordini;

    const isAdmin = access.admin === true;
    const isBackoffice = enabled && role === "backoffice";
    const isAreaManager = enabled && role === "area_manager";
    const isAgent = enabled && role === "agente";

    const agentCode = isAgent ? access.codice_agente_mexal : null;
    const managedAgents = isAreaManager ? access.agenti_gestiti : [];

    let visibleAgents = [];

    if (isAdmin || isBackoffice) {
      visibleAgents = null;
    } else if (isAreaManager) {
      visibleAgents = managedAgents;
    } else if (isAgent && agentCode) {
      visibleAgents = [agentCode];
    }

    return {
      enabled,
      role,
      isAdmin,
      isBackoffice,
      isAreaManager,
      isAgent,
      agentCode,
      managedAgents,
      visibleAgents,
      canSeeAll: isAdmin || isBackoffice,
      canWriteAll: isAdmin || isBackoffice,
      canAccessOrders: isAdmin || enabled,
    };
  }, [access]);

  return {
    loading,
    error,
    access,
    ...permissions,
  };
}
