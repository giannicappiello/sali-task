import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { requiresDirectModuleGrant } from "../config/directCrmAccess";
import { useLocation } from "react-router-dom";
import { screenAccessAllowed, screenForPath } from "../config/workspaceScreenAccess";
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
  const location = useLocation();
  const [session, setSession] = useState(null);
  const [authUser, setAuthUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [moduleAccess, setModuleAccess] = useState([]);
  const [moduleLevels, setModuleLevels] = useState({});
  const [accessExceptions, setAccessExceptions] = useState([]);
  const [areaAccess, setAreaAccess] = useState([]);
  const [moduleAreas, setModuleAreas] = useState({});
  const [screenCatalog, setScreenCatalog] = useState({ screens: [], links: [] });
  const [dataScope, setDataScope] = useState(EMPTY_DATA_SCOPE);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const [accessEpoch, setAccessEpoch] = useState(0);
  const [authorizationRevision, setAuthorizationRevision] = useState(null);
  const lastAccessSignature = useRef("");
  const accessRevision = useRef(null);
  const loadGeneration = useRef(0);
  const currentAuthId = useRef(null);

  useEffect(() => {
    let mounted = true;

    const pending = new Set();
    const timeout = window.setTimeout(() => {
      if (mounted) setAuthError("Il caricamento della sessione sta impiegando troppo tempo. Chiudi le altre finestre Workspace e riprova.");
    }, 30000);

    async function applySession(currentSession) {
      if (!mounted) return;
      currentAuthId.current = currentSession?.user?.id || null;
      loadGeneration.current += 1;
      setSession(currentSession);
      setAuthUser(currentSession?.user || null);
      try {
        if (currentSession?.user) await loadProfile(currentSession.user);
        else {
          setProfile(null);
          setPermissions([]);
          setModuleAccess([]);
          setModuleLevels({});
          setAccessExceptions([]);
          setAreaAccess([]);
          setModuleAreas({});
          setScreenCatalog({ screens: [], links: [] });
          setDataScope(EMPTY_DATA_SCOPE);
        }
        if (mounted) { setAuthError(""); setLoading(false); }
      } catch (error) {
        if (mounted) setAuthError("Impossibile caricare la sessione Workspace. Riprova.");
        console.error("Errore caricamento sessione Workspace:", error);
      } finally {
        window.clearTimeout(timeout);
      }
    }

    // Database queries must run after Supabase releases its auth callback lock.
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      const timer = window.setTimeout(() => {
        pending.delete(timer);
        void applySession(nextSession);
      }, 0);
      pending.add(timer);
    });

    return () => {
      mounted = false;
      window.clearTimeout(timeout);
      for (const timer of pending) window.clearTimeout(timer);
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!profile?.id) return undefined;
    updatePresence(profile.id);
    const interval = window.setInterval(() => updatePresence(profile.id), 60000);
    return () => window.clearInterval(interval);
  }, [profile?.id]);

  useEffect(() => {
    if (!authUser?.id) return undefined;
    let disposed = false;
    let running = false;
    let pending = false;
    const refresh = async () => {
      if (running) { pending = true; return; }
      running = true;
      try {
        do {
          pending = false;
          await loadProfile(authUser, { refresh: true });
        } while (pending && !disposed);
      } catch (error) {
        console.error("Aggiornamento autorizzazioni non disponibile:", error);
      } finally { running = false; }
    };
    const check = async () => {
      const { data, error } = await supabase.from("workspace_access_revision").select("revision").eq("id", true).single();
      if (!disposed && (error || data?.revision !== accessRevision.current)) void refresh();
    };
    const onFocus = () => { if (document.visibilityState !== "hidden") void refresh(); };
    const channel = supabase.channel("workspace-access-revision")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "workspace_access_revision" }, () => void refresh())
      .subscribe((status) => { if (status === "SUBSCRIBED") void check(); });
    // Realtime applies saved changes; polling also expires temporary exceptions
    // and recovers missed notifications after network interruptions.
    const interval = window.setInterval(() => void refresh(), 30000);
    window.addEventListener("workspace:module-catalog-changed", refresh);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.removeEventListener("workspace:module-catalog-changed", refresh);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      void supabase.removeChannel(channel);
    };
  }, [authUser]);

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

  async function loadProfile(user, { refresh = false } = {}) {
    const generation = ++loadGeneration.current;
    if (!refresh) await ensureProfile(user);
    const { data: snapshot, error } = await supabase.rpc("workspace_session_access");
    // A late response from an older login/refresh must not restore old access.
    if (generation !== loadGeneration.current || (currentAuthId.current && currentAuthId.current !== user.id)) return;
    const data = snapshot?.profile;
    if (error || !data || data.attivo === false) {
      setProfile(null);
      setPermissions([]);
      setModuleAccess([]);
      setModuleLevels({});
      setAccessExceptions([]);
      setAreaAccess([]);
      setModuleAreas({});
      setScreenCatalog({ screens: [], links: [], levels: {} });
      setDataScope(EMPTY_DATA_SCOPE);
      if (error) throw error;
      return;
    }
    const context = snapshot.access || {};
    const scope = snapshot.scope || {};
    const signature = JSON.stringify([data.id, context, scope, snapshot.areas, snapshot.module_areas, snapshot.screen_levels, snapshot.screens, snapshot.links]);
    if (lastAccessSignature.current && signature !== lastAccessSignature.current) setAccessEpoch((value) => value + 1);
    lastAccessSignature.current = signature;
    accessRevision.current = snapshot.revision;
    setAuthorizationRevision(snapshot.revision);
    setProfile({ ...data, ruoli: context.role, reparto_ids: context.department_ids || [],
      reparti_multipli: snapshot.departments || [] });
    setPermissions(context.permissions || []);
    setModuleAccess(context.modules || []);
    setModuleLevels(context.module_levels || {});
    setAccessExceptions(context.exceptions || []);
    setAreaAccess(snapshot.areas || []);
    setModuleAreas(snapshot.module_areas || {});
    setScreenCatalog({ screens: snapshot.screens || [], links: snapshot.links || [], levels: snapshot.screen_levels || {} });
    setDataScope({ mode: scope.mode || "propri", userIds: scope.user_ids || [], departmentIds: scope.department_ids || [],
      agentIds: scope.agent_ids || [], customerCode: scope.customer_code || null, customerCodes: scope.customer_codes || [] });
    if (!refresh) {
      const now = new Date().toISOString();
      await supabase.from("utenti").update({ ultimo_accesso: now, last_seen: now }).eq("id", data.id);
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
    currentAuthId.current = null;
    loadGeneration.current += 1;
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
    setScreenCatalog({ screens: [], links: [] });
    setDataScope(EMPTY_DATA_SCOPE);
  }

  async function resetPassword(email) {
    const redirectTo = `${window.location.origin}/login`;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    return error ? { success: false, error } : { success: true };
  }

  function isAdmin() {
    return profile?.attivo !== false && workspaceRoleIsAdmin(profile?.ruoli);
  }

  function getPersonalException(scope, code) {
    if (!scope || !code) return null;
    return accessExceptions.find((item) => item?.scope === scope && item?.code === code && (!item.expires_at || Date.parse(item.expires_at) > Date.now())) || null;
  }

  function getPersonalAccessDecision(scope, code) {
    return getPersonalException(scope, code)?.decision || null;
  }

  function hasExplicitScreenGrant(screenCode) {
    return getPersonalAccessDecision("schermata", screenCode) === "consenti";
  }

  function getModuleScreenGrant(moduleCode) {
    if (!moduleCode) return null;
    const grantedLink = screenCatalog.links.find((link) => link.modulo_codice === moduleCode && link.visibile_menu !== false && hasScreenAccess(link.schermata_codice, moduleCode));
    return grantedLink
      ? screenCatalog.screens.find((screen) => screen.codice === grantedLink.schermata_codice) || null
      : null;
  }

  function getScreenCodeForPath(pathname, moduleCode = null) {
    const linkedCodes = moduleCode
      ? new Set(screenCatalog.links.filter((link) => link.modulo_codice === moduleCode).map((link) => link.schermata_codice))
      : null;
    return screenForPath(screenCatalog.screens.filter((screen) => !linkedCodes || linkedCodes.has(screen.codice)), pathname)?.codice || "";
  }

  function hasPermission(code, screenCode = null) {
    if (!profile || profile.attivo === false) return false;
    if (isAdmin()) return true;
    const personalException = getPersonalException("permesso", code);
    if (personalException?.decision === "nega") return false;
    const relatedModules = permissionModuleCodes(code);
    const currentScreen = screenCode || screenForPath(screenCatalog.screens, location.pathname)?.codice;
    const screenModules = screenCatalog.links.filter((link) => link.schermata_codice === currentScreen).map((link) => link.modulo_codice);
    const screenAllowed = currentScreen && hasScreenAccess(currentScreen) && relatedModules.some((moduleCode) => screenModules.includes(moduleCode));
    const requiredModuleLevel = minimumModuleLevel(code);
    if (currentScreen && relatedModules.some((moduleCode) => screenModules.includes(moduleCode)) && !canUseScreen(currentScreen, requiredModuleLevel)) return false;
    if (personalException?.decision === "consenti") return true;
    if (relatedModules.length && !relatedModules.some((moduleCode) => hasModuleAccess(moduleCode)) && !screenAllowed) {
      return false;
    }

    if (relatedModules.length && !relatedModules.some((moduleCode) => canUseModule(moduleCode, requiredModuleLevel)) && !(screenAllowed && canUseScreen(currentScreen, requiredModuleLevel))) {
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
    if (!profile || profile.attivo === false) return false;
    if (isAdmin() || dataScope.mode === "tutti") return true;

    if (ownerId && ownerId === profile.id) return true;
    if ((userIds || []).some((id) => id && id === profile.id)) return true;

    if (dataScope.mode !== "team") return false;
    const visibleDepartments = new Set(dataScope.departmentIds);
    return (departmentIds || []).some((id) => id && visibleDepartments.has(id));
  }

  function hasModuleAccess(moduleCode) {
    if (!profile || profile.attivo === false) return false;
    if (isAdmin()) return true;
    if (requiresDirectModuleGrant(moduleCode)) return moduleAccess.includes(moduleCode);
    const personalException = getPersonalException("modulo", moduleCode);
    if (personalException?.decision === "consenti") return true;
    if (personalException?.decision === "nega") return false;
    const areaCode = moduleAreas[moduleCode];
    const alwaysAvailable = WORKSPACE_MODULES[moduleCode]?.alwaysAvailable === true;
    if (!isAdmin() && !alwaysAvailable && areaCode && !areaAccess.includes(areaCode)) return false;
    return moduleIsAvailable(moduleCode, moduleAccess, isAdmin());
  }

  function hasAreaAccess(areaCode) {
    if (!profile || profile.attivo === false) return false;
    if (!areaCode || isAdmin()) return true;
    const personalException = getPersonalException("area", areaCode);
    if (personalException?.decision === "consenti") return true;
    if (personalException?.decision === "nega") return false;
    return areaAccess.includes(areaCode);
  }

  function hasScreenAccess(screenCode, moduleCode = null) {
    if (screenCatalog.levels) return Boolean(profile && profile.attivo !== false && screenCatalog.levels[screenCode] && screenCatalog.levels[screenCode] !== "nessuno");
    const screen = screenCatalog.screens.find((item) => item.codice === screenCode);
    const modules = screenCatalog.links.filter((link) => link.schermata_codice === screenCode).map((link) => link.modulo_codice);
    return screenAccessAllowed({ screen, activeUser: Boolean(profile && profile.attivo !== false), admin: isAdmin(),
      exception: getPersonalException("schermata", screenCode), areaAllowed: screen?.area && hasAreaAccess(screen.area),
      moduleAllowed: moduleCode ? modules.includes(moduleCode) && hasModuleAccess(moduleCode) : modules.some(hasModuleAccess) });
  }

  function canUseScreen(screenCode, requiredLevel = "lettura") {
    if (!hasScreenAccess(screenCode)) return false;
    if (screenCatalog.levels) return moduleLevelAllows(screenCatalog.levels[screenCode], requiredLevel);
    if (isAdmin()) return true;
    const exception = getPersonalException("schermata", screenCode);
    if (exception?.level) return moduleLevelAllows(exception.level, requiredLevel);
    const levels = screenCatalog.links.filter((link) => link.schermata_codice === screenCode)
      .map((link) => moduleLevels[link.modulo_codice] || profile?.ruoli?.livello_accesso || "lettura");
    return (levels.length ? levels : [profile?.ruoli?.livello_accesso || "lettura"]).some((level) => moduleLevelAllows(level, requiredLevel));
  }

  function hasWorkspaceFeature(featureCode) {
    if (!profile || profile.attivo === false) return false;
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
      authError,
      authorizationRevision,
      signIn,
      signOut,
      resetPassword,
      hasPermission,
      hasModuleAccess,
      hasAreaAccess,
      hasScreenAccess,
      canUseScreen,
      getPersonalAccessDecision,
      hasExplicitScreenGrant,
      getModuleScreenGrant,
      getScreenCodeForPath,
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
      reloadProfile: () => authUser && loadProfile(authUser, { refresh: true }),
    }),
    [session, authUser, profile, permissions, moduleAccess, moduleLevels, accessExceptions, areaAccess, moduleAreas, screenCatalog, dataScope, loading, authError, authorizationRevision, adminUser, location.pathname]
  );

  // Recreate page-local data and query state when the effective perimeter changes.
  // Otherwise an already-open page could keep rows from a removed department.
  return <AuthContext.Provider key={accessEpoch} value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth deve essere usato dentro AuthProvider");
  return context;
}
