import { createClient } from "@supabase/supabase-js";
import { verifyUser } from "../../../server/mexal/sync-products.js";
const required = (name) => { const value = String(process.env[name] || "").trim(); if (!value) throw new Error(`Variabile Vercel mancante: ${name}`); return value; };
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Metodo non consentito." });
  try { const admin = createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } }); await verifyUser(req, admin, { allowOrdersUser: true });
    const orderId = String(req.body?.orderId || "").trim(); const header = req.body?.testata; const lines = req.body?.righe;
    if (!orderId || !header || !Array.isArray(lines) || !lines.length) return res.status(400).json({ error: "orderId, testata e righe sono obbligatori." });
    const { error } = await admin.rpc("aggiorna_ordine_operativo", { p_ordine_id: orderId, p_testata: header, p_righe: lines });
    if (error) { error.status = error.code === "P0001" ? 409 : 500; throw error; }
    return res.status(200).json({ success: true });
  } catch (error) { return res.status(error.status || 500).json({ error: error.message || "Impossibile aggiornare l'ordine." }); }
}
