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
    .select("activity_id,legacy_giornata_id,visit_status,check_in_at,check_out_at,check_in_geofence,check_out_geofence")
    .in("legacy_giornata_id", legacyIds);
  if (error) throw error;
  return new Map((data || []).map((row) => [row.legacy_giornata_id, row]));
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
