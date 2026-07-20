import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const fulfillment = await readFile("src/modules/orders/services/orderFulfillment.js", "utf8");

const endpoints = [
  ["submitOrderToMexal", "/api/mexal/submit-order", "api/mexal/submit-order.js"],
  ["stopOrderSync", "/api/mexal/orders/stop-sync", "api/mexal/orders/stop-sync.js"],
  ["deleteOrder", "/api/mexal/orders/delete", "api/mexal/orders/delete.js"],
  ["updateOrder", "/api/mexal/orders/update", "api/mexal/orders/update.js"],
  ["recoverOrderSync", "/api/mexal/orders/recover-sync", "api/mexal/orders/recover-sync.js"],
  ["checkOrderAvailability", "/api/mexal/orders/check-availability", "api/mexal/orders/check-availability.js"],
];

for (const [functionName, endpoint, apiFile] of endpoints) {
  assert.match(fulfillment, new RegExp(`export function ${functionName}[\\s\\S]*?postJson\\("${endpoint}"`));
  await access(apiFile);
}

assert.match(
  fulfillment,
  /export function stopOrderSync\(orderId\)\s*\{\s*return postJson\("\/api\/mexal\/orders\/stop-sync", \{ orderId \}\);\s*\}/,
);
assert.doesNotMatch(fulfillment, /\/api\/mexal\/orders\/\$\{orderId\}\/stop-sync/);

console.log("order API endpoints match their Vercel function files");
