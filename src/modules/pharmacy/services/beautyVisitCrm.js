import { supabase } from "../../../lib/supabaseClient";

const POSITION_OPTIONS = {
  enableHighAccuracy: true,
  timeout: 15000,
  maximumAge: 0,
};

export function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocalizzazione non disponibile su questo dispositivo."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({
        latitude: coords.latitude,
        longitude: coords.longitude,
        accuracy: coords.accuracy,
      }),
      () => reject(new Error("Posizione non disponibile. Verifica il consenso GPS e riprova.")),
      POSITION_OPTIONS,
    );
  });
}

export async function loadBeautyVisitLinks(legacyIds) {
  if (!legacyIds.length) return new Map();
  const { data, error } = await supabase
    .from("crm_visit_details")
    .select("activity_id,legacy_giornata_id,visit_status,check_in_at,check_out_at,check_in_latitude,check_in_longitude,check_in_accuracy_meters,check_in_distance_meters,check_in_geofence,check_in_exception_reason,check_out_latitude,check_out_longitude,check_out_accuracy_meters,check_out_distance_meters,check_out_geofence,check_out_exception_reason,report_data")
    .in("legacy_giornata_id", legacyIds);
  if (error) throw error;
  return new Map((data || []).map((row) => [row.legacy_giornata_id, row]));
}

export async function loadCrmOnlyBeautyVisits() {
  const { data: activities, error: activitiesError } = await supabase
    .from("crm_activities")
    .select("id,account_id,titolo,descrizione,stato,data_attivita,workspace_task_id")
    .eq("crm_tipo", "b2b")
    .eq("tipo", "visita_beauty")
    .eq("source_type", "beauty_crm")
    .order("data_attivita", { ascending: true });
  if (activitiesError) throw activitiesError;
  if (!activities?.length) return { days: [], clients: [], links: new Map() };

  const [detailsResult, accountsResult] = await Promise.all([
    supabase.from("crm_visit_details").select("activity_id,visit_status,check_in_at,check_out_at,check_in_latitude,check_in_longitude,check_in_accuracy_meters,check_in_distance_meters,check_in_geofence,check_in_exception_reason,check_out_latitude,check_out_longitude,check_out_accuracy_meters,check_out_distance_meters,check_out_geofence,check_out_exception_reason,report_data").in("activity_id", activities.map((row) => row.id)),
    supabase.from("crm_accounts").select("id,nome,indirizzo,citta,provincia,telefono,email").in("id", [...new Set(activities.map((row) => row.account_id))]),
  ]);
  if (detailsResult.error) throw detailsResult.error;
  if (accountsResult.error) throw accountsResult.error;
  const details = new Map((detailsResult.data || []).map((row) => [row.activity_id, row]));
  const accounts = new Map((accountsResult.data || []).map((row) => [row.id, row]));
  const clients = [...accounts.values()].map((account) => ({
    id: `crm:${account.id}`,
    crm_account_id: account.id,
    nome: account.nome,
    indirizzo: account.indirizzo,
    citta: account.citta,
    provincia: account.provincia,
    telefono: account.telefono,
    email: account.email,
    nuovo_contatto: true,
  }));
  const links = new Map();
  const days = activities.map((activity) => {
    const detail = details.get(activity.id) || {};
    const date = new Date(activity.data_attivita);
    const dayId = `crm:${activity.id}`;
    links.set(dayId, { ...detail, activity_id: activity.id });
    return {
      id: dayId,
      crm_activity_id: activity.id,
      workspace_task_id: activity.workspace_task_id,
      farmacia_id: `crm:${activity.account_id}`,
      data: activity.data_attivita?.slice(0, 10),
      ora_inizio: Number.isNaN(date.getTime()) ? null : date.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }),
      ora_fine: null,
      tipo_giornata: "Nuovo contatto",
      note_operative: activity.descrizione || "",
      stato: activity.stato === "completata" ? "eseguita" : activity.stato === "annullata" ? "annullata" : "pianificata",
      _crmOnly: true,
    };
  });
  return { days, clients, links };
}

export async function ensureCrmBeautyVisit({ giornata, client, title }) {
  let target = client.geo_latitude && client.geo_longitude
    ? { latitude: client.geo_latitude, longitude: client.geo_longitude }
    : null;
  if (!target) {
    const address = [client.indirizzo, client.citta, client.provincia].filter(Boolean).join(", ");
    const { data: geocodeResponse, error: geocodeError } = await supabase.functions.invoke("report-giornate-api", {
      body: { action: "beauty-geocode", address },
    });
    if (!geocodeError && !geocodeResponse?.error) target = geocodeResponse?.data || null;
  }
  const startsAt = `${giornata.data}T${giornata.ora_inizio || "09:00"}:00`;
  const { data, error } = await supabase.rpc("crm_create_beauty_visit", {
    p_customer_code: client.codice_cliente,
    p_customer_name: client.nome,
    p_address: [client.indirizzo, client.citta, client.provincia].filter(Boolean).join(", "),
    p_city: client.citta || null,
    p_phone: client.telefono || null,
    p_email: client.email || null,
    p_title: title || `Visita Beauty - ${client.nome}`,
    p_starts_at: startsAt,
    p_target_latitude: target?.latitude || null,
    p_target_longitude: target?.longitude || null,
    p_legacy_giornata_id: giornata.id,
    p_idempotency_key: `beauty-legacy:${giornata.id}`,
  });
  if (error) throw error;
  return data;
}

export async function createCrmBeautyContactVisit({ name, address, city, phone, email, data, oraInizio, title, note }) {
  let target = null;
  if (address) {
    const { data: geocodeResponse, error: geocodeError } = await supabase.functions.invoke("report-giornate-api", {
      body: { action: "beauty-geocode", address: [address, city].filter(Boolean).join(", ") },
    });
    if (!geocodeError && !geocodeResponse?.error) target = geocodeResponse?.data || null;
  }
  const { data: result, error } = await supabase.rpc("crm_create_beauty_visit", {
    p_customer_code: null,
    p_customer_name: name,
    p_address: address || null,
    p_city: city || null,
    p_phone: phone || null,
    p_email: email || null,
    p_title: title || `Visita Beauty - ${name}`,
    p_starts_at: `${data}T${oraInizio || "09:00"}:00`,
    p_target_latitude: target?.latitude || null,
    p_target_longitude: target?.longitude || null,
    p_legacy_giornata_id: null,
    p_idempotency_key: `beauty-contact:${crypto.randomUUID()}`,
  });
  if (error) throw error;
  if (note) {
    const { error: updateError } = await supabase.from("crm_activities").update({ descrizione: note }).eq("id", result.activity_id);
    if (updateError) throw updateError;
  }
  return result;
}

export async function checkInBeautyVisit(activityId, exceptionReason = null) {
  const position = await getCurrentPosition();
  const { data, error } = await supabase.rpc("crm_beauty_check_in", {
    p_activity_id: activityId,
    p_latitude: position.latitude,
    p_longitude: position.longitude,
    p_accuracy_meters: position.accuracy,
    p_address: null,
    p_exception_reason: exceptionReason,
  });
  if (error) throw error;
  return data;
}

export async function checkOutBeautyVisit(activityId, values) {
  const position = await getCurrentPosition();
  const { data, error } = await supabase.rpc("crm_beauty_check_out", {
    p_activity_id: activityId,
    p_latitude: position.latitude,
    p_longitude: position.longitude,
    p_accuracy_meters: position.accuracy,
    p_address: null,
    p_outcome: values.outcome,
    p_next_type: values.nextType || null,
    p_next_topic: values.nextTopic || null,
    p_next_at: values.nextAt || null,
    p_exception_reason: values.exceptionReason || null,
  });
  if (error) throw error;
  return data;
}
