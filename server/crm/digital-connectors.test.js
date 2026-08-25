import test from "node:test";
import assert from "node:assert/strict";
import { digitalConnectorModule, makeSyncIdempotencyKey, nextRetryDelay, validateDigitalConnection } from "./digital-connectors.js";

test("mappa ogni connettore al modulo autorizzativo corretto", () => {
  assert.equal(digitalConnectorModule("ecommerce"), "crm_online_ecommerce");
  assert.equal(digitalConnectorModule("amazon_ads"), "crm_online_amazon");
  assert.equal(digitalConnectorModule("google_ads"), "crm_online_adv");
});

test("accetta configurazioni HTTPS e respinge segreti nel payload", () => {
  assert.equal(validateDigitalConnection({ tipo: "ecommerce", nome: "Store", endpoint_url: "https://store.example/api" }), true);
  assert.throws(() => validateDigitalConnection({ tipo: "meta_ads", nome: "Meta", configurazione: { access_token: "secret" } }), /segreti/i);
  assert.throws(() => validateDigitalConnection({ tipo: "mailing", nome: "Mail", endpoint_url: "http://mail.example" }), /HTTPS/);
});

test("retry rispetta Retry-After e idempotenza resta deterministica", () => {
  assert.equal(nextRetryDelay(5, 12), 12_000);
  assert.equal(nextRetryDelay(1), 30_000);
  assert.equal(makeSyncIdempotencyKey({ connectionId: "c1", syncType: "orders", cursor: "42" }), "c1:orders:42:");
});
