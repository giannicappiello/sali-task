import { createClient } from "@supabase/supabase-js";
import { buildMexalClient, verifyUser } from "../../../server/mexal/sync-products.js";
import { runOrderContractDiagnostics } from "../../../server/mexal/order-contract-diagnostics.js";

const required = (name) => {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Variabile Vercel mancante: ${name}`);
  return value;
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Metodo non consentito." });

  try {
    const admin = createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
    const authorization = await verifyUser(req, admin, { allowOrdersUser: true });

    if (req.body?.action === "order-contract-diagnostics") {
      if (!authorization?.isAdmin) return res.status(403).json({ error: "Diagnostica riservata agli amministratori." });
      const result = await runOrderContractDiagnostics(buildMexalClient(), req.body?.leftReference, req.body?.rightReference);
      return res.status(200).json(result);
    }

    const orderId = String(req.body?.orderId || "").trim();
    if (!orderId) return res.status(400).json({ error: "orderId obbligatorio." });
    const { data, error } = await admin.rpc("recupera_sync_ordine_scaduta", { p_ordine_id: orderId });
    if (error) throw error;
    return res.status(200).json({ recovered: data === true });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || "Impossibile recuperare lo stato." });
  }
}
