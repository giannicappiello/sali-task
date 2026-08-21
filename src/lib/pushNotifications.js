import { supabase } from "./supabaseClient";

function urlBase64ToUint8Array(value) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(window.atob(base64), (character) => character.charCodeAt(0));
}

export function pushDeviceName() {
  const agent = navigator.userAgent;
  if (/iPhone|iPad/i.test(agent)) return "iPhone / iPad";
  if (/Android/i.test(agent)) return "Android";
  if (/Windows/i.test(agent)) return "Windows";
  if (/Macintosh/i.test(agent)) return "Mac";
  return "Dispositivo";
}

export function pushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export async function currentPushSubscription() {
  if (!pushSupported() || Notification.permission !== "granted") return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

export function isInstalledWorkspace() {
  return window.matchMedia?.("(display-mode: standalone)")?.matches === true
    || window.navigator.standalone === true;
}

export async function registerCurrentDevice(profileId, { requestPermission = false } = {}) {
  if (!profileId || !pushSupported()) throw new Error("Questo dispositivo non supporta le notifiche push.");
  let permission = Notification.permission;
  if (permission === "default" && requestPermission) permission = await Notification.requestPermission();
  if (permission !== "granted") {
    const error = new Error(permission === "denied"
      ? "Le notifiche sono bloccate nelle impostazioni del dispositivo."
      : "È necessaria l’autorizzazione del dispositivo.");
    error.code = permission;
    throw error;
  }

  const registration = await navigator.serviceWorker.ready;
  const response = await fetch("/api/mexal/automation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "notification_public_key" }),
  });
  const payload = await response.json();
  if (!response.ok || !payload.publicKey) throw new Error(payload.error || "Configurazione notifiche non disponibile.");
  let subscription = await registration.pushManager.getSubscription();
  const newSubscription = !subscription;
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(payload.publicKey),
    });
  }
  const json = subscription.toJSON();
  const { error } = await supabase.rpc("registra_dispositivo_notifiche", {
    p_endpoint: json.endpoint,
    p_p256dh: json.keys.p256dh,
    p_auth: json.keys.auth,
    p_nome_dispositivo: pushDeviceName(),
    p_user_agent: navigator.userAgent,
  });
  if (error) throw error;
  if (newSubscription) {
    await registration.showNotification("Notifiche Workspace attivate", {
      body: "Questo dispositivo riceverà gli avvisi con il segnale previsto dalle impostazioni di sistema.",
      icon: "/pwa-192x192.png",
      badge: "/pwa-192x192.png",
      tag: "workspace-notifications-enabled",
      renotify: true,
      silent: false,
      vibrate: [250, 100, 250],
      data: { url: "/settings/notifications" },
    });
  }
  return subscription;
}

export async function clearConversationPushNotifications(conversationId) {
  if (!conversationId || !("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.ready;
  registration.active?.postMessage({ type: "WORKSPACE_CHAT_READ", conversationId });
}

export async function dispatchMessagePush(messageId, conversationId) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return;
  const response = await fetch("/api/mexal/automation", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action: "notification_dispatch_message", messageId, conversationId }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "Invio immediato della notifica non riuscito.");
  }
}
