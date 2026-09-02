import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import {
  featureIsAvailable,
  moduleIsAvailable,
  moduleLevelAllows,
  moduleSelfServiceAllows,
  normalizeModuleAccessLevel,
  WORKSPACE_MODULES,
} from "../config/workspaceModules";

const AuthContext = createContext(null);
const EMPTY_DATA_SCOPE = Object.freeze({ mode: "propri", userIds: [], departmentIds: [], agentIds: [], customerCode: null, customerCodes: [] });
const WORKSPACE_ADMIN_ROLE_NAMES = new Set(["admin"]);

function workspaceRoleIsAdmin(role) {
  const roleName = String(role?.nome || "").trim().toLocaleLowerCase("it-IT");
  return role?.amministratore_workspace === true || WORKSPACE_ADMIN_ROLE_NAMES.has(roleName);
}

function permissionModuleCodes(code) {
  if (code === "dashboard.read" || /^(projects|tasks|agenda|reports)\./.test(code)) return ["attivita"];
  if (code.startsWith("products.")) return ["prodotti"];
  if (code.startsWith("documentation.")) return ["documenti"];
  if (code.startsWith("messages.")) return ["messaggi"];
  if (code.startsWith("team.")) return ["team"];
  if (code.startsWith("pharmacy.")) return ["beauty_days"];
  if (code.startsWith("orders.")) return ["ordini_pr", "ordini_ph", "ordini_private"];
  if (code.startsWith("integrations.")) return ["integrazioni"];
  return [];
}

function standardPermissionLevel(code) {
  if (code === "dashboard.read" || code.endsWith(".read")) return "lettura";
  if (code.endsWith(".write")) return "scrittura";
  if (code.endsWith(".manage")) return "amministrazione";
  return null;
}

function minimumModuleLevel(code) {
  const standardLevel = standardPermissionLevel(code);
  if (standardLevel) return standardLevel;
  if (/^tasks\.(complete|reopen)/.test(code)) return "scrittura";
  if (code.startsWith("integrations.sync.")) return "scrittura";
  if (code.endsWith(".configure") || code.includes(".delete")) return "amministrazione";
  return "lettura";
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [authUser, setAuthUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [moduleAccess, setModuleAccess] = useState([]);
  const [moduleLevels, setModuleLevels] = useState({});
  const [accessExceptions, setAccessExceptions] = useState([]);
  const [areaAccess, setAreaAccess] = useState([]);
  const [moduleAreas, setModuleAreas] = useState({});
  const [dataScope, setDataScope] = useState(EMPTY_DATA_SCOPE);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function initializeAuth() {
      const { data, error } = await supabase.auth.getSession();
      if (error) console.error("Errore sessione Supabase:", error);
      if (!mounted) return;

      const currentSession = data?.session || null;
      setSession(currentSession);
      setAuthUser(currentSession?.user || null);

      if (currentSession?.user) await loadProfile(currentSession.user);
      else {
        setProfile(null);
        setPermissions([]);
        setModuleAccess([]);
        setModuleLevels({});
        setAccessExceptions([]);
        setAreaAccess([]);
        setModuleAreas({});
        setDataScope(EMPTY_DATA_SCOPE);
      }

      setLoading(false);
    }

    initializeAuth();

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      setSession(nextSession);
      setAuthUser(nextSession?.user || null);

      if (nextSession?.user) await loadProfile(nextSession.user);
      else {
        setProfile(null);
        setPermissions([]);
        setModuleAccess([]);
        setModuleLevels({});
        setAccessExceptions([]);
        setAreaAccess([]);
        setModuleAreas({});
        setDataScope(EMPTY_DATA_SCOPE);
      }

      setLoading(false);
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!profile?.id) return undefined;
    updatePresence(profile.id);
    const interval = window.setInterval(() => updatePresence(profile.id), 60000);
    return () => window.clearInterval(interval);
  }, [profile?.id]);

  async function updatePresence(userId) {
    const now = new Date().toISOString();
    const { error } = await supabase.from("utenti").update({ last_seen: now }).eq("id", userId);
    if (!error) setProfile((current) => (current?.id === userId ? { ...current, last_seen: now } : current));
  }

  async function ensureProfile(user) {
    const email = user.email || "";
    const nome = user.user_metadata?.nome || user.user_metadata?.full_name || email.split("@")[0] || "Utente";
    const cognome = user.user_metadata?.cognome || "";

    const { data: existingByAuth } = await supabase
      .from("utenti")
      .select("id")
      .eq("auth_user_id", user.id)
      .maybeSingle();

    if (existingByAuth?.id) return;

    const { data: existingByEmail } = await supabase
      .from("utenti")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (existingByEmail?.id) {
      await supabase.from("utenti").update({ auth_user_id: user.id, attivo: true }).eq("id", existingByEmail.id);
      return;
    }

    await supabase.from("utenti").insert({
      auth_user_id: user.id,
      email,
      nome,
      cognome,
      attivo: true,
    });
  }

  async function loadProfile(user) {
    await ensureProfile(user);

    const { data, error } = await supabase
      .from("utenti")
      .select(`
        id,
        auth_user_id,
        nome,
        cognome,
        email,
        telefono,
        avatar_url,
        attivo,
        ultimo_accesso,
        last_seen,
        reparto_id,
        ruolo_id,
        reparti(id, nome)
      `)
      .eq("auth_user_id", user.id)
      .maybeSingle();

    if (error) {
      console.error("Errore caricamento profilo:", error);
      setProfile(null);
      setPermissions([]);
      setModuleAccess([]);
      setModuleLevels({});
      setAccessExceptions([]);
      setAreaAccess([]);
      setModuleAreas({});
      setDataScope(EMPTY_DATA_SCOPE);
      return;
    }

    const now = new Date().toISOString();

    if (data?.id) {
      await supabase.from("utenti").update({ ultimo_accesso: now, last_seen: now }).eq("id", data.id);
    }

    const [
      { data: accessContext, error: accessContextError },
      { data: scopeContext, error: scopeContextError },
      { data: areaContext, error: areaContextError },
      { data: moduleAreaRows, error: moduleAreasError },
    ] = await Promise.all([
      supabase.rpc("workspace_access_context"),
      supabase.rpc("workspace_data_scope"),
      supabase.rpc("workspace_area_access_codes"),
      supabase.from("workspace_moduli").select("codice,area"),
    ]);
    if (accessContextError) console.error("Errore caricamento contesto autorizzativo:", accessContextError);
    if (scopeContextError) console.error("Errore caricamento ambito dati:", scopeContextError);
    if (areaContextError) console.error("Errore caricamento accesso alle aree:", areaContextError);
    if (moduleAreasError) console.error("Errore caricamento aree dei moduli:", moduleAreasError);
    setAreaAccess(Array.isArray(areaContext) ? areaContext.filter(Boolean) : []);
    setModuleAreas(Object.fromEntries((moduleAreaRows || []).map((row) => [row.codice, row.area]).filter(([code]) => code)));
    const resolvedRole = accessContext?.role && typeof accessContext.role === "object" ? accessContext.role : null;

    let repartoRows = [];
    if (data?.id) {
      const { data: userDepartmentRows, error: userDepartmentsError } = await supabase
        .from("utenti_reparti")
        .select("reparto_id,reparti(id,nome)")
        .eq("utente_id", data.id);

      if (userDepartmentsError) {
        console.error("Errore caricamento reparti utente:", userDepartmentsError);
      } else {
        repartoRows = userDepartmentRows || [];
      }
    }

    const contextDepartmentIds = Array.isArray(accessContext?.department_ids) ? accessContext.department_ids : [];
    const reparto_ids = [...new Set([...contextDepartmentIds, ...repartoRows.map((row) => row.reparto_id).filter(Boolean)])];
    const reparti_multipli = repartoRows.map((row) => row.reparti).filter(Boolean);

    if (data?.reparto_id && !reparto_ids.includes(data.reparto_id)) {
      reparto_ids.push(data.reparto_id);
      if (data.reparti) reparti_multipli.push(data.reparti);
    }

    const fallbackScopeMode = workspaceRoleIsAdmin(resolvedRole) || resolvedRole?.ambito_dati === "tutti"
      ? "tutti"
      : resolvedRole?.ambito_dati || "propri";
    setDataScope({
      mode: scopeContext?.mode || fallbackScopeMode,
      userIds: Array.isArray(scopeContext?.user_ids) ? scopeContext.user_ids.filter(Boolean) : [data?.id].filter(Boolean),
      departmentIds: Array.isArray(scopeContext?.department_ids)
        ? scopeContext.department_ids.filter(Boolean)
        : (fallbackScopeMode === "team" ? reparto_ids : []),
      agentIds: Array.isArray(scopeContext?.agent_ids) ? scopeContext.agent_ids.filter(Boolean) : [],
      customerCode: scopeContext?.customer_code || null,
      customerCodes: Array.isArray(scopeContext?.customer_codes) ? scopeContext.customer_codes.filter(Boolean) : [],
    });

    const hasAuthoritativeModuleContext = Array.isArray(accessContext?.modules);
    let nextModuleAccess = hasAuthoritativeModuleContext ? accessContext.modules.filter(Boolean) : [];
    if (!hasAuthoritativeModuleContext && reparto_ids.length) {
      const { data: moduleRows, error: moduleError } = await supabase
        .from("reparti_moduli")
        .select("modulo")
        .in("reparto_id", reparto_ids);
      if (moduleError) {
        console.error("Errore caricamento moduli dei reparti:", moduleError);
      } else {
        nextModuleAccess = [...new Set((moduleRows || []).map((row) => row.modulo).filter(Boolean))];
      }
    }
    setModuleAccess(nextModuleAccess);
    setModuleLevels(
      accessContext?.module_levels && typeof accessContext.module_levels === "object"
        ? accessContext.module_levels
        : {}
    );
    setAccessExceptions(Array.isArray(accessContext?.exceptions) ? accessContext.exceptions.filter(Boolean) : []);

    const nextProfile = data
      ? { ...data, ruoli: resolvedRole, ultimo_accesso: now, last_seen: now, reparto_ids, reparti_multipli }
      : {
          id: null,
          auth_user_id: user.id,
          nome: user.user_metadata?.nome || user.email?.split("@")[0] || "Utente",
          cognome: user.user_metadata?.cognome || "",
          email: user.email,
          reparti: null,
          reparti_multipli: [],
          reparto_ids: [],
          ruoli: null,
        };

    setProfile(nextProfile);

    if (Array.isArray(accessContext?.permissions)) {
      setPermissions(accessContext.permissions.filter(Boolean));
    } else if (resolvedRole?.id) {
      const { data: permissionRows, error: permissionError } = await supabase
        .from("permessi_utente")
        .select("permessi(codice)")
        .eq("utente_id", data.id);

      if (permissionError) {
        console.error("Errore caricamento permessi:", permissionError);
        setPermissions([]);
      } else {
        setPermissions((permissionRows || []).map((row) => row.permessi?.codice).filter(Boolean));
      }
    } else {
      setPermissions([]);
    }
  }

  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { success: false, error };
    if (data?.user) await loadProfile(data.user);
    return { success: true, data };
  }

  async function signOut() {
    if (profile?.id) await supabase.from("utenti").update({ last_seen: null }).eq("id", profile.id);
    await supabase.auth.signOut();
    setSession(null);
    setAuthUser(null);
    setProfile(null);
    setPermissions([]);
    setModuleAccess([]);
    setModuleLevels({});
    setAccessExceptions([]);
    setAreaAccess([]);
    setModuleAreas({});
    setDataScope(EMPTY_DATA_SCOPE);
  }

  async function resetPassword(email) {
    const redirectTo = `${window.location.origin}/login`;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    return error ? { success: false, error } : { success: true };
  }

  function isAdmin() {
    return workspaceRoleIsAdmin(profile?.ruoli);
  }

  function getPersonalException(scope, code) {
    if (!scope || !code) return null;
    return accessExceptions.find((item) => item?.scope === scope && item?.code === code) || null;
  }

  function hasPermission(code) {
    if (!profile) return false;
    if (isAdmin()) return true;
    const personalException = getPersonalException("permesso", code);
    if (personalException?.decision === "consenti") return true;
    if (personalException?.decision === "nega") return false;
    const relatedModules = permissionModuleCodes(code);
    if (relatedModules.length && !relatedModules.some((moduleCode) => hasModuleAccess(moduleCode))) {
      return false;
    }

    const requiredModuleLevel = minimumModuleLevel(code);
    if (relatedModules.length && !relatedModules.some((moduleCode) => canUseModule(moduleCode, requiredModuleLevel))) {
      return false;
    }

    if (standardPermissionLevel(code) && relatedModules.length) {
      return true;
    }

    if (permissions.includes(code)) return true;

    const operationalAccess = profile?.ruoli?.livello_accesso || "lettura";
    if (operationalAccess === "amministrazione") {
      return !["settings.manage", "users.manage"].includes(code);
    }
    const isReadPermission = code.includes(".read") || code === "dashboard.read";
    const isWritePermission = code.includes(".write");
    if (operationalAccess === "scrittura") return isReadPermission || isWritePermission;
    return isReadPermission;
  }

  function canAccessDepartment(repartoId) {
    if (!repartoId) return true;
    if (isAdmin() || dataScope.mode === "tutti") return true;
    return dataScope.mode === "team" && dataScope.departmentIds.includes(repartoId);
  }

  function canViewScopedData({ ownerId = null, userIds = [], departmentIds = [] } = {}) {
    if (!profile) return false;
    if (isAdmin() || dataScope.mode === "tutti") return true;

    if (ownerId && ownerId === profile.id) return true;
    if ((userIds || []).some((id) => id && id === profile.id)) return true;

    if (dataScope.mode !== "team") return false;
    const visibleDepartments = new Set(dataScope.departmentIds);
    return (departmentIds || []).some((id) => id && visibleDepartments.has(id));
  }

  function hasModuleAccess(moduleCode) {
    if (!profile) return false;
    if (isAdmin()) return true;
    const personalException = getPersonalException("modulo", moduleCode);
    if (personalException?.decision === "consenti") return true;
    if (personalException?.decision === "nega") return false;
    const areaCode = moduleAreas[moduleCode];
    const alwaysAvailable = WORKSPACE_MODULES[moduleCode]?.alwaysAvailable === true;
    if (!isAdmin() && !alwaysAvailable && areaCode && !areaAccess.includes(areaCode)) return false;
    return moduleIsAvailable(moduleCode, moduleAccess, isAdmin());
  }

  function hasAreaAccess(areaCode) {
    if (!profile) return false;
    if (!areaCode || isAdmin()) return true;
    const personalException = getPersonalException("area", areaCode);
    if (personalException?.decision === "consenti") return true;
    if (personalException?.decision === "nega") return false;
    return areaAccess.includes(areaCode);
  }

  function hasScreenAccess(screenCode, moduleCode = null) {
    if (!profile) return false;
    if (isAdmin()) return true;
    const personalException = getPersonalException("schermata", screenCode);
    if (personalException?.decision === "consenti") return true;
    if (personalException?.decision === "nega") return false;
    return moduleCode ? hasModuleAccess(moduleCode) : true;
  }

  function hasWorkspaceFeature(featureCode) {
    if (!profile) return false;
    const areaCode = moduleAreas[featureCode];
    if (!isAdmin() && areaCode && !areaAccess.includes(areaCode)) return false;
    return featureIsAvailable(featureCode, moduleAccess, isAdmin());
  }

  function getModuleAccessLevel(moduleCode) {
    if (!hasModuleAccess(moduleCode)) return "nessuno";
    if (isAdmin()) return "amministrazione";
    const personalException = getPersonalException("modulo", moduleCode);
    if (personalException?.level) return normalizeModuleAccessLevel(personalException.level, "lettura");
    return normalizeModuleAccessLevel(
      moduleLevels[moduleCode],
      profile?.ruoli?.livello_accesso || "lettura"
    );
  }

  function canUseModule(moduleCode, requiredLevel = "lettura", scope = "module") {
    if (scope === "self" && hasModuleAccess(moduleCode) && moduleSelfServiceAllows(moduleCode, requiredLevel)) {
      return true;
    }
    return moduleLevelAllows(getModuleAccessLevel(moduleCode), requiredLevel);
  }

  const adminUser = isAdmin();

  const value = useMemo(
    () => ({
      session,
      authUser,
      user: profile,
      profile,
      permissions,
      moduleAccess,
      moduleLevels,
      accessExceptions,
      areaAccess,
      moduleAreas,
      dataScope,
      loading,
      signIn,
      signOut,
      resetPassword,
      hasPermission,
      hasModuleAccess,
      hasAreaAccess,
      hasScreenAccess,
      hasWorkspaceFeature,
      getModuleAccessLevel,
      canUseModule,
      isAdmin,
      isAdminUser: adminUser,
      canReadEverything: adminUser || dataScope.mode === "tutti",
      canViewScopedData,
      canManageEverything: adminUser,
      canAccessDepartment,
      userDepartmentIds: profile?.reparto_ids || [],
      reloadProfile: () => authUser && loadProfile(authUser),
    }),
    [session, authUser, profile, permissions, moduleAccess, moduleLevels, accessExceptions, areaAccess, moduleAreas, dataScope, loading, adminUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth deve essere usato dentro AuthProvider");
  return context;
}
