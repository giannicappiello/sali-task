import { createClient } from "@supabase/supabase-js";
import { buildMexalClient, verifyUser } from "../../server/mexal/sync-products.js";
import { syncListPriceCommissions } from "../../server/mexal/sync-list-price-commissions.js";

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Variabile Vercel mancante: ${name}`);
  return value;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "Metodo non consentito." });
  try {
    const admin = createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
    const authorization = req.headers.authorization || "";
    const isCron = Boolean(process.env.CRON_SECRET && authorization === `Bearer ${process.env.CRON_SECRET}`);
    if (!isCron) {
      const user = await verifyUser(req, admin, { allowOrdersUser: false });
      if (!user?.isAdmin) return res.status(403).json({ success: false, error: "Sincronizzazione riservata agli amministratori." });
    }
    const result = await syncListPriceCommissions({ mexal: buildMexalClient(), supabase: admin, source: isCron ? "cron" : (req.body?.origin || "manual") });
    return res.status(200).json(result);
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, error: error.message || "Errore sincronizzazione provvigioni listini." });
  }
}
