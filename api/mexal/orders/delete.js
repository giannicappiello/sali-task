import { createClient } from "@supabase/supabase-js";
import { verifyUser } from "../../../server/mexal/sync-products.js";
const required = (name) => { const value = String(process.env[name] || "").trim(); if (!value) throw new Error(`Variabile Vercel mancante: ${name}`); return value; };
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Metodo non consentito." });
  try { const admin = createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } }); await verifyUser(req, admin, { allowOrdersUser: true }); const orderId = String(req.body?.orderId || "").trim();
    const [{ data: order, error }, { data: docs, error: docsError }] = await Promise.all([admin.from("ordini_testate").select("numero_ocm,numero_ocx,numero_oci").eq("id", orderId).single(), admin.from("ordini_documenti_mexal").select("numero").eq("ordine_id", orderId).not("numero", "is", null)]);
    if (error) throw error; if (docsError) throw docsError;
    if (order.numero_ocm || order.numero_ocx || order.numero_oci || docs?.length) return res.status(409).json({ error: "L’ordine non può essere eliminato perché esiste già un documento Mexal." });
    await admin.from("mexal_sync_runs").delete().contains("metadata", { order_id: orderId });
    const { error: deleteError } = await admin.from("ordini_testate").delete().eq("id", orderId); if (deleteError) throw deleteError;
    return res.status(200).json({ success: true });
  } catch (error) { return res.status(error.status || 500).json({ error: error.message || "Impossibile eliminare l'ordine." }); }
}
