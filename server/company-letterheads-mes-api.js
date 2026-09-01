/* global process */
import { Buffer } from "node:buffer";
import { createClient } from "@supabase/supabase-js";
import { verifyProductionMessage } from "./progremes-production-hmac.js";

const RESOLVE_PATH = "/api/company-letterheads/mes/resolve";
function required(name) { const value = String(process.env[name] || "").trim(); if (!value) throw new Error(`Configurazione server mancante: ${name}`); return value; }
function adminClient() { return createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } }); }

export async function handleMesHeadingResolve(req, res, { admin = adminClient() } = {}) {
  if (req.method !== "POST") return res.status(405).json({ error: "Metodo non consentito." });
  const raw = Buffer.from(typeof req.body === "string" ? req.body : JSON.stringify(req.body || {}));
  if (!verifyProductionMessage({ method: "POST", path: RESOLVE_PATH, headers: req.headers, body: raw, secret: required("PROGREMES_INTEGRATION_SECRET") })) return res.status(401).json({ error: "Autenticazione MES non valida.", code: "INVALID_SIGNATURE" });
  const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
  const documentTypeCode = String(body.documentTypeCode || "").trim().toUpperCase();
  if (!documentTypeCode) return res.status(400).json({ error: "Tipo documento obbligatorio.", code: "INVALID_REQUEST" });
  const { data, error } = await admin.rpc("resolve_document_letterhead", { p_document_type_code: documentTypeCode, p_brand: body.brand || null, p_business_area: body.businessArea || null, p_language: body.language || "it", p_at: body.at || new Date().toISOString().slice(0, 10) });
  if (error) throw error;
  const resolution = data?.[0];
  if (!resolution) return res.status(404).json({ error: "Nessuna intestazione valida configurata.", code: "LETTERHEAD_NOT_CONFIGURED" });
  const signed = await admin.storage.from(resolution.storage_bucket).createSignedUrl(resolution.storage_path, 300);
  if (signed.error) throw signed.error;
  const signatureAssets = await Promise.all((resolution.signature_assets || []).map(async (asset) => {
    const signatureUrl = await admin.storage.from(asset.storageBucket).createSignedUrl(asset.storagePath, 300);
    if (signatureUrl.error) throw signatureUrl.error;
    return { ...asset, downloadUrl: signatureUrl.data.signedUrl };
  }));
  return res.status(200).json({ schemaVersion: 1, documentTypeCode,
    ruleId: resolution.rule_id, letterheadId: resolution.letterhead_id, letterheadCode: resolution.letterhead_code,
    letterheadName: resolution.letterhead_name, versionId: resolution.version_id, headingVersion: resolution.heading_version,
    storageBucket: resolution.storage_bucket, storagePath: resolution.storage_path, mimeType: resolution.mime_type,
    sha256: resolution.sha256, templateValidUntil: resolution.template_valid_until, resolution: resolution.resolution,
    signatureAssets, downloadUrl: signed.data.signedUrl, expiresInSeconds: 300 });
}

export { RESOLVE_PATH };
