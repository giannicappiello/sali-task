export function crmCustomerKeyForAccount(account) {
  if (!account?.id) return "";
  return account.codice_cliente_mexal
    ? `mexal:${account.codice_cliente_mexal}`
    : `crm:${account.id}`;
}

export function buildCrmCustomerDirectory(accounts = [], customers = []) {
  const directory = new Map();

  customers.forEach((customer) => {
    if (!customer?.codice_cliente) return;
    directory.set(`mexal:${customer.codice_cliente}`, {
      key: `mexal:${customer.codice_cliente}`,
      name: customer.ragione_sociale || customer.codice_cliente,
      customerCode: customer.codice_cliente,
      accountId: customer.crm_account_id || null,
    });
  });

  accounts.forEach((account) => {
    const key = crmCustomerKeyForAccount(account);
    if (!key) return;
    const current = directory.get(key);
    directory.set(key, {
      key,
      name: account.nome || current?.name || account.codice_cliente_mexal || "Cliente",
      customerCode: account.codice_cliente_mexal || current?.customerCode || null,
      accountId: account.id,
    });
  });

  return directory;
}

export async function loadCrmCustomerDirectory(supabase, crmType) {
  let accountsQuery = supabase
    .from("crm_accounts")
    .select("id,nome,tipo,codice_cliente_mexal")
    .order("nome")
    .limit(2000);
  let customersQuery = supabase
    .from("crm_classified_customers")
    .select("codice_cliente,ragione_sociale,area_crm,crm_account_id")
    .limit(5000);
  if (crmType) {
    accountsQuery = accountsQuery.eq("tipo", crmType);
    customersQuery = customersQuery.eq("area_crm", crmType);
  }
  const [accountsResult, customersResult] = await Promise.all([accountsQuery, customersQuery]);

  const error = accountsResult.error || customersResult.error;
  return {
    directory: buildCrmCustomerDirectory(accountsResult.data || [], customersResult.data || []),
    error,
  };
}

export function workspaceCustomerName(directory, customerKey) {
  if (!customerKey) return "";
  return directory?.get(customerKey)?.name || (customerKey === "crm:00000000-0000-4000-8000-000000000001" ? "DIRECT" : "Cliente");
}
