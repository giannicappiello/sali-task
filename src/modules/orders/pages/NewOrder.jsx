import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Minus, Plus, Save, Search, ShoppingCart, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../../lib/supabaseClient";
import useOrdersAccess from "./useOrdersAccess";
import { calculateLineConditions } from "../services/priceEngine";

const PAGE_SIZE = 1000;

function normalize(value) {
  return String(value ?? "").trim();
}

function money(value) {
  return Number(value || 0).toLocaleString("it-IT", {
    style: "currency",
    currency: "EUR",
  });
}

function numberValue(value, fallback = 0) {
  const parsed = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}


function customerDiscount(customer) {
  const data = customer?.dati_mexal || customer?.json_mexal || {};
  const raw =
    customer?.sconto_incondizionato ??
    data?.sconto_icz ??
    data?.sconto_incondizionato ??
    data?.sconto_incond ??
    data?.sconto_cliente ??
    data?.sconto ??
    0;

  const values = String(raw ?? "")
    .replace(/%/g, "")
    .split(/[+;/]/)
    .map((value) => numberValue(value.trim(), NaN))
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= 100);

  if (!values.length) return 0;

  // Mexal può esprimere sconti concatenati, ad esempio 10+5.
  // Li converte nello sconto equivalente applicabile alla riga.
  const remaining = values.reduce(
    (factor, value) => factor * (1 - value / 100),
    1
  );

  return Number(((1 - remaining) * 100).toFixed(4));
}

function paymentDescription(customer) {
  const data = customer?.dati_mexal || customer?.json_mexal || {};
  return (
    data?._descrizione_pagamento ||
    data?.descrizione_pagamento ||
    data?.des_pagamento ||
    data?.pagamento_descrizione ||
    customer?.codice_pagamento ||
    "-"
  );
}

async function loadPaged(table, buildQuery) {
  const rows = [];
  let from = 0;

  while (true) {
    const query = buildQuery(
      supabase.from(table).select("*").range(from, from + PAGE_SIZE - 1)
    );
    const { data, error } = await query;
    if (error) throw error;
    const page = data || [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
    from += PAGE_SIZE;
  }
}

export default function NewOrder() {
  const navigate = useNavigate();
  const {
    loading: accessLoading,
    canAccessOrders,
    canSeeAll,
    visibleAgents,
    agentCode,
  } = useOrdersAccess();

  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [discountMatrix, setDiscountMatrix] = useState([]);
  const [specialConditions, setSpecialConditions] = useState([]);
  const [paymentRules, setPaymentRules] = useState([]);
  const [selectedPayment, setSelectedPayment] = useState(null);
  const [customerSearch, setCustomerSearch] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [lines, setLines] = useState([]);
  const [comments, setComments] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!accessLoading) loadData();
  }, [accessLoading, canAccessOrders, canSeeAll, JSON.stringify(visibleAgents)]);

  async function loadData() {
    setLoading(true);
    setError("");

    try {
      if (!canAccessOrders) throw new Error("Accesso al modulo Ordini non autorizzato.");
      if (!canSeeAll && !visibleAgents?.length) {
        throw new Error("Nessun codice agente Mexal associato all'utente.");
      }

      const customerRows = await loadPaged("ordini_clienti_cache", (query) => {
        let result = query
          .eq("attivo_mexal", true)
          .order("ragione_sociale", { ascending: true })
          .order("codice_cliente", { ascending: true });
        if (!canSeeAll) result = result.in("codice_agente_mexal", visibleAgents);
        return result;
      });

      let productRows = [];

      // Prima usa la cache Mexal. Se la tabella esiste ma non contiene ancora
      // prodotti visibili, passa comunque all'archivio prodotti principale.
      // La versione precedente eseguiva il fallback solo in caso di errore:
      // con una cache vuota la ricerca non poteva quindi restituire risultati.
      try {
        productRows = await loadPaged("ordini_prodotti_cache", (query) =>
          query
            .eq("mostra_in_app", true)
            .order("descrizione", { ascending: true })
            .order("codice_articolo", { ascending: true })
        );
      } catch (cacheError) {
        console.warn("Cache prodotti ordini non disponibile:", cacheError);
      }

      if (productRows.length === 0) {
        const fallback = await loadPaged("prodotti", (query) =>
          query
            .eq("mostra_in_app", true)
            .eq("attivo", true)
            .order("nome", { ascending: true })
        );
        productRows = fallback;
      }

      const [matrixRows, particularityRows, paymentRows] = await Promise.all([
        loadPaged("ordini_sconti_listini", (query) => query),
        loadPaged("ordini_particolarita", (query) => query),
        loadPaged("ordini_regole_pagamento", (query) => query),
      ]);

      setCustomers(customerRows);
      setProducts(productRows);
      setDiscountMatrix(matrixRows);
      setSpecialConditions(particularityRows.map((row) => row.dati_mexal || row));
      setPaymentRules(paymentRows);
    } catch (loadError) {
      console.error("Errore caricamento nuovo ordine:", loadError);
      setError(loadError.message || "Errore caricamento dati ordine.");
    } finally {
      setLoading(false);
    }
  }

  const filteredCustomers = useMemo(() => {
    const query = customerSearch.trim().toLowerCase();
    if (!query) return customers.slice(0, 80);
    return customers
      .filter((customer) =>
        [
          customer.codice_cliente,
          customer.ragione_sociale,
          customer.localita,
          customer.provincia,
          customer.partita_iva,
        ].some((value) => String(value ?? "").toLowerCase().includes(query))
      )
      .slice(0, 80);
  }, [customers, customerSearch]);

  const filteredProducts = useMemo(() => {
    const query = productSearch.trim().toLowerCase();
    if (!query) return [];
    return products
      .filter((product) =>
        [
          product.codice_articolo,
          product.codice_mexal,
          product.codice,
          product.descrizione,
          product.nome,
          product.brand,
          product.categoria,
          product.ean,
        ].some((value) => String(value ?? "").toLowerCase().includes(query))
      )
      .slice(0, 60);
  }, [products, productSearch]);

  const totals = useMemo(() => {
    return lines.reduce(
      (result, line) => {
        const net = line.quantita * numberValue(line.prezzo_netto, line.prezzo_unitario);
        result.imponibile += net;
        result.pezzi += line.quantita;
        return result;
      },
      { imponibile: 0, pezzi: 0 }
    );
  }, [lines]);

  function calculateConditions(product, quantity, customer = selectedCustomer, payment = selectedPayment) {
    return calculateLineConditions({
      customer,
      product,
      payment,
      quantity,
      discountMatrix,
      specialConditions,
      paymentRules,
    });
  }

  function selectCustomer(customer) {
    const payment = {
      codice: customer.codice_pagamento || "",
      descrizione: paymentDescription(customer),
    };
    setSelectedCustomer(customer);
    setSelectedPayment(payment);
    setLines((current) =>
      current.map((line) => ({
        ...line,
        ...calculateConditions(line.prodotto_origine || line, line.quantita, customer, payment),
      }))
    );
    setCustomerSearch("");
  }

  function addProduct(product) {
    const code = normalize(product.codice_articolo || product.codice_mexal || product.codice);
    if (!code) return;

    setLines((current) => {
      const existing = current.find((line) => line.codice_articolo === code);
      if (existing) {
        const quantity = existing.quantita + 1;
        return current.map((line) =>
          line.codice_articolo === code
            ? { ...line, quantita: quantity, ...calculateConditions(product, quantity) }
            : line
        );
      }

      const description = normalize(product.descrizione || product.nome || code);
      const conditions = calculateConditions(product, 1);
      return [
        ...current,
        {
          codice_articolo: code,
          descrizione: description,
          quantita: 1,
          prezzo_unitario: conditions.prezzo_base,
          ...conditions,
          disponibilita: numberValue(product.disponibilita, 0),
          unita_misura: normalize(product.unita_misura || product.um || "PZ"),
          prodotto_origine: product,
        },
      ];
    });
    setProductSearch("");
  }

  function updateLine(code, field, value) {
    setLines((current) =>
      current.map((line) =>
        line.codice_articolo === code
          ? {
              ...line,
              ...(field === "quantita"
                ? (() => {
                    const quantity = Math.max(1, numberValue(value, 1));
                    return {
                      quantita: quantity,
                      ...calculateConditions(line.prodotto_origine || line, quantity),
                    };
                  })()
                : { [field]: Math.max(0, numberValue(value, 0)) }),
            }
          : line
      )
    );
  }

  function removeLine(code) {
    setLines((current) => current.filter((line) => line.codice_articolo !== code));
  }

  async function saveOrder({ confirm = false } = {}) {
    if (saving) return;
    if (!selectedCustomer) {
      setError("Seleziona un cliente.");
      return;
    }
    if (!lines.length) {
      setError("Inserisci almeno un prodotto.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const now = new Date();
      const orderPayload = {
        data_ordine: now.toISOString().slice(0, 10),
        mese_ordine: now.toISOString().slice(0, 7),
        stato: "bozza",
        codice_cliente: selectedCustomer.codice_cliente,
        ragione_sociale_cliente: selectedCustomer.ragione_sociale,
        codice_agente_mexal:
          selectedCustomer.codice_agente_mexal || agentCode || null,
        codice_pagamento: selectedPayment?.codice || selectedCustomer.codice_pagamento || null,
        descrizione_pagamento: selectedPayment?.descrizione || paymentDescription(selectedCustomer),
        codice_listino: selectedCustomer.codice_listino || null,
        indirizzo_spedizione: [
          selectedCustomer.indirizzo,
          selectedCustomer.cap,
          selectedCustomer.localita,
          selectedCustomer.provincia,
        ]
          .filter(Boolean)
          .join(" "),
        commenti: comments.trim() || null,
        totale: totals.imponibile,
      };

      const { data: order, error: orderError } = await supabase
        .from("ordini_testate")
        .insert(orderPayload)
        .select("id")
        .single();
      if (orderError) throw orderError;

      const noteMexal = `Workspace n. ${order.id}`;
      const linePayload = lines.map((line, index) => {
        const totale = line.quantita * numberValue(line.prezzo_netto, line.prezzo_unitario);
        return {
          ordine_id: order.id,
          codice_articolo: line.codice_articolo,
          descrizione: line.descrizione,
          quantita: line.quantita,
          quantita_disponibile: Math.min(line.quantita, Math.max(0, line.disponibilita)),
          quantita_ocm: Math.min(line.quantita, Math.max(0, line.disponibilita)),
          quantita_ocx: Math.max(0, line.quantita - Math.max(0, line.disponibilita)),
          prezzo_listino: line.prezzo_listino,
          sconto_percentuale: line.sconto_percentuale,
          sconto_commerciale: line.sconto_commerciale || null,
          sconto_pagamento: line.sconto_pagamento || null,
          origine_prezzo: line.origine_prezzo || null,
          origine_sconto: line.origine_sconto || null,
          prezzo_netto: line.prezzo_netto,
          totale_riga: totale,
        };
      });

      const { error: linesError } = await supabase
        .from("ordini_righe")
        .insert(linePayload);
      if (linesError) throw linesError;

      const { error: noteError } = await supabase
        .from("ordini_testate")
        .update({ note_mexal: noteMexal })
        .eq("id", order.id);
      if (noteError) throw noteError;

      if (confirm) {
        const { error: confirmError } = await supabase.rpc(
          "conferma_ordine_workspace",
          { p_ordine_id: order.id }
        );
        if (confirmError) throw confirmError;
      }

      navigate("/ordini/elenco", {
        replace: true,
        state: {
          message: confirm
            ? `Ordine ${order.id} confermato. Nota Mexal: ${noteMexal}`
            : `Bozza ordine ${order.id} salvata.`,
        },
      });
    } catch (saveError) {
      console.error("Errore salvataggio ordine:", saveError);
      setError(saveError.message || "Errore durante il salvataggio dell'ordine.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="orders-empty">Caricamento nuovo ordine...</div>;

  return (
    <div className="orders-page orders-new-order-page">
      <div className="orders-new-header">
        <button className="orders-secondary" type="button" onClick={() => navigate("/ordini/elenco")}>
          <ArrowLeft size={18} /> Torna agli ordini
        </button>
        <div>
          <h2>Nuovo ordine</h2>
          <p>La nota Mexal sarà generata automaticamente dopo il primo salvataggio.</p>
        </div>
      </div>

      {error && <div className="orders-alert orders-alert-error">{error}</div>}

      <section className="orders-panel orders-order-section">
        <h3>1. Cliente</h3>
        {selectedCustomer ? (
          <div className="orders-selected-customer">
            <div>
              <strong>{selectedCustomer.ragione_sociale}</strong>
              <span>{selectedCustomer.codice_cliente}</span>
            </div>
            <div>
              <span>{selectedCustomer.indirizzo || "-"}</span>
              <span>
                {[selectedCustomer.cap, selectedCustomer.localita, selectedCustomer.provincia]
                  .filter(Boolean)
                  .join(" ") || "-"}
              </span>
            </div>
            <div>
              <span>Pagamento: {paymentDescription(selectedCustomer)}</span>
              <span>Listino: {selectedCustomer.codice_listino || "-"}</span>
              <span>Categoria sconto: {selectedCustomer.categoria_sconto_cliente ?? selectedCustomer.cod_cat_sconti ?? "-"}</span>
            </div>
            <button className="orders-secondary" type="button" onClick={() => setSelectedCustomer(null)}>
              Cambia cliente
            </button>
          </div>
        ) : (
          <div className="orders-picker">
            <div className="orders-search">
              <Search size={18} />
              <input
                autoFocus
                value={customerSearch}
                onChange={(event) => setCustomerSearch(event.target.value)}
                placeholder="Cerca cliente per codice, ragione sociale, località o P. IVA..."
              />
            </div>
            <div className="orders-picker-results">
              {filteredCustomers.map((customer) => (
                <button key={customer.codice_cliente} type="button" onClick={() => selectCustomer(customer)}>
                  <strong>{customer.ragione_sociale}</strong>
                  <span>{customer.codice_cliente} · {customer.localita || "-"} ({customer.provincia || "-"})</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="orders-panel orders-order-section">
        <h3>2. Prodotti</h3>
        <div className="orders-picker">
          <div className="orders-search">
            <Search size={18} />
            <input
              value={productSearch}
              onChange={(event) => setProductSearch(event.target.value)}
              placeholder="Cerca prodotto per codice, descrizione, brand o EAN..."
            />
          </div>
          {productSearch.trim() && products.length === 0 && (
            <div className="orders-alert orders-alert-error">
              Nessun prodotto disponibile nell’archivio. Verifica la sincronizzazione prodotti.
            </div>
          )}
          {productSearch.trim() && products.length > 0 && filteredProducts.length === 0 && (
            <div className="orders-empty">Nessun prodotto trovato per “{productSearch.trim()}”.</div>
          )}
          {filteredProducts.length > 0 && (
            <div className="orders-picker-results orders-product-results">
              {filteredProducts.map((product) => {
                const code = product.codice_articolo || product.codice_mexal || product.codice;
                return (
                  <button key={code} type="button" onClick={() => addProduct(product)}>
                    <strong>{product.descrizione || product.nome || code}</strong>
                    <span>{code} · Disponibile: {product.disponibilita ?? 0} · {money(product.prezzo_listino || 0)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="orders-order-lines-wrap">
          <table className="orders-table orders-order-lines">
            <thead>
              <tr>
                <th>Codice</th><th>Prodotto</th><th>Disponibile</th><th>Quantità</th>
                <th>Prezzo base</th><th>Sconto commerciale</th><th>Sconto pagamento</th><th>Netto</th><th>Destinazione</th><th>Totale</th><th></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const lineTotal = line.quantita * numberValue(line.prezzo_netto, line.prezzo_unitario);
                const destination = line.quantita <= line.disponibilita ? "OCM" : "OCX";
                return (
                  <tr key={line.codice_articolo}>
                    <td>{line.codice_articolo}</td>
                    <td>{line.descrizione}</td>
                    <td>{line.disponibilita}</td>
                    <td>
                      <div className="orders-quantity-control">
                        <button type="button" onClick={() => updateLine(line.codice_articolo, "quantita", line.quantita - 1)}><Minus size={15} /></button>
                        <input type="number" min="1" step="1" value={line.quantita} onChange={(event) => updateLine(line.codice_articolo, "quantita", event.target.value)} />
                        <button type="button" onClick={() => updateLine(line.codice_articolo, "quantita", line.quantita + 1)}><Plus size={15} /></button>
                      </div>
                    </td>
                    <td>{money(line.prezzo_base)}</td>
                    <td>{line.sconto_commerciale || "-"}</td>
                    <td>{line.sconto_pagamento || "-"}</td>
                    <td>{money(line.prezzo_netto)}</td>
                    <td><span className={`orders-document-chip ${destination.toLowerCase()}`}>{destination}</span></td>
                    <td>{money(lineTotal)}</td>
                    <td><button className="orders-icon-danger" type="button" onClick={() => removeLine(line.codice_articolo)} title="Elimina riga"><Trash2 size={17} /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!lines.length && <div className="orders-empty"><ShoppingCart size={24} /> Cerca e aggiungi i prodotti all'ordine.</div>}
        </div>
      </section>

      <section className="orders-panel orders-order-section">
        <h3>3. Commenti per la mail</h3>
        <textarea
          className="orders-comments"
          value={comments}
          onChange={(event) => setComments(event.target.value)}
          placeholder="Questi commenti saranno salvati in Workspace e inseriti nel corpo della mail. Non saranno sincronizzati con Mexal."
          rows={5}
        />
      </section>

      <div className="orders-order-footer">
        <div className="orders-order-total">
          <span>{totals.pezzi} pezzi</span>
          <strong>{money(totals.imponibile)}</strong>
          <small>Totale imponibile provvisorio</small>
        </div>
        <div className="orders-order-actions">
          <button className="orders-secondary" type="button" disabled={saving} onClick={() => saveOrder({ confirm: false })}>
            <Save size={18} /> Salva bozza
          </button>
          <button className="orders-primary" type="button" disabled={saving} onClick={() => saveOrder({ confirm: true })}>
            <ShoppingCart size={18} /> {saving ? "Salvataggio..." : "Conferma ordine"}
          </button>
        </div>
      </div>
    </div>
  );
}
