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
  const [accountsResult, customersResult] = await Promise.all([
    supabase
      .from("crm_accounts")
      .select("id,nome,tipo,codice_cliente_mexal")
      .eq("tipo", crmType)
      .order("nome")
      .limit(2000),
    supabase
      .from("crm_classified_customers")
      .select("codice_cliente,ragione_sociale,area_crm,crm_account_id")
      .eq("area_crm", crmType)
      .limit(5000),
  ]);

  const error = accountsResult.error || customersResult.error;
  return {
    directory: buildCrmCustomerDirectory(accountsResult.data || [], customersResult.data || []),
    error,
  };
}
