import { createClient } from "@supabase/supabase-js";
import process from "node:process";
import { verifyUser } from "../../../server/mexal/sync-products.js";
const required = (name) => { const value = String(process.env[name] || "").trim(); if (!value) throw new Error(`Variabile Vercel mancante: ${name}`); return value; };
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Metodo non consentito." });
  try { const admin = createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } }); const authorization = await verifyUser(req, admin, { allowOrdersUser: true, allowCustomerPrivateOrder: true });
    const orderId = String(req.body?.orderId || "").trim(); const header = req.body?.testata; const lines = req.body?.righe;
    if (!orderId || !header || !Array.isArray(lines) || !lines.length) return res.status(400).json({ error: "orderId, testata e righe sono obbligatori." });
    if (authorization?.customerCode) {
      const { data: existing, error: existingError } = await admin.from("ordini_testate").select("codice_cliente,modulo_ordini,stato").eq("id", orderId).maybeSingle();
      if (existingError) throw existingError;
      const ownsPrivateDraft = existing
        && String(existing.modulo_ordini || "").toLowerCase() === "private"
        && String(existing.stato || "").toLowerCase() === "bozza"
        && String(existing.codice_cliente || "").trim().toUpperCase() === String(authorization.customerCode).trim().toUpperCase()
        && String(header.codice_cliente || "").trim().toUpperCase() === String(authorization.customerCode).trim().toUpperCase();
      if (!ownsPrivateDraft) return res.status(403).json({ error: "Il cliente può modificare soltanto le proprie bozze OCT Private." });
    }
    const { error } = await admin.rpc("aggiorna_ordine_operativo", { p_ordine_id: orderId, p_testata: header, p_righe: lines });
    if (error) { error.status = error.code === "P0001" ? 409 : 500; throw error; }
    return res.status(200).json({ success: true });
  } catch (error) { return res.status(error.status || 500).json({ error: error.message || "Impossibile aggiornare l'ordine." }); }
}
