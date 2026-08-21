/* global process */
import webpush from "web-push";

const env = (name) => {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Variabile mancante: ${name}`);
  return value;
};

function isQuietTime(preferences) {
  if (!preferences?.pausa_dalle || !preferences?.pausa_alle) return false;
  const parts = new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const now = Number(parts.find((part) => part.type === "hour")?.value || 0) * 60
    + Number(parts.find((part) => part.type === "minute")?.value || 0);
  const toMinutes = (value) => {
    const [hour, minute] = String(value).split(":").map(Number);
    return hour * 60 + minute;
  };
  const start = toMinutes(preferences.pausa_dalle);
  const end = toMinutes(preferences.pausa_alle);
  return start <= end ? now >= start && now < end : now >= start || now < end;
}

export async function dispatchWorkspaceNotifications(admin, { notificationIds = null, generateDeadlines = true } = {}) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:gestioneordini@progre.it",
    env("VAPID_PUBLIC_KEY"),
    env("VAPID_PRIVATE_KEY")
  );
  if (generateDeadlines) {
    const { error: deadlineError } = await admin.rpc("genera_notifiche_scadenze");
    if (deadlineError) throw deadlineError;
  }
  let queueQuery = admin
    .from("notifiche_push_coda")
    .select("id,notifica_id,tentativi,notifiche(id,utente_id,titolo,messaggio,tipo,evento,url,priorita,metadata,chat_conversazione_id)")
    .is("elaborata_il", null)
    .lte("disponibile_dal", new Date().toISOString())
    .order("created_at")
    .limit(100);
  if (notificationIds?.length) queueQuery = queueQuery.in("notifica_id", notificationIds);
  const { data: queue, error } = await queueQuery;
  if (error) throw error;

  let sent = 0;
  let failed = 0;
  for (const item of queue || []) {
    const notification = item.notifiche;
    if (!notification?.utente_id) continue;
    const [{ data: preferences }, { data: devices }] = await Promise.all([
      admin.from("notifiche_preferenze").select("*").eq("utente_id", notification.utente_id).maybeSingle(),
      admin.from("notifiche_dispositivi").select("*").eq("utente_id", notification.utente_id).eq("attivo", true),
    ]);
    if (preferences?.push_attive === false) {
      await admin.from("notifiche_push_coda").update({ elaborata_il: new Date().toISOString() }).eq("id", item.id);
      continue;
    }
    if (!(devices || []).length) {
      const attempts = Number(item.tentativi || 0) + 1;
      await admin.from("notifiche_push_coda").update(attempts >= 12
        ? { elaborata_il: new Date().toISOString(), tentativi: attempts, ultimo_errore: "Nessun dispositivo attivo" }
        : { tentativi: attempts, ultimo_errore: "Nessun dispositivo attivo", disponibile_dal: new Date(Date.now() + 600000).toISOString() }
      ).eq("id", item.id);
      continue;
    }
    if (isQuietTime(preferences)) {
      await admin.from("notifiche_push_coda").update({ disponibile_dal: new Date(Date.now() + 600000).toISOString() }).eq("id", item.id);
      continue;
    }
    const payload = JSON.stringify({
      id: notification.id,
      title: notification.titolo || "Progre Workspace",
      body: notification.messaggio || "Hai una nuova notifica.",
      url: notification.chat_conversazione_id
        ? `/messages?conversation=${notification.chat_conversazione_id}`
        : (notification.url || "/notifications"),
      tag: `${notification.evento || notification.tipo || "workspace"}-${notification.id}`,
      metadata: notification.metadata || {},
      conversationId: notification.chat_conversazione_id || notification.metadata?.chat_conversazione_id || null,
    });
    let rowFailed = false;
    for (const device of devices) {
      try {
        await webpush.sendNotification({ endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } }, payload);
        sent += 1;
      } catch (pushError) {
        failed += 1;
        rowFailed = true;
        if ([404, 410].includes(pushError.statusCode)) {
          await admin.from("notifiche_dispositivi").update({ attivo: false }).eq("id", device.id);
        }
      }
    }
    await admin.from("notifiche_push_coda").update(rowFailed
      ? { tentativi: item.tentativi + 1, ultimo_errore: "Invio non riuscito su uno o più dispositivi", disponibile_dal: new Date(Date.now() + 300000).toISOString() }
      : { elaborata_il: new Date().toISOString(), ultimo_errore: null }).eq("id", item.id);
  }
  return { processed: queue?.length || 0, sent, failed };
}
