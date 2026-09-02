import { createClient } from "@supabase/supabase-js";
import process from "node:process";
import { verifyUser } from "../../../server/mexal/sync-products.js";
import {
  confirmationEmailAvailableAt,
  enqueueOrderConfirmationEmails,
  loadOrderConfirmationEmailContext,
} from "../../../server/orders/order-email-queue.js";

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Variabile Vercel mancante: ${name}`);
  return value;
}

function adminClient() {
  return createClient(
    required("SUPABASE_URL"),
    required("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Metodo non consentito." });
  }

  try {
    const supabase = adminClient();
    const authorization = await verifyUser(req, supabase, { allowOrdersUser: true, allowCustomerPrivateOrder: true });
    const orderId = String(req.body?.orderId || "").trim();
    const moduleCode = String(req.body?.moduleCode || "").trim().toLowerCase();
    if (!orderId) return res.status(400).json({ error: "orderId obbligatorio." });

    const context = await loadOrderConfirmationEmailContext({
      supabase,
      orderId,
      moduleCode,
    });
    if (authorization?.customerCode && (
      String(context.order?.modulo_ordini || "").toLowerCase() !== "private"
      || String(context.order?.codice_cliente || "").trim().toUpperCase() !== String(authorization.customerCode).trim().toUpperCase()
    )) {
      return res.status(403).json({ error: "Il cliente può gestire soltanto le notifiche dei propri ordini OCT Private." });
    }
    const result = await enqueueOrderConfirmationEmails({
      supabase,
      ...context,
      availableAt: confirmationEmailAvailableAt(context.moduleConfig),
    });
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    return res.status(error.status || 500).json({
      error: error.message || "Accodamento email ordine non riuscito.",
    });
  }
}
