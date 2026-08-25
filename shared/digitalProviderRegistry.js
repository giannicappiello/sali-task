const field = (name, label, type = "text", options = {}) => Object.freeze({
  name,
  label,
  type,
  required: options.required === true,
  placeholder: options.placeholder || "",
  help: options.help || "",
  defaultValue: options.defaultValue ?? "",
  options: Object.freeze(options.options || []),
});

const secret = (name, label, kind, options = {}) => Object.freeze({
  name,
  label,
  kind,
  required: options.required !== false,
  help: options.help || "",
});

const provider = (definition) => Object.freeze({
  ...definition,
  configurationSchema: Object.freeze(definition.configurationSchema || []),
  secretSchema: Object.freeze(definition.secretSchema || []),
  capabilities: Object.freeze(definition.capabilities || []),
  authOptions: Object.freeze(definition.authOptions || [definition.authType]),
});

export const DIGITAL_PROVIDER_CATEGORIES = Object.freeze([
  { code: "ecommerce", label: "Ecommerce", connectionType: "ecommerce" },
  { code: "mailing", label: "Mailing", connectionType: "mailing" },
  { code: "marketplace", label: "Marketplace", connectionType: "amazon_seller" },
  { code: "advertising", label: "Advertising", connectionType: "meta_ads" },
]);

export const DIGITAL_PROVIDER_REGISTRY = Object.freeze([
  provider({
    providerType: "ecommerce",
    providerCode: "custom_ecommerce_api",
    displayName: "API Ecommerce custom",
    description: "Sito o piattaforma ecommerce con API HTTPS validata lato server.",
    icon: "globe",
    category: "ecommerce",
    authType: "bearer",
    authOptions: ["api_key", "bearer", "basic"],
    configurationSchema: [
      field("base_url", "API base URL", "url", { required: true, placeholder: "https://api.example.com" }),
      field("site_url", "URL sito", "url", { placeholder: "https://www.example.com" }),
      field("account_id", "Store / account ID"),
      field("environment", "Ambiente", "select", { defaultValue: "production", options: [
        { value: "production", label: "Produzione" },
        { value: "sandbox", label: "Sandbox" },
      ] }),
    ],
    secretSchema: [
      secret("api_key", "API key", "api_key", { required: false }),
      secret("bearer_token", "Bearer token", "bearer", { required: false }),
      secret("basic_username", "Username API", "username", { required: false }),
      secret("basic_password", "Password API", "password", { required: false }),
      secret("webhook_secret", "Webhook secret", "webhook_secret", { required: false }),
    ],
    capabilities: ["test_connection", "account_discovery", "manual_sync", "webhooks", "product_mapping"],
    testConnection: "custom_api_root",
    sync: "account_discovery",
  }),
  provider({
    providerType: "ecommerce",
    providerCode: "woocommerce",
    displayName: "WooCommerce",
    description: "WooCommerce REST API v3 su HTTPS.",
    icon: "shopping-bag",
    category: "ecommerce",
    authType: "basic",
    configurationSchema: [
      field("site_url", "URL store", "url", { required: true, placeholder: "https://shop.example.com" }),
      field("environment", "Ambiente", "select", { defaultValue: "production", options: [
        { value: "production", label: "Produzione" },
        { value: "staging", label: "Staging" },
      ] }),
    ],
    secretSchema: [
      secret("consumer_key", "Consumer key", "api_key"),
      secret("consumer_secret", "Consumer secret", "client_secret"),
      secret("webhook_secret", "Webhook secret", "webhook_secret", { required: false }),
    ],
    capabilities: ["test_connection", "account_discovery", "manual_sync", "webhooks", "product_mapping"],
    testConnection: "woocommerce_system_status",
    sync: "account_discovery",
  }),
  provider({
    providerType: "ecommerce",
    providerCode: "shopify",
    displayName: "Shopify",
    description: "Shopify Admin API con token offline o OAuth.",
    icon: "shopping-bag",
    category: "ecommerce",
    authType: "oauth2",
    authOptions: ["oauth2", "bearer"],
    configurationSchema: [
      field("shop_domain", "Dominio myshopify.com", "text", { required: true, placeholder: "store.myshopify.com" }),
      field("client_id", "Client ID", "text"),
      field("api_version", "Versione API", "text", { defaultValue: "2026-07" }),
    ],
    secretSchema: [
      secret("client_secret", "Client secret", "client_secret", { required: false }),
      secret("access_token", "Admin access token", "access_token", { required: false }),
      secret("webhook_secret", "Webhook secret", "webhook_secret", { required: false }),
    ],
    capabilities: ["oauth2", "test_connection", "account_discovery", "manual_sync", "webhooks", "product_mapping"],
    testConnection: "shopify_shop",
    sync: "account_discovery",
  }),
  provider({
    providerType: "mailing",
    providerCode: "custom_mailing_api",
    displayName: "API Mailing generica",
    description: "Provider mailing con API HTTPS e chiamata di verifica non distruttiva.",
    icon: "mail", category: "mailing", authType: "bearer", authOptions: ["api_key", "bearer", "basic"],
    configurationSchema: [
      field("base_url", "API base URL", "url", { required: true, placeholder: "https://api.example.com" }),
      field("account_id", "Account ID"), field("default_list_id", "Lista / audience predefinita"), field("default_sender", "Mittente predefinito"),
    ],
    secretSchema: [
      secret("api_key", "API key", "api_key", { required: false }), secret("bearer_token", "Bearer token", "bearer", { required: false }),
      secret("basic_username", "Username API", "username", { required: false }), secret("basic_password", "Password API", "password", { required: false }),
      secret("webhook_secret", "Webhook secret", "webhook_secret", { required: false }),
    ],
    capabilities: ["test_connection", "account_discovery", "manual_sync", "webhooks"], testConnection: "custom_api_root", sync: "account_discovery",
  }),
  provider({
    providerType: "mailing",
    providerCode: "brevo",
    displayName: "Brevo",
    description: "Brevo API v3 per account, liste e campagne.",
    icon: "mail",
    category: "mailing",
    authType: "api_key",
    configurationSchema: [
      field("default_list_id", "Lista predefinita", "text"),
      field("default_sender", "Mittente predefinito", "text"),
    ],
    secretSchema: [secret("api_key", "API key", "api_key")],
    capabilities: ["test_connection", "account_discovery", "manual_sync"],
    testConnection: "brevo_account",
    sync: "account_discovery",
  }),
  provider({
    providerType: "mailing",
    providerCode: "mailchimp",
    displayName: "Mailchimp",
    description: "Mailchimp Marketing API 3.0 con API key o OAuth 2.0.",
    icon: "mail",
    category: "mailing",
    authType: "oauth2",
    authOptions: ["oauth2", "api_key"],
    configurationSchema: [
      field("data_center", "Data center", "text", { placeholder: "us6" }),
      field("client_id", "Client ID", "text"),
      field("default_list_id", "Audience predefinita", "text"),
    ],
    secretSchema: [
      secret("client_secret", "Client secret", "client_secret", { required: false }),
      secret("api_key", "API key", "api_key", { required: false }),
      secret("access_token", "OAuth access token", "access_token", { required: false }),
    ],
    capabilities: ["oauth2", "test_connection", "account_discovery", "manual_sync", "webhooks"],
    testConnection: "mailchimp_root",
    sync: "account_discovery",
  }),
  provider({
    providerType: "mailing",
    providerCode: "klaviyo",
    displayName: "Klaviyo",
    description: "Klaviyo API con private API key a scope minimo.",
    icon: "mail",
    category: "mailing",
    authType: "api_key",
    configurationSchema: [
      field("revision", "Revisione API", "text", { defaultValue: "2026-07-15" }),
      field("default_list_id", "Lista predefinita", "text"),
    ],
    secretSchema: [secret("private_api_key", "Private API key", "api_key")],
    capabilities: ["test_connection", "account_discovery", "manual_sync"],
    testConnection: "klaviyo_accounts",
    sync: "account_discovery",
  }),
  provider({
    providerType: "amazon_seller",
    providerCode: "amazon_sp_api",
    displayName: "Amazon Seller (SP-API)",
    description: "Amazon Selling Partner API ufficiale, senza scraping.",
    icon: "store",
    category: "marketplace",
    authType: "refresh_token",
    authOptions: ["oauth2", "refresh_token"],
    configurationSchema: [
      field("seller_id", "Seller ID", "text", { required: true }),
      field("lwa_client_id", "LWA Client ID", "text", { required: true }),
      field("application_id", "SP-API Application ID", "text"),
      field("region", "Regione", "select", { required: true, defaultValue: "eu", options: [
        { value: "eu", label: "Europa" },
        { value: "na", label: "Nord America" },
        { value: "fe", label: "Estremo Oriente" },
      ] }),
      field("marketplace_ids", "Marketplace ID", "multivalue", { required: true, help: "Uno o piu Marketplace ID ufficiali." }),
      field("environment", "Ambiente", "select", { defaultValue: "production", options: [
        { value: "production", label: "Produzione" },
        { value: "sandbox", label: "Sandbox" },
      ] }),
    ],
    secretSchema: [
      secret("lwa_client_secret", "LWA Client Secret", "client_secret"),
      secret("lwa_refresh_token", "LWA Refresh Token", "refresh_token"),
    ],
    capabilities: ["oauth2", "token_refresh", "test_connection", "account_discovery", "manual_sync", "product_mapping", "multiple_marketplaces"],
    testConnection: "amazon_marketplace_participations",
    sync: "account_discovery",
  }),
  provider({
    providerType: "amazon_ads",
    providerCode: "amazon_ads",
    displayName: "Amazon Ads",
    description: "Amazon Ads API con profili pubblicitari distinti dal Seller.",
    icon: "megaphone",
    category: "advertising",
    authType: "oauth2",
    configurationSchema: [
      field("client_id", "OAuth Client ID", "text", { required: true }),
      field("region", "Regione API", "select", { defaultValue: "eu", options: [
        { value: "na", label: "Nord America" },
        { value: "eu", label: "Europa" },
        { value: "fe", label: "Estremo Oriente" },
      ] }),
      field("profile_id", "Advertising Profile ID", "text"),
      field("marketplace_ids", "Marketplace", "multivalue"),
    ],
    secretSchema: [
      secret("client_secret", "OAuth Client Secret", "client_secret"),
      secret("refresh_token", "Refresh Token", "refresh_token", { required: false }),
    ],
    capabilities: ["oauth2", "token_refresh", "test_connection", "account_discovery", "manual_sync", "multiple_accounts"],
    testConnection: "amazon_ads_profiles",
    sync: "account_discovery",
  }),
  provider({
    providerType: "meta_ads",
    providerCode: "meta_ads",
    displayName: "Meta Ads",
    description: "Meta Marketing API per Business e Ad Account.",
    icon: "megaphone",
    category: "advertising",
    authType: "oauth2",
    configurationSchema: [
      field("client_id", "Meta App ID", "text", { required: true }),
      field("business_id", "Business Account ID", "text"),
      field("ad_account_id", "Ad Account ID", "text"),
      field("page_id", "Page ID", "text"),
      field("pixel_id", "Pixel ID", "text"),
      field("graph_version", "Graph API version", "text", { defaultValue: "v24.0" }),
    ],
    secretSchema: [
      secret("client_secret", "Meta App Secret", "client_secret"),
      secret("access_token", "Access Token", "access_token", { required: false }),
    ],
    capabilities: ["oauth2", "test_connection", "account_discovery", "manual_sync", "multiple_accounts"],
    testConnection: "meta_ad_accounts",
    sync: "account_discovery",
  }),
  provider({
    providerType: "google_ads",
    providerCode: "google_ads",
    displayName: "Google Ads",
    description: "Google Ads API con OAuth 2.0 e Developer Token.",
    icon: "chart",
    category: "advertising",
    authType: "oauth2",
    configurationSchema: [
      field("client_id", "OAuth Client ID", "text", { required: true }),
      field("customer_id", "Customer ID", "text"),
      field("manager_account_id", "Manager Account ID", "text"),
      field("api_version", "Versione API", "text", { defaultValue: "v25" }),
    ],
    secretSchema: [
      secret("client_secret", "OAuth Client Secret", "client_secret"),
      secret("refresh_token", "Refresh Token", "refresh_token", { required: false }),
      secret("developer_token", "Developer Token", "api_key"),
    ],
    capabilities: ["oauth2", "token_refresh", "test_connection", "account_discovery", "manual_sync", "multiple_accounts"],
    testConnection: "google_accessible_customers",
    sync: "account_discovery",
  }),
]);

export const DIGITAL_PROVIDER_BY_CODE = Object.freeze(
  Object.fromEntries(DIGITAL_PROVIDER_REGISTRY.map((item) => [item.providerCode, item]))
);

export function providerDefinition(providerCode) {
  return DIGITAL_PROVIDER_BY_CODE[String(providerCode || "").trim()] || null;
}

export function providerConnectionType(providerCode) {
  return providerDefinition(providerCode)?.providerType || null;
}

export function defaultProviderConfiguration(definition) {
  return Object.fromEntries((definition?.configurationSchema || []).map((item) => [item.name, item.defaultValue]));
}

export function validateProviderConfiguration(definition, configuration = {}) {
  if (!definition) throw new Error("Provider non supportato.");
  const allowed = new Set(definition.configurationSchema.map((item) => item.name));
  const normalized = {};
  for (const schema of definition.configurationSchema) {
    const raw = configuration[schema.name] ?? schema.defaultValue;
    const value = schema.type === "multivalue"
      ? (Array.isArray(raw) ? raw : String(raw || "").split(",")).map((item) => String(item).trim()).filter(Boolean)
      : String(raw ?? "").trim();
    if (schema.required && (Array.isArray(value) ? !value.length : !value)) {
      throw new Error(`${schema.label}: valore obbligatorio.`);
    }
    if (schema.type === "url" && value) {
      const url = new URL(value);
      if (url.protocol !== "https:") throw new Error(`${schema.label}: utilizzare HTTPS.`);
    }
    normalized[schema.name] = value;
  }
  for (const key of Object.keys(configuration || {})) {
    if (!allowed.has(key)) throw new Error(`Parametro di configurazione non previsto: ${key}.`);
  }
  return normalized;
}

export function requiredSecretNames(definition) {
  return (definition?.secretSchema || []).filter((item) => item.required).map((item) => item.name);
}
