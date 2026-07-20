/* global process */
import { createClient } from "@supabase/supabase-js";
import { buildMexalClient, verifyUser } from "../../../server/mexal/sync-products.js";
import { ORDER_DOCUMENTS, buildMexalOrderDocument, classifyOrderLines } from "../../../server/mexal/order-documents.js";

const DOCUMENT_KINDS = new Set(Object.keys(ORDER_DOCUMENTS));
function required(name) { const value = String(process.env[name] || "").trim(); if (!value) throw new Error(`Variabile Vercel mancante: ${name}`); return value; }
function text(value) { return String(value ?? "").trim(); }
function valueType(value) { return Array.isArray(value) ? "array" : value === null ? "null" : typeof value; }
function jsonPath(path, key) { return path === "$" ? `$.${key}` : `${path}.${key}`; }
function keyShape(key) { return key.toLowerCase().replace(/[^a-z0-9]/g, ""); }
function stringFormat(value) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return "date-yyyy-mm-dd";
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(value)) return "date-dd/mm/yyyy";
  if (/^\d{8}$/.test(value)) return "date-yyyymmdd";
  if (/^-?\d+(?:[.,]\d+)?$/.test(value)) return "numeric-string";
  if (/^[A-Z0-9_-]+$/.test(value)) return "upper-identifier";
  return "text";
}

/** Compare JSON shapes without treating business values as schema differences. */
export function compareMexalPayloads(getPayload, postPayload) {
  const comparison = { missing_fields: [], additional_fields: [], type_differences: [], format_differences: [], nomenclature_differences: [] };
  function compare(getValue, postValue, path) {
    const getType = valueType(getValue); const postType = valueType(postValue);
    if (getType !== postType) { comparison.type_differences.push({ path, get_type: getType, post_type: postType }); return; }
    if (getType === "string") {
      const getFormat = stringFormat(getValue); const postFormat = stringFormat(postValue);
      if (getFormat !== postFormat) comparison.format_differences.push({ path, get_format: getFormat, post_format: postFormat });
      return;
    }
    if (getType === "array") { for (let index = 0; index < Math.min(getValue.length, postValue.length); index += 1) compare(getValue[index], postValue[index], `${path}[${index}]`); return; }
    if (getType !== "object") return;
    const getKeys = Object.keys(getValue); const postKeys = Object.keys(postValue);
    const getKeyShapes = new Map(getKeys.map((key) => [keyShape(key), key]));
    const postKeyShapes = new Map(postKeys.map((key) => [keyShape(key), key]));
    for (const key of getKeys) {
      if (!(key in postValue)) {
        const postName = postKeyShapes.get(keyShape(key));
        if (postName) comparison.nomenclature_differences.push({ path, get_field: key, post_field: postName });
        else comparison.missing_fields.push({ path: jsonPath(path, key), get_type: valueType(getValue[key]) });
      } else compare(getValue[key], postValue[key], jsonPath(path, key));
    }
    for (const key of postKeys) if (!(key in getValue) && !getKeyShapes.has(keyShape(key))) comparison.additional_fields.push({ path: jsonPath(path, key), post_type: valueType(postValue[key]) });
  }
  compare(getPayload, postPayload, "$");
  return comparison;
}

function supabaseAdmin() { return createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } }); }
function documentOptions(config, kind) { return { serie: config?.[`serie_${kind.toLowerCase()}`] || 1, magazzino: config?.id_magazzino || 5 }; }

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Metodo non consentito." });
  try {
    const admin = supabaseAdmin(); const authorization = await verifyUser(req, admin, { allowOrdersUser: true });
    if (!authorization?.isAdmin) return res.status(403).json({ error: "Diagnostica riservata agli amministratori." });
    const orderId = text(req.body?.orderId); const kind = text(req.body?.kind).toUpperCase(); const sigla = text(req.body?.sigla).toUpperCase(); const serie = text(req.body?.serie); const numero = text(req.body?.numero);
    if (!orderId || !DOCUMENT_KINDS.has(kind) || !sigla || !serie || !numero) return res.status(400).json({ error: "orderId, kind (OCM/OCX/OCI), sigla, serie e numero sono obbligatori." });
    const [{ data: order, error: orderError }, { data: lines, error: linesError }, { data: config, error: configError }] = await Promise.all([
      admin.from("ordini_testate").select("*").eq("id", orderId).single(), admin.from("ordini_righe").select("*").eq("ordine_id", orderId).order("id"), admin.from("ordini_configurazione_documenti").select("serie_ocm,serie_ocx,serie_oci,id_magazzino").eq("id", 1).maybeSingle(),
    ]);
    if (orderError) throw orderError; if (linesError) throw linesError; if (configError) throw configError;
    const postPayload = buildMexalOrderDocument(order, kind, classifyOrderLines(lines)[kind], documentOptions(config, kind));
    if (!postPayload) return res.status(400).json({ error: `L'ordine non contiene righe per ${kind}.` });
    const resource = `/documenti/ordini-clienti/${encodeURIComponent(sigla)}+${encodeURIComponent(serie)}+${encodeURIComponent(numero)}`;
    const getPayload = await buildMexalClient().getJson(resource); const comparison = compareMexalPayloads(getPayload, postPayload);
    const { error: saveError } = await admin.from("mexal_order_payload_diagnostics").insert({ ordine_id: orderId, tipo_documento: kind, sigla, serie, numero, get_payload: getPayload, post_payload: postPayload, comparison });
    if (saveError) throw saveError;
    return res.status(200).json({ success: true, resource, get_payload: getPayload, post_payload: postPayload, comparison });
  } catch (error) {
    console.error("Mexal order payload diagnostic failed", { error: error?.message });
    return res.status(error.status || 500).json({ success: false, error: error.message || "Errore diagnostica documento Mexal." });
  }
}
