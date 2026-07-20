import { createClient } from "@supabase/supabase-js";
import { verifyUser } from "../../../server/mexal/sync-products.js";

const required = (name) => { const value = String(process.env[name] || "").trim(); if (!value) throw new Error(`Variabile Vercel mancante: ${name}`); return value; };
const adminClient = () => createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Metodo non consentito." });
  try {
    const admin = adminClient(); const user = await verifyUser(req, admin, { allowOrdersUser: true });
    const orderId = String(req.query?.orderId || req.body?.orderId || "").trim();
    if (!orderId) return res.status(400).json({ error: "orderId obbligatorio." });
    const { data, error } = await admin.from("ordini_testate").update({ arresto_sync_richiesto: true, arresto_sync_richiesto_il: new Date().toISOString(), arresto_sync_richiesto_da: user.authUserId, stato_sincronizzazione: "arresto_richiesto" }).eq("id", orderId).eq("stato_sincronizzazione", "in_corso").select("id").maybeSingle();
    if (error) throw error;
    if (!data) return res.status(409).json({ error: "L'invio non è attivo o è già stato arrestato." });
    return res.status(202).json({ message: "Arresto richiesto: l'eventuale POST Mexal già iniziata sarà completata e non saranno creati altri documenti." });
  } catch (error) { return res.status(error.status || 500).json({ error: error.message || "Impossibile arrestare l'invio." }); }
}
