import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import { useAuth } from "../../../contexts/AuthContext";
import { orderModuleDefinition } from "../services/orderModules";

function normalizeAgentCodes(values) {
  const source = Array.isArray(values)
    ? values
    : String(values || "").split(/[\n,;]+/);

  return [
    ...new Set(
      source
        .map((value) => String(value || "").trim().toUpperCase())
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

export default function useOrdersAccess(moduleCode = "prof") {
  const { profile, isAdminUser, canUseModule, dataScope } = useAuth();
  const moduleDefinition = orderModuleDefinition(moduleCode);
  const workspaceModuleCode = moduleDefinition.workspaceCode;
  const customerCode = dataScope?.customerCode || null;
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

      if (customerCode) {
        if (active) {
          setAccess({
            enabled: true,
            ruolo_ordini: "cliente",
            codice_agente_mexal: null,
            agenti_gestiti: [],
            admin: false,
          });
          setLoading(false);
        }
        return;
      }

      const [integrationResult, scopeResult] = await Promise.all([
        supabase
          .from("integrazioni_utenti")
          .select("enabled,ruolo_ordini")
          .eq("utente_id", profile.id)
          .eq("modulo", moduleDefinition.integrationCode)
          .maybeSingle(),
        supabase.rpc("visible_mexal_agent_codes"),
      ]);

      if (!active) return;

      if (integrationResult.error || scopeResult.error) {
        const accessError = integrationResult.error || scopeResult.error;
        console.error("Errore caricamento accesso Gestione Ordini:", accessError);
        setError(accessError);
        setAccess(emptyAccess());
        setLoading(false);
        return;
      }

      setAccess({
        enabled: integrationResult.data?.enabled === true,
        ruolo_ordini: integrationResult.data?.ruolo_ordini || "agente",
        codice_agente_mexal: normalizeAgentCodes(scopeResult.data)[0] || null,
        agenti_gestiti: normalizeAgentCodes(scopeResult.data),
        admin: false,
      });

      setLoading(false);
    }

    loadAccess();

    return () => {
      active = false;
    };
  }, [profile?.id, isAdminUser, customerCode, moduleDefinition.integrationCode]);

  const permissions = useMemo(() => {
    const canReadModule = canUseModule(workspaceModuleCode, "lettura");
    const canWriteModule = canUseModule(workspaceModuleCode, "scrittura");
    const canManageModule = canUseModule(workspaceModuleCode, "amministrazione");
    const enabled = access.enabled === true && canReadModule;
    const role = access.ruolo_ordini;

    const isAdmin = access.admin === true;
    const isBackoffice = enabled && role === "backoffice";
    const isAreaManager = enabled && role === "area_manager";
    const isAgent = enabled && role === "agente";
    const isCustomer = enabled && role === "cliente";
    const canCreateCustomerPrivateOrder = isCustomer && workspaceModuleCode === "ordini_private";

    const agentCode = isAgent ? access.codice_agente_mexal : null;
    const managedAgents = isAreaManager ? access.agenti_gestiti : [];

    let visibleAgents = [];

    if (isAdmin || isBackoffice) {
      visibleAgents = null;
    } else if (isAreaManager) {
      visibleAgents = managedAgents;
    } else if (isAgent) {
      visibleAgents = access.agenti_gestiti;
    }

    return {
      enabled,
      role,
      isAdmin,
      isBackoffice,
      isAreaManager,
      isAgent,
      isCustomer,
      customerCode,
      agentCode,
      managedAgents,
      visibleAgents,
      canSeeAll: isAdmin || isBackoffice,
      canWriteAll: !isCustomer && canWriteModule && (isAdmin || isBackoffice),
      canAccessOrders: isAdmin || enabled,
      canWriteOrders: canCreateCustomerPrivateOrder || (!isCustomer && (isAdmin || (enabled && canWriteModule))),
      canUseAIOrderGeneration: !isCustomer && (isAdmin || (enabled && canWriteModule)),
      canManageOrders: !isCustomer && (isAdmin || (enabled && canManageModule)),
    };
  }, [access, canUseModule, customerCode, workspaceModuleCode]);

  return {
    loading,
    error,
    access,
    ...permissions,
  };
}
