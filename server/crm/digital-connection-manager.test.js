/* global Buffer */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { DIGITAL_PROVIDER_REGISTRY, providerDefinition, validateProviderConfiguration } from "../../shared/digitalProviderRegistry.js";
import { assertPublicHttpsUrl, decryptSecret, encryptSecret, isBlockedAddress, maskSecret, redact } from "./digital-security.js";
import { testProviderConnection } from "./digital-provider-adapters.js";

const root = path.resolve(import.meta.dirname, "../..");
const key = Buffer.alloc(32, 7).toString("base64");

test("il registry copre i provider richiesti senza duplicati", () => {
  const codes = DIGITAL_PROVIDER_REGISTRY.map((item) => item.providerCode);
  assert.deepEqual(new Set(codes).size, codes.length);
  for (const code of ["custom_ecommerce_api", "woocommerce", "shopify", "brevo", "mailchimp", "klaviyo", "amazon_sp_api", "amazon_ads", "meta_ads", "google_ads"]) assert.ok(codes.includes(code));
});

test("gli schemi sono dinamici e rifiutano URL non HTTPS o campi estranei", () => {
  const provider = providerDefinition("custom_ecommerce_api");
  assert.throws(() => validateProviderConfiguration(provider, { base_url: "http://example.com" }), /HTTPS/);
  assert.throws(() => validateProviderConfiguration(provider, { base_url: "https://example.com", access_token: "no" }), /non previsto/);
  assert.equal(validateProviderConfiguration(provider, { base_url: "https://example.com" }).base_url, "https://example.com");
});

test("i segreti sono cifrati autenticati, mascherati e mai restituiti", () => {
  const encrypted = encryptSecret("very-secret-value", key);
  assert.equal(decryptSecret(encrypted, key), "very-secret-value");
  assert.equal(JSON.stringify(encrypted).includes("very-secret-value"), false);
  assert.match(maskSecret(encrypted), /^••••••••/);
  assert.equal(redact({ authorization: "Bearer value", nested: { api_key: "value" } }).nested.api_key, "[REDACTED]");
});

test("la protezione SSRF blocca reti locali, metadata e risoluzioni miste", async () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "192.168.1.2", "::1", "fd00::1"]) assert.equal(isBlockedAddress(address), true);
  await assert.rejects(() => assertPublicHttpsUrl("https://example.com", { lookup: async () => [{ address: "93.184.216.34" }, { address: "127.0.0.1" }] }), /privata/);
  await assert.rejects(() => assertPublicHttpsUrl("https://metadata.google.internal", { lookup: async () => [{ address: "8.8.8.8" }] }), /pubblico/);
  assert.equal((await assertPublicHttpsUrl("https://example.com", { lookup: async () => [{ address: "93.184.216.34" }] })).hostname, "example.com");
});

test("il test WooCommerce e non distruttivo e restituisce solo account sicuri", async () => {
  let request;
  const result = await testProviderConnection({ provider_code: "woocommerce", configurazione: { site_url: "https://shop.example.com" } }, { consumer_key: "ck_secret", consumer_secret: "cs_secret" }, { fetcher: async (url, options) => { request = { url, options }; return { ok: true, status: 200, data: { environment: { site_url: "https://shop.example.com" }, settings: { title: "Shop" } } }; } });
  assert.match(request.url, /system_status$/); assert.equal(request.options.method, undefined);
  assert.equal(result.accounts[0].nome, "Shop");
  assert.equal(JSON.stringify(result).includes("ck_secret"), false); assert.equal(JSON.stringify(result).includes("cs_secret"), false);
});

test("frontend e risposte non leggono il vault", () => {
  const settings = fs.readFileSync(path.join(root, "src/pages/Settings/DigitalConnectionsSettings.jsx"), "utf8");
  const service = fs.readFileSync(path.join(root, "src/modules/integrations/services/digitalConnectionsService.js"), "utf8");
  const manager = fs.readFileSync(path.join(root, "server/crm/digital-connection-manager.js"), "utf8");
  assert.equal(settings.includes("crm_connection_secrets"), false); assert.equal(service.includes("crm_connection_secrets"), false);
  assert.match(manager, /canRevealSecrets: false/); assert.doesNotMatch(manager, /res\.status\([^\n]+decryptedSecrets/);
});

test("migrazione nega il vault al frontend e limita le RPC al service role", () => {
  const migration = fs.readFileSync(path.join(root, "supabase/migrations/20260824132000_digital_connection_manager.sql"), "utf8");
  assert.match(migration, /revoke all on public\.crm_connection_secrets from public,anon,authenticated/);
  assert.match(migration, /grant execute on function public\.crm_claim_sync_run_service[^\n]+to service_role/);
  assert.match(migration, /crm_can_view_connection_manager/); assert.match(migration, /integrations\.configure/);
});

test("OAuth usa state hash monouso, scadenza e redirect finale senza token", () => {
  const oauth = fs.readFileSync(path.join(root, "server/crm/digital-oauth.js"), "utf8");
  const manager = fs.readFileSync(path.join(root, "server/crm/digital-connection-manager.js"), "utf8");
  assert.match(oauth, /state_hash: hash\(state\)/); assert.match(oauth, /consumed_at/); assert.match(oauth, /expires_at/);
  assert.match(manager, /res\.redirect\(302, result\.redirectPath\)/); assert.doesNotMatch(manager, /redirect[^\n]+access_token/);
});

test("scheduler Digital usa il dispatcher consolidato senza creare una tredicesima funzione", () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
  const dispatcher = fs.readFileSync(path.join(root, "api/cron/mexal-dispatcher.js"), "utf8");
  const apiFiles = fs.readdirSync(path.join(root, "api"), { recursive: true })
    .filter((file) => /\.js$/.test(file));
  assert.ok(config.crons.some((item) => item.path === "/api/cron/mexal-dispatcher" && item.schedule === "0 22 * * *"));
  assert.equal(config.crons.some((item) => item.path === "/api/cron/crm-digital-dispatcher"), false);
  assert.equal(config.functions["api/cron/mexal-dispatcher.js"].maxDuration, 300);
  assert.equal(config.functions["api/cron/crm-digital-dispatcher.js"], undefined);
  assert.equal(apiFiles.length, 12);
  assert.match(dispatcher, /route=crm-digital&action=dispatch/);
});
