import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { verifyProductionMessage, HMAC_HEADERS } from "./progremes-production-hmac.js";

export const INVENTORY_PATH = "/api/progremes-inventory/snapshot";
export function validateInventorySnapshot(value) {
  if (value?.schemaVersion !== 1 || !Number.isFinite(Date.parse(value.capturedAt)) ||
      !Array.isArray(value.rows) || !value.rows.length || value.rows.length > 200) return false;
  const keys = new Set();
  for (const row of value.rows) {
    const key = `${row.article_code}|${row.warehouse_number}`;
    if (!/^[A-Z0-9&][A-Z0-9._/&+ %,-]{0,79}$/i.test(row.article_code || "") ||
        row.article_code !== row.article_code.trim().toUpperCase() || ![1, 8].includes(row.warehouse_number) ||
        ![row.on_hand, row.available, row.committed, row.unit_cost].every(Number.isFinite) ||
        row.committed < 0 || row.unit_cost < 0 || keys.has(key)) return false;
    keys.add(key);
  }
  return [...keys].every(key => keys.has(key.replace(/\|(1|8)$/, (_, number) => `|${number === "1" ? "8" : "1"}`)));
}

export async function handleInventorySnapshot(req, res, { admin, env = process.env } = {}) {
  if (req.method !== "POST") return res.status(405).json({ error: "Metodo non consentito." });
  if (env.PROGREMES_PRODUCTION_CALLBACKS_ENABLED !== "true") return res.status(403).json({ code: "MODULE_DISABLED" });
  const body = Buffer.from(typeof req.body === "string" ? req.body : JSON.stringify(req.body || {}));
  if (!verifyProductionMessage({ method: "POST", path: INVENTORY_PATH, headers: req.headers, body,
    secret: env.PROGREMES_INTEGRATION_SECRET })) return res.status(401).json({ code: "INVALID_SIGNATURE" });
  let snapshot;
  try { snapshot = JSON.parse(body.toString("utf8")); } catch { return res.status(400).json({ code: "INVALID_REQUEST" }); }
  if (!validateInventorySnapshot(snapshot) || !/^[0-9a-f-]{36}$/i.test(req.headers[HMAC_HEADERS.eventId] || ""))
    return res.status(400).json({ code: "INVALID_SNAPSHOT" });
  const db = admin || createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data, error } = await db.rpc("apply_workspace_mes_inventory", {
    p_event_id: req.headers[HMAC_HEADERS.eventId], p_captured_at: snapshot.capturedAt,
    p_hash: createHash("sha256").update(body).digest("hex"), p_rows: snapshot.rows,
  });
  if (error) return res.status(503).json({ code: "INVENTORY_APPLY_FAILED", error: "Snapshot non applicato: ritentare la consegna." });
  // A failed deferred replay does not undo the snapshot already saved durably.
  const replay = await db.rpc("replay_workspace_mes_inventory_pending");
  return res.status(200).json({ status: { ...data,
    pendingArticles: replay.data?.pendingArticles ?? data?.pendingArticles ?? 0 } });
}
