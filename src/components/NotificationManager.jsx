import { useEffect, useRef } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../contexts/AuthContext";
import { pushSupported, registerCurrentDevice } from "../lib/pushNotifications";

let notificationAudioContext = null;

function audioContext() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return null;
  if (!notificationAudioContext || notificationAudioContext.state === "closed") notificationAudioContext = new AudioContext();
  return notificationAudioContext;
}

function playNotificationTone() {
  const context = audioContext();
  if (!context || context.state !== "running") return;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(880, context.currentTime);
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.18, context.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.3);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.32);
}

function unlockNotificationAudio() {
  const context = audioContext();
  if (!context) return;
  if (context.state === "suspended") context.resume();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  gain.gain.value = 0.0001;
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.01);
}

export default function NotificationManager() {
  const { profile } = useAuth();
  const soundEnabled = useRef(true);
  const soundRules = useRef({});

  useEffect(() => {
    const unlock = () => unlockNotificationAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  useEffect(() => {
    if (!profile?.id) return undefined;
    Promise.all([
      supabase.from("notifiche_preferenze").select("suono_attivo").eq("utente_id", profile.id).maybeSingle(),
      supabase.from("notifiche_regole").select("codice,suono_attivo,attiva"),
    ]).then(([preferenceResult, rulesResult]) => {
      soundEnabled.current = preferenceResult.data?.suono_attivo !== false;
      soundRules.current = Object.fromEntries((rulesResult.data || []).map((rule) => [rule.codice, rule.attiva && rule.suono_attivo]));
    });

    const channel = supabase.channel(`workspace-notifications-${profile.id}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "notifiche",
        filter: `utente_id=eq.${profile.id}`,
      }, (change) => {
        window.dispatchEvent(new CustomEvent("workspace:notifications-changed"));
        if (change.eventType !== "INSERT") return;
        const eventCode = change.new?.evento || change.new?.tipo || "generica";
        const ruleAllowsSound = soundRules.current[eventCode] !== false;
        if (soundEnabled.current && ruleAllowsSound && document.visibilityState === "visible") playNotificationTone();
      })
      .subscribe();
    const preferencesListener = () => {
      supabase.from("notifiche_preferenze").select("suono_attivo").eq("utente_id", profile.id).maybeSingle()
        .then(({ data }) => {
          soundEnabled.current = data?.suono_attivo !== false;
        });
    };
    window.addEventListener("workspace:notification-preferences", preferencesListener);
    return () => {
      window.removeEventListener("workspace:notification-preferences", preferencesListener);
      supabase.removeChannel(channel);
    };
  }, [profile?.id]);

  useEffect(() => {
    if (!profile?.id || !pushSupported()) return;
    if (localStorage.getItem(`workspace-push-disabled:${profile.id}`) === "1") return;
    let cancelled = false;
    async function activateAfterUpdate() {
      try {
        if (Notification.permission === "granted") {
          await registerCurrentDevice(profile.id);
          return;
        }
        if (Notification.permission === "denied") {
          if (!localStorage.getItem("workspace-push-denied-notice-v1")) {
            localStorage.setItem("workspace-push-denied-notice-v1", "1");
            await window.workspaceAlert("Le notifiche di Workspace risultano bloccate. Abilitale dalle impostazioni delle notifiche del dispositivo e riapri l’app.");
          }
          return;
        }
        const accepted = await window.workspaceConfirm("Workspace vuole attivare automaticamente le notifiche su questo dispositivo. Sarà l’amministratore a stabilire per quali eventi riceverle.");
        if (!accepted || cancelled) return;
        await registerCurrentDevice(profile.id, { requestPermission: true });
      } catch (error) {
        if (!cancelled) await window.workspaceAlert(error.message || "Non è stato possibile attivare le notifiche.");
      }
    }
    activateAfterUpdate();
    return () => { cancelled = true; };
  }, [profile?.id]);

  return null;
}
