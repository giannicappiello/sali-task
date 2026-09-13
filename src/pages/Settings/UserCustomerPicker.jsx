import { useState } from "react";

export default function UserCustomerPicker({ customers, value, onChange }) {
  const [search, setSearch] = useState("");
  const selected = new Set(value);
  const query = search.trim().toLocaleLowerCase("it");
  const matches = customers.filter((customer) => customer.attivo_mexal !== false && !selected.has(customer.codice_cliente)
    && (!query || [customer.ragione_sociale, customer.codice_cliente, customer.partita_iva].join(" ").toLocaleLowerCase("it").includes(query)));
  const byCode = new Map(customers.map((customer) => [customer.codice_cliente, customer]));
  return <fieldset className="wide user-customer-picker">
    <legend>Clienti associati in anagrafica</legend>
    <div className="user-customer-selected" aria-label="Clienti selezionati">
      {value.map((code) => <div key={code}>
        <span><strong>{byCode.get(code)?.ragione_sociale || "Anagrafica non disponibile"}</strong><small>{code}</small></span>
        <button type="button" aria-label={`Rimuovi ${byCode.get(code)?.ragione_sociale || code}`} onClick={() => onChange(value.filter((item) => item !== code))}>Rimuovi</button>
      </div>)}
      {!value.length && <p>Nessun cliente associato.</p>}
    </div>
    <label>Cerca cliente<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Ragione sociale, codice o partita IVA..." /></label>
    <div className="user-customer-results" role="region" aria-label="Clienti da associare" tabIndex={0}>
      {matches.slice(0, 50).map((customer) => <label key={customer.codice_cliente}>
        <input type="checkbox" checked={false} onChange={() => onChange([...value, customer.codice_cliente])} />
        <span><strong>{customer.ragione_sociale || "Anagrafica senza ragione sociale"}</strong><small>{customer.codice_cliente}{customer.partita_iva ? ` · P. IVA ${customer.partita_iva}` : ""}</small></span>
      </label>)}
      {!matches.length && <p>Nessun altro cliente corrispondente.</p>}
    </div>
    {matches.length > 50 && <small>Primi 50 risultati di {matches.length}: affina la ricerca.</small>}
    <small>Per il ruolo Cliente seleziona almeno un’anagrafica. L’associazione limita l’utente ai dati dei clienti selezionati, anche con altri ruoli. Il salvataggio sostituisce tutti i collegamenti precedenti.</small>
  </fieldset>;
}
