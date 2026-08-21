import { useEffect, useMemo, useState } from "react";
import { BellRing, Check, Clock3, Save, Smartphone, Volume2, VolumeX } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../contexts/AuthContext";
import { currentPushSubscription, pushDeviceName, pushSupported, registerCurrentDevice } from "../../lib/pushNotifications";

export default function NotificationSettings() {
  const { profile, isAdminUser } = useAuth();
  const [preferences, setPreferences] = useState({ push_attive: true, suono_attivo: true, pausa_dalle: "", pausa_alle: "", eventi: {} });
  const [rules, setRules] = useState([]);
  const [devices, setDevices] = useState([]);
  const [localSubscriptionEndpoint, setLocalSubscriptionEndpoint] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const supported = pushSupported();

  useEffect(() => { if (profile?.id) load(); }, [profile?.id]);

  async function load() {
    const [preferencesResult, rulesResult, devicesResult, localSubscription] = await Promise.all([
      supabase.from("notifiche_preferenze").select("*").eq("utente_id", profile.id).maybeSingle(),
      supabase.from("notifiche_regole").select("*").order("gruppo").order("nome"),
      supabase.from("notifiche_dispositivi").select("id,endpoint,nome_dispositivo,attivo,ultimo_utilizzo").eq("utente_id", profile.id).eq("attivo", true),
      currentPushSubscription(),
    ]);
    if (preferencesResult.data) setPreferences({
      ...preferencesResult.data,
      pausa_dalle: preferencesResult.data.pausa_dalle?.slice(0, 5) || "",
      pausa_alle: preferencesResult.data.pausa_alle?.slice(0, 5) || "",
    });
    setRules(rulesResult.data || []);
    setDevices(devicesResult.data || []);
    setLocalSubscriptionEndpoint(localSubscription?.endpoint || "");
  }

  async function savePreferences(next = preferences) {
    setBusy(true);
    const { error } = await supabase.from("notifiche_preferenze").upsert({
      utente_id: profile.id,
      push_attive: next.push_attive,
      suono_attivo: next.suono_attivo,
      pausa_dalle: next.pausa_dalle || null,
      pausa_alle: next.pausa_alle || null,
      eventi: next.eventi || {},
      updated_at: new Date().toISOString(),
    });
    setBusy(false);
    setMessage(error ? error.message : "Preferenze salvate.");
    if (!error) window.dispatchEvent(new CustomEvent("workspace:notification-preferences"));
  }

  async function enableDevice() {
    if (!supported) return setMessage("Questo browser non supporta le notifiche push.");
    setBusy(true);
    try {
      localStorage.removeItem(`workspace-push-disabled:${profile.id}`);
      await registerCurrentDevice(profile.id, { requestPermission: true });
      const next = { ...preferences, push_attive: true };
      setPreferences(next);
      await savePreferences(next);
      await load();
      setMessage("Notifiche attivate su questo dispositivo.");
    } catch (error) {
      setMessage(error.message || "Attivazione non riuscita.");
    } finally {
      setBusy(false);
    }
  }

  async function disableDevice() {
    setBusy(true);
    const next = { ...preferences, push_attive: false, suono_attivo: false };
    const { error } = await supabase.from("notifiche_dispositivi")
      .update({ attivo: false })
      .eq("utente_id", profile.id)
      .eq("endpoint", localSubscriptionEndpoint);
    if (error) {
      setMessage(error.message);
    } else {
      localStorage.setItem(`workspace-push-disabled:${profile.id}`, "1");
      setPreferences(next);
      await savePreferences(next);
      await load();
      setMessage("Notifiche disattivate su questo dispositivo.");
    }
    setBusy(false);
  }

  async function saveRule(rule) {
    const { error } = await supabase.rpc("salva_regola_notifica", {
      p_codice: rule.codice,
      p_attiva: rule.attiva,
      p_push_attiva: rule.push_attiva,
      p_suono_attivo: rule.suono_attivo,
      p_anticipo_minuti: rule.anticipo_minuti || [],
    });
    setMessage(error ? error.message : `Regola “${rule.nome}” salvata.`);
  }

  const groupedRules = useMemo(() => rules.reduce((groups, rule) => {
    groups[rule.gruppo] = [...(groups[rule.gruppo] || []), rule];
    return groups;
  }, {}), [rules]);
  const currentDeviceActive = Boolean(localSubscriptionEndpoint) && devices.some((item) => item.endpoint === localSubscriptionEndpoint);

  return (
    <div className="settings-page v4-page notification-settings-page">
      <div className="page-title-row"><div><h1>Notifiche</h1><p>Avvisi sul dispositivo, suoni e regole per le azioni del Workspace.</p></div></div>
      {message && <div className="notification-settings-message"><Check size={18} />{message}</div>}

      <div className="notification-settings-grid">
        <section className="panel notification-device-card">
          <div className="panel-header"><div><h3><Smartphone size={20} /> Questo dispositivo</h3><p>Ricevi avvisi anche quando il Workspace non è aperto.</p></div></div>
          <div className={`notification-device-state ${currentDeviceActive ? "active" : ""}`}><BellRing size={34} /><div><strong>{currentDeviceActive ? "Notifiche attive" : "Notifiche non attive"}</strong><span>{pushDeviceName()} · permesso {supported ? Notification.permission : "non supportato"}</span></div></div>
          {!currentDeviceActive
            ? <button className="primary-action" onClick={enableDevice} disabled={busy}>Attiva ora su questo dispositivo</button>
            : <><p className="muted">Il dispositivo resterà registrato automaticamente finché Workspace è installato e il permesso di sistema è attivo.</p><button className="secondary-action" onClick={disableDevice} disabled={busy}>Disattiva su questo dispositivo</button></>}
          {/iPhone|iPad/i.test(navigator.userAgent) && <p className="muted">Su iPhone e iPad installa prima il Workspace nella schermata Home, poi riaprilo dall'icona.</p>}
        </section>

        <section className="panel notification-device-card">
          <div className="panel-header"><div><h3>{preferences.suono_attivo ? <Volume2 size={20} /> : <VolumeX size={20} />} Suono e pausa</h3><p>Il suono personalizzato viene riprodotto quando l'app è aperta.</p></div></div>
          <label className="notification-switch"><span><strong>Segnale sonoro</strong><small>Avviso immediato per le nuove notifiche</small></span><input type="checkbox" checked={preferences.suono_attivo} onChange={(event) => setPreferences({ ...preferences, suono_attivo: event.target.checked })} /></label>
          <div className="notification-quiet-hours"><Clock3 size={19} /><label>Pausa dalle<input type="time" value={preferences.pausa_dalle} onChange={(event) => setPreferences({ ...preferences, pausa_dalle: event.target.value })} /></label><label>alle<input type="time" value={preferences.pausa_alle} onChange={(event) => setPreferences({ ...preferences, pausa_alle: event.target.value })} /></label></div>
          <button className="primary-action" onClick={() => savePreferences()} disabled={busy}><Save size={17} />Salva preferenze</button>
        </section>
      </div>

      {!isAdminUser && <section className="panel notification-rules-panel">
        <div className="panel-header"><div><h3>Eventi gestiti dall’amministratore</h3><p>Le notifiche vengono attivate automaticamente sui dispositivi dove Workspace è installato. L’ADMIN stabilisce centralmente quali eventi devono generare un avviso.</p></div></div>
        {Object.entries(groupedRules).map(([group, items]) => <div className="notification-rule-group" key={group}><h4>{group}</h4>{items.filter((rule) => rule.attiva).map((rule) => <div className="notification-switch" key={rule.codice}><span><strong>{rule.nome}</strong><small>{rule.descrizione}</small></span><Check size={18} /></div>)}</div>)}
      </section>}

      {isAdminUser && <section className="panel notification-rules-panel">
        <div className="panel-header"><div><h3>Configurazione generale</h3><p>Solo l’ADMIN stabilisce quali eventi inviare a tutti i dispositivi Workspace registrati.</p></div></div>
        {rules.map((rule, index) => <div className="notification-admin-rule" key={rule.codice}>
          <div><strong>{rule.nome}</strong><small>{rule.gruppo} · {rule.descrizione}</small></div>
          <label>Attiva<input type="checkbox" checked={rule.attiva} onChange={(event) => setRules((current) => current.map((item, i) => i === index ? { ...item, attiva: event.target.checked } : item))} /></label>
          <label>Push<input type="checkbox" checked={rule.push_attiva} onChange={(event) => setRules((current) => current.map((item, i) => i === index ? { ...item, push_attiva: event.target.checked } : item))} /></label>
          <label>Suono<input type="checkbox" checked={rule.suono_attivo} onChange={(event) => setRules((current) => current.map((item, i) => i === index ? { ...item, suono_attivo: event.target.checked } : item))} /></label>
          {rule.codice === "attivita_scadenza" && <label className="notification-lead">Anticipo (minuti)<input value={(rule.anticipo_minuti || []).join(", ")} onChange={(event) => setRules((current) => current.map((item, i) => i === index ? { ...item, anticipo_minuti: event.target.value.split(",").map(Number).filter((value) => value > 0) } : item))} /></label>}
          <button className="secondary-action" onClick={() => saveRule(rule)}><Save size={15} />Salva</button>
        </div>)}
      </section>}
    </div>
  );
}
