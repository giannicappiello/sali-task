/* global Buffer */
import { safeFetch, safeError } from "./digital-security.js";

const endpoints = Object.freeze({
  amazonSp: { eu: "https://sellingpartnerapi-eu.amazon.com", na: "https://sellingpartnerapi-na.amazon.com", fe: "https://sellingpartnerapi-fe.amazon.com" },
  amazonAds: { eu: "https://advertising-api-eu.amazon.com", na: "https://advertising-api.amazon.com", fe: "https://advertising-api-fe.amazon.com" },
});

function basic(username, password) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

async function request(url, options, fetcher) {
  const response = await fetcher(url, options);
  if (!response.ok) {
    const providerMessage = typeof response.data === "object" ? response.data?.message || response.data?.error_description || response.data?.error : null;
    throw Object.assign(new Error(providerMessage || `Provider HTTP ${response.status}.`), { status: response.status === 401 || response.status === 403 ? 422 : 502, code: `provider_${response.status}` });
  }
  return response.data || {};
}

async function formToken(url, fields, fetcher) {
  const body = new URLSearchParams(fields).toString();
  return request(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body }, fetcher);
}

async function refreshAccessToken(connection, secrets, fetcher) {
  const c = connection.configurazione || {};
  switch (connection.provider_code) {
    case "amazon_sp_api":
    case "amazon_ads":
      return formToken("https://api.amazon.com/auth/o2/token", { grant_type: "refresh_token", refresh_token: secrets.lwa_refresh_token || secrets.refresh_token, client_id: c.lwa_client_id || c.client_id, client_secret: secrets.lwa_client_secret || secrets.client_secret }, fetcher);
    case "google_ads":
      return formToken("https://oauth2.googleapis.com/token", { grant_type: "refresh_token", refresh_token: secrets.refresh_token, client_id: c.client_id, client_secret: secrets.client_secret }, fetcher);
    default:
      return { access_token: secrets.access_token };
  }
}

function account(externalId, name, type, marketplace = null, currency = null) {
  return { external_id: String(externalId), nome: name || String(externalId), tipo: type, marketplace, valuta: currency || "EUR", metadati: {} };
}

export async function testProviderConnection(connection, secrets, { fetcher = safeFetch } = {}) {
  const c = connection.configurazione || {};
  let data; let accounts;
  try {
    switch (connection.provider_code) {
      case "custom_mailing_api":
      case "custom_ecommerce_api": { // Intentional generic contract: a safe root/status GET only.
        const headers = {};
        if (connection.auth_type === "bearer" && secrets.bearer_token) headers.authorization = `Bearer ${secrets.bearer_token}`;
        if (connection.auth_type === "api_key" && secrets.api_key) headers["x-api-key"] = secrets.api_key;
        if (connection.auth_type === "basic" && secrets.basic_username) headers.authorization = basic(secrets.basic_username, secrets.basic_password || "");
        data = await request(c.base_url, { headers }, fetcher);
        accounts = [account(c.account_id || new URL(c.base_url).hostname, data?.name || new URL(c.base_url).hostname, "store")];
        break;
      }
      case "woocommerce": {
        const base = String(c.site_url).replace(/\/$/, "");
        data = await request(`${base}/wp-json/wc/v3/system_status`, { headers: { authorization: basic(secrets.consumer_key, secrets.consumer_secret) } }, fetcher);
        accounts = [account(data?.environment?.site_url || new URL(base).hostname, data?.settings?.title || new URL(base).hostname, "store")];
        break;
      }
      case "shopify": {
        const version = c.api_version || "2026-07";
        data = await request(`https://${c.shop_domain}/admin/api/${version}/shop.json`, { headers: { "x-shopify-access-token": secrets.access_token } }, fetcher);
        const shop = data.shop || {};
        accounts = [account(shop.id || c.shop_domain, shop.name || c.shop_domain, "store", null, shop.currency)];
        break;
      }
      case "brevo":
        data = await request("https://api.brevo.com/v3/account", { headers: { "api-key": secrets.api_key } }, fetcher);
        accounts = [account(data.email || data.companyName || "brevo", data.companyName || data.email, "mailing")]; break;
      case "mailchimp": {
        const dc = c.data_center || String(secrets.api_key || "").split("-").pop();
        if (!dc) throw Object.assign(new Error("Data center Mailchimp mancante."), { status: 400 });
        const headers = secrets.access_token ? { authorization: `Bearer ${secrets.access_token}` } : { authorization: basic("workspace", secrets.api_key) };
        data = await request(`https://${dc}.api.mailchimp.com/3.0/`, { headers }, fetcher);
        accounts = [account(data.account_id || dc, data.account_name || "Mailchimp", "mailing")]; break;
      }
      case "klaviyo":
        data = await request("https://a.klaviyo.com/api/accounts/", { headers: { authorization: `Klaviyo-API-Key ${secrets.private_api_key}`, revision: c.revision || "2026-07-15", accept: "application/vnd.api+json" } }, fetcher);
        accounts = (data.data || []).map((row) => account(row.id, row.attributes?.contact_information?.organization_name || row.id, "mailing")); break;
      case "amazon_sp_api": {
        const token = await refreshAccessToken(connection, secrets, fetcher);
        data = await request(`${endpoints.amazonSp[c.region || "eu"]}/sellers/v1/marketplaceParticipations`, { headers: { "x-amz-access-token": token.access_token } }, fetcher);
        accounts = (data.payload || data.marketplaceParticipations || []).map((row) => account(row.marketplace?.id || row.marketplaceId, row.marketplace?.name || row.marketplaceId, "seller", row.marketplace?.id || row.marketplaceId, row.marketplace?.defaultCurrencyCode)); break;
      }
      case "amazon_ads": {
        const token = await refreshAccessToken(connection, secrets, fetcher);
        data = await request(`${endpoints.amazonAds[c.region || "eu"]}/v2/profiles`, { headers: { authorization: `Bearer ${token.access_token}`, "amazon-advertising-api-clientid": c.client_id } }, fetcher);
        accounts = (Array.isArray(data) ? data : []).map((row) => account(row.profileId, row.accountInfo?.name || row.profileId, "advertising", row.countryCode, row.currencyCode)); break;
      }
      case "meta_ads": {
        const version = c.graph_version || "v24.0";
        data = await request(`https://graph.facebook.com/${version}/me/adaccounts?fields=id,name,currency,account_status`, { headers: { authorization: `Bearer ${secrets.access_token}` } }, fetcher);
        accounts = (data.data || []).map((row) => account(row.id, row.name, "advertising", null, row.currency)); break;
      }
      case "google_ads": {
        const token = await refreshAccessToken(connection, secrets, fetcher);
        const version = c.api_version || "v25";
        const headers = { authorization: `Bearer ${token.access_token}`, "developer-token": secrets.developer_token };
        if (c.manager_account_id) headers["login-customer-id"] = String(c.manager_account_id).replace(/-/g, "");
        data = await request(`https://googleads.googleapis.com/${version}/customers:listAccessibleCustomers`, { headers }, fetcher);
        accounts = (data.resourceNames || []).map((name) => account(String(name).split("/").pop(), name, "advertising")); break;
      }
      default: throw Object.assign(new Error("Adapter provider non disponibile."), { status: 400 });
    }
    return { success: true, accounts, message: `Connessione verificata; ${accounts.length} account accessibili.` };
  } catch (error) {
    throw safeError(error);
  }
}
