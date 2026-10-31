import { Buffer } from "node:buffer";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createProgremesReadonlyAdmin } from "./progremes-readonly-auth.js";
import { buildMexalClient } from "./mexal/sync-products.js";
import { eligibleOrders } from "./order-preparation-mexal.js";
import { checked } from "./order-preparation-auth.js";
const TABLE = "warehouse_order_sync_cache";
export const orderIndexWorkerToken = (secret) =>
  createHmac("sha256", secret).update("warehouse-order-index").digest("hex");
export function orderIndexWorkerAuthorized(
  req,
  secret = globalThis.process?.env?.SUPABASE_SERVICE_ROLE_KEY,
) {
  const token = String(req.headers?.authorization || "").replace(
    /^Bearer /i,
    "",
  );
  if (!secret || !/^[a-f0-9]{64}$/.test(token)) return false;
  return timingSafeEqual(
    Buffer.from(token),
    Buffer.from(orderIndexWorkerToken(secret)),
  );
}
export const readOrderIndex = async (db) =>
  checked(await db.from(TABLE).select("*").eq("id", true).single());
export const orderIndexStatus = (cache) => ({
  lastSyncedAt: cache.last_synced_at,
  lastAttemptAt: cache.last_attempt_at,
  lastError: cache.last_error,
  inProgress: !!cache.lease_until && Date.parse(cache.lease_until) > Date.now(),
  automaticTime: "12:00",
  timezone: "Europe/Rome",
  enabled: cache.scheduler_enabled,
});
export async function synchronizeOrderIndex(db, client, source = "manual") {
  const claim = checked(
    await db.rpc("warehouse_claim_order_index_sync", { p_source: source }),
  );
  if (!claim) return readOrderIndex(db);
  try {
    const orders = await eligibleOrders(client),
      codes = [...new Set(orders.map((o) => o.customerCode))];
    const names = codes.length
      ? checked(
          await db
            .from("ordini_clienti_cache")
            .select("codice_cliente,ragione_sociale")
            .in("codice_cliente", codes),
        )
      : [];
    const prepared = orders.map((o) => ({
      ...o,
      customerName:
        names.find((n) => n.codice_cliente === o.customerCode)
          ?.ragione_sociale || o.customerCode,
    }));
    return checked(
      await db.rpc("warehouse_finish_order_index_sync", {
        p_token: claim.token,
        p_orders: prepared,
        p_error: null,
      }),
    );
  } catch (error) {
    await db.rpc("warehouse_finish_order_index_sync", {
      p_token: claim.token,
      p_orders: null,
      p_error: String(
        error.message || "Sincronizzazione Mexal non riuscita.",
      ).slice(0, 1000),
    });
    throw error;
  }
}
export function createOrderIndexSyncHandler({
  authorize = orderIndexWorkerAuthorized,
  adminFactory = createProgremesReadonlyAdmin,
  clientFactory = buildMexalClient,
} = {}) {
  return async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    if (req.method !== "POST")
      return res.status(405).json({ error: "Metodo non consentito." });
    if (!authorize(req))
      return res.status(401).json({ error: "Scheduler non autorizzato." });
    try {
      const cache = await synchronizeOrderIndex(
        adminFactory(),
        clientFactory({ warehouse: null, timeoutMs: 300000 }),
        "scheduled",
      );
      return res
        .status(200)
        .json({
          ok: true,
          count: cache.orders.length,
          sync: orderIndexStatus(cache),
        });
    } catch (error) {
      return res
        .status(502)
        .json({ error: error.message || "Sincronizzazione OCM non riuscita." });
    }
  };
}
export default createOrderIndexSyncHandler();
