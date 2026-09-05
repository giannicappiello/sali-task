import { useEffect, useId, useState } from "react";
import { Search } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { crmCustomerKeyForAccount } from "../modules/crm/crmWorkspaceCustomers";
import "./workspace-customer-picker.css";

export default function WorkspaceCustomerPicker({ value = "", onChange, crmType = "conto_terzi", required = false }) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!value) return undefined;
    let active = true;
    const resolveValue = async () => {
      if (value.startsWith("mexal:")) {
        const code = value.slice(6);
        const { data } = await supabase.from("ordini_clienti_cache").select("codice_cliente,ragione_sociale").eq("codice_cliente", code).maybeSingle();
        if (active) setQuery(data ? `${data.ragione_sociale || code} · ${code}` : code);
      } else if (value.startsWith("crm:")) {
        const id = value.slice(4);
        const { data } = await supabase.from("crm_accounts").select("id,nome").eq("id", id).maybeSingle();
        if (active) setQuery(data?.nome || value);
      }
    };
    void resolveValue();
    return () => { active = false; };
  }, [value]);

  useEffect(() => {
    const term = query.trim();
    if (value || term.length < 2) return undefined;
    let active = true;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      const escaped = term.replaceAll("%", "\\%").replaceAll("_", "\\_");
      const [accountsResult, customersResult] = await Promise.all([
        supabase.from("crm_accounts").select("id,nome,tipo,codice_cliente_mexal").eq("tipo", crmType).ilike("nome", `%${escaped}%`).limit(12),
        supabase.from("crm_classified_customers").select("codice_cliente,ragione_sociale,area_crm").eq("area_crm", crmType).or(`ragione_sociale.ilike.%${escaped}%,codice_cliente.ilike.%${escaped}%`).limit(12),
      ]);
      if (!active) return;
      const unique = new Map();
      (customersResult.data || []).forEach((customer) => unique.set(`mexal:${customer.codice_cliente}`, {
        key: `mexal:${customer.codice_cliente}`,
        label: customer.ragione_sociale || customer.codice_cliente,
        detail: customer.codice_cliente,
      }));
      (accountsResult.data || []).forEach((account) => {
        const key = crmCustomerKeyForAccount(account);
        unique.set(key, { key, label: account.nome, detail: account.codice_cliente_mexal || "Prospect CRM" });
      });
      setOptions([...unique.values()].slice(0, 12));
      setLoading(false);
    }, 220);
    return () => { active = false; window.clearTimeout(timer); };
  }, [crmType, query, value]);

  const select = (option) => {
    onChange?.(option.key);
    setQuery(`${option.label} · ${option.detail}`);
    setOptions([]);
  };

  return <div className="workspace-customer-picker">
    <div className="workspace-customer-picker-control">
      <Search size={17} aria-hidden="true" />
      <input
        required={required}
        role="combobox"
        aria-expanded={options.length > 0}
        aria-controls={listId}
        autoComplete="off"
        placeholder="Ricerca rapida cliente o codice"
        value={query}
        onChange={(event) => { setQuery(event.target.value); setOptions([]); onChange?.(""); }}
      />
    </div>
    {!value && query.trim().length >= 2 ? <div id={listId} className="workspace-customer-picker-results" role="listbox">
      {options.map((option) => <button type="button" role="option" aria-selected="false" key={option.key} onClick={() => select(option)}><strong>{option.label}</strong><span>{option.detail}</span></button>)}
      {!loading && !options.length ? <small>Nessun cliente trovato.</small> : null}
      {loading ? <small>Ricerca clienti...</small> : null}
    </div> : null}
  </div>;
}
