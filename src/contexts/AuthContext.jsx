import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [authUser, setAuthUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [permissions, setPermissions] = useState([]);
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
        reparti(id, nome),
        ruoli(id, nome, livello)
      `)
      .eq("auth_user_id", user.id)
      .maybeSingle();

    if (error) {
      console.error("Errore caricamento profilo:", error);
      setProfile(null);
      setPermissions([]);
      return;
    }

    const now = new Date().toISOString();

    if (data?.id) {
      await supabase.from("utenti").update({ ultimo_accesso: now, last_seen: now }).eq("id", data.id);
    }

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

    const reparto_ids = repartoRows.map((row) => row.reparto_id).filter(Boolean);
    const reparti_multipli = repartoRows.map((row) => row.reparti).filter(Boolean);

    if (data?.reparto_id && !reparto_ids.includes(data.reparto_id)) {
      reparto_ids.push(data.reparto_id);
      if (data.reparti) reparti_multipli.push(data.reparti);
    }

    const nextProfile = data
      ? { ...data, ultimo_accesso: now, last_seen: now, reparto_ids, reparti_multipli }
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

    if (data?.ruoli?.id) {
      const { data: permissionRows, error: permissionError } = await supabase
        .from("permessi_ruolo")
        .select("permessi(codice)")
        .eq("ruolo_id", data.ruoli.id);

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
  }

  async function resetPassword(email) {
    const redirectTo = `${window.location.origin}/login`;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    return error ? { success: false, error } : { success: true };
  }

  function isAdmin() {
    const roleName = (profile?.ruoli?.nome || "").toLowerCase();
    const level = Number(profile?.ruoli?.livello || 0);
    return ["admin", "administrator", "amministratore", "super admin", "direzione"].includes(roleName) || level >= 80;
  }

  function hasPermission(code) {
    if (!profile) return false;
    if (isAdmin()) return true;
    return permissions.includes(code);
  }

  function canAccessDepartment(repartoId) {
    if (!repartoId) return true;
    if (isAdmin()) return true;
    return (profile?.reparto_ids || []).includes(repartoId);
  }

  const adminUser = isAdmin();

  const value = useMemo(
    () => ({
      session,
      authUser,
      user: profile,
      profile,
      permissions,
      loading,
      signIn,
      signOut,
      resetPassword,
      hasPermission,
      isAdmin,
      isAdminUser: adminUser,
      canReadEverything: adminUser,
      canManageEverything: adminUser,
      canAccessDepartment,
      userDepartmentIds: profile?.reparto_ids || [],
      reloadProfile: () => authUser && loadProfile(authUser),
    }),
    [session, authUser, profile, permissions, loading, adminUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth deve essere usato dentro AuthProvider");
  return context;
}
