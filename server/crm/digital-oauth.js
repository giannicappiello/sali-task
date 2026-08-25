/* global Buffer, process */
import crypto from "node:crypto";
import { decryptSecret, encryptSecret, safeFetch } from "./digital-security.js";

const b64url = (buffer) => Buffer.from(buffer).toString("base64url");
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");

function callbackUrl() {
  const explicit = String(process.env.CRM_DIGITAL_OAUTH_CALLBACK_URL || "").trim();
  if (!explicit) throw Object.assign(new Error("Callback OAuth Digital non configurata."), { status: 500 });
  const url = new URL(explicit);
  if (url.protocol !== "https:") throw Object.assign(new Error("La callback OAuth deve usare HTTPS."), { status: 500 });
  return url.toString();
}

function oauthDefinition(connection) {
  const c = connection.configurazione || {};
  switch (connection.provider_code) {
    case "shopify": return { authorize: `https://${c.shop_domain}/admin/oauth/authorize`, token: `https://${c.shop_domain}/admin/oauth/access_token`, clientId: c.client_id, scope: "read_products,read_orders,read_customers", pkce: false };
    case "mailchimp": return { authorize: "https://login.mailchimp.com/oauth2/authorize", token: "https://login.mailchimp.com/oauth2/token", clientId: c.client_id, scope: "", pkce: false };
    case "amazon_sp_api": { const hosts = { eu: "https://sellercentral-europe.amazon.com", na: "https://sellercentral.amazon.com", fe: "https://sellercentral.amazon.co.jp" }; return { authorize: `${hosts[c.region || "eu"]}/apps/authorize/consent`, token: "https://api.amazon.com/auth/o2/token", clientId: c.lwa_client_id, applicationId: c.application_id, scope: "", pkce: false, amazonSp: true }; }
    case "amazon_ads": return { authorize: "https://www.amazon.com/ap/oa", token: "https://api.amazon.com/auth/o2/token", clientId: c.client_id, scope: "advertising::campaign_management", pkce: false };
    case "meta_ads": return { authorize: `https://www.facebook.com/${c.graph_version || "v24.0"}/dialog/oauth`, token: `https://graph.facebook.com/${c.graph_version || "v24.0"}/oauth/access_token`, clientId: c.client_id, scope: "ads_read,business_management", pkce: false };
    case "google_ads": return { authorize: "https://accounts.google.com/o/oauth2/v2/auth", token: "https://oauth2.googleapis.com/token", clientId: c.client_id, scope: "https://www.googleapis.com/auth/adwords", pkce: true };
    default: throw Object.assign(new Error("OAuth non disponibile per questo provider."), { status: 400 });
  }
}

export async function startDigitalOAuth(db, actorId, connection) {
  const definition = oauthDefinition(connection);
  if (!definition.clientId || (definition.amazonSp && !definition.applicationId)) throw Object.assign(new Error("Client/Application ID OAuth incompleto."), { status: 422 });
  const state = b64url(crypto.randomBytes(32)); const verifier = b64url(crypto.randomBytes(48)); const encrypted = encryptSecret(verifier);
  const { error } = await db.from("crm_connection_oauth_states").insert({ connection_id: connection.id, provider_code: connection.provider_code, state_hash: hash(state), verifier_ciphertext: encrypted.ciphertext, verifier_iv: encrypted.iv, verifier_auth_tag: encrypted.auth_tag, created_by: actorId, expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() });
  if (error) throw error;
  const url = new URL(definition.authorize);
  if (definition.amazonSp) { url.searchParams.set("application_id", definition.applicationId); url.searchParams.set("version", "beta"); }
  else { url.searchParams.set("client_id", definition.clientId); url.searchParams.set("redirect_uri", callbackUrl()); url.searchParams.set("response_type", "code"); if (definition.scope) url.searchParams.set("scope", definition.scope); }
  url.searchParams.set("state", state);
  if (definition.pkce) { url.searchParams.set("code_challenge", b64url(crypto.createHash("sha256").update(verifier).digest())); url.searchParams.set("code_challenge_method", "S256"); url.searchParams.set("access_type", "offline"); url.searchParams.set("prompt", "consent"); }
  return { authorizationUrl: url.toString(), expiresIn: 600 };
}

async function exchange(definition, connection, secrets, code, verifier) {
  const params = new URLSearchParams({ grant_type: "authorization_code", code, client_id: definition.clientId, redirect_uri: callbackUrl() });
  if (definition.pkce) params.set("code_verifier", verifier);
  const clientSecret = secrets.client_secret || secrets.lwa_client_secret;
  if (clientSecret) params.set("client_secret", clientSecret);
  const response = await safeFetch(definition.token, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: params.toString() });
  if (!response.ok || !response.data?.access_token) throw Object.assign(new Error("Scambio OAuth rifiutato dal provider."), { status: 422 });
  return response.data;
}

export async function completeDigitalOAuth(db, query) {
  const rawState = String(query.state || ""); const code = String(query.code || query.spapi_oauth_code || "");
  if (!rawState || !code) throw Object.assign(new Error("Callback OAuth incompleta."), { status: 400 });
  const { data: state, error } = await db.from("crm_connection_oauth_states").update({ consumed_at: new Date().toISOString() }).eq("state_hash", hash(rawState)).is("consumed_at", null).gt("expires_at", new Date().toISOString()).select().single();
  if (error || !state) throw Object.assign(new Error("State OAuth non valido, scaduto o gia usato."), { status: 400 });
  const { data: connection, error: connectionError } = await db.from("crm_external_connections").select("*").eq("id", state.connection_id).single();
  if (connectionError) throw connectionError;
  const { data: secretRows, error: secretError } = await db.from("crm_connection_secrets").select("*").eq("connection_id", connection.id); if (secretError) throw secretError;
  const secrets = Object.fromEntries((secretRows || []).map((row) => [row.secret_name, decryptSecret(row)]));
  const verifier = decryptSecret({ ciphertext: state.verifier_ciphertext, iv: state.verifier_iv, auth_tag: state.verifier_auth_tag });
  const token = await exchange(oauthDefinition(connection), connection, secrets, code, verifier);
  const values = { access_token: token.access_token, refresh_token: token.refresh_token };
  if (connection.provider_code === "amazon_sp_api" && token.refresh_token) { values.lwa_refresh_token = token.refresh_token; delete values.refresh_token; }
  for (const [name, value] of Object.entries(values)) {
    if (!value) continue; const encrypted = encryptSecret(value);
    const { error: upsertError } = await db.from("crm_connection_secrets").upsert({ connection_id: connection.id, secret_name: name, ...encrypted, aggiornata_da: state.created_by, aggiornata_il: new Date().toISOString() }); if (upsertError) throw upsertError;
  }
  const expiresAt = token.expires_in ? new Date(Date.now() + Number(token.expires_in) * 1000).toISOString() : null;
  await db.from("crm_external_connections").update({ stato: "da_verificare", credenziali_stato: "configurate", oauth_scade_il: expiresAt, ultimo_errore: null }).eq("id", connection.id);
  return { redirectPath: `${state.redirect_path}?oauth=success` };
}
