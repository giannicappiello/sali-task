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

    const nextProfile = data
      ? { ...data, ultimo_accesso: now, last_seen: now }
      : {
          id: null,
          auth_user_id: user.id,
          nome: user.email?.split("@")[0] || "Utente",
          email: user.email,
          reparti: null,
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

  function hasPermission(code) {
    if (!profile) return false;
    const roleName = (profile.ruoli?.nome || "").toLowerCase();
    if (["admin", "administrator", "amministratore", "responsabile"].includes(roleName)) return true;
    if (permissions.includes(code)) return true;
    if (permissions.length === 0) return true;
    return false;
  }

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
      reloadProfile: () => authUser && loadProfile(authUser),
    }),
    [session, authUser, profile, permissions, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth deve essere usato dentro AuthProvider");
  return context;
}
