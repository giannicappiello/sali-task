import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronUp, Info, Minus, Plus, Save, Search, ShoppingCart, Trash2 } from "lucide-react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../../lib/supabaseClient";
import useBackNavigation from "../../../hooks/useBackNavigation";
import useOrdersAccess from "./useOrdersAccess";
import { useOrdersModule } from "../ordersModuleContext";
import {
  findMexalProductByCode,
  PRODUCT_OPTION_KIND,
  productOptionKey,
  productOptionTypeLabel,
} from "../lib/productOptionIdentity";
import { calculateLineConditions } from "../services/priceEngine";
import { calculateOrderEconomics, calculateOrderLineEconomicsWithPayment } from "../services/orderEconomics";
import { checkOrderAvailability, enqueueOrderConfirmationEmail, submitOrderToMexal, updateOrder } from "../services/orderFulfillment";
import { buildAvailabilityPreview, buildAvailabilitySignature, getAvailabilityValidity, quantitiesForOrderLine } from "../services/availability";
import { buildNewOrderInsertPayload, buildWritableOrderPayload } from "../services/orderPayload";
import { ORDER_CUSTOMER_COLUMNS } from "../services/orderDataSelections";
import { loadDirectProductCatalog } from "../services/directProductCatalog";
import { isPrivateOrderModule, orderModuleFilter } from "../services/orderModules";

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

function pieces(value) {
  return Number(value || 0).toLocaleString("it-IT");
}

function numberValue(value, fallback = 0) {
  const parsed = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveInteger(...values) {
  for (const value of values) {
    const parsed = Number.parseInt(String(value ?? "").trim(), 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

function customerDiscountCategory(customer) {
  const data = customer?.dati_mexal || customer?.json_mexal || {};
  return positiveInteger(
    customer?.categoria_sconti,
    customer?.categoria_sconto_cliente,
    customer?.categoria_sconto,
    customer?.cod_cat_sconti,
    data?.categoria_sconti,
    data?.categoria_sconto_cliente,
    data?.cod_cat_sconti,
    data?.id_cat_sconto
  );
}

function productDiscountCategory(product) {
  const data = product?.dati_mexal || product?.json_mexal || {};
  return positiveInteger(
    product?.categoria_sconto,
    product?.categoria_sconto_articolo,
    product?.id_cat_sconto,
    product?.cod_cat_sconto,
    data?.categoria_sconto,
    data?.categoria_sconto_articolo,
    data?.id_cat_sconto,
    data?.cod_cat_sconto
  );
}


function paymentDescription(customer, paymentRules = []) {
  const data = customer?.dati_mexal || customer?.json_mexal || {};
  return (
    data?._descrizione_pagamento ||
    data?.descrizione_pagamento ||
    data?.des_pagamento ||
    data?.pagamento_descrizione ||
    paymentRules.find((rule) => String(rule.codice_pagamento || "") === String(customer?.codice_pagamento || ""))?.descrizione ||
    customer?.codice_pagamento ||
    "-"
  );
}

function conditionLabel(line) {
  if (line.origine_prezzo === "particolarita-prezzo") return "Prezzo speciale";
  if (line.origine_sconto === "particolarita-sconto") return `Particolarità ${line.sconto_commerciale || ""}`.trim();
  if (line.origine_sconto === "matrice-sconti") return `Matrice ${line.sconto_commerciale || ""}`.trim();
  return "Nessuna condizione";
}

function conditionClass(line) {
  if (line.origine_prezzo === "particolarita-prezzo") return "is-price";
  if (line.origine_sconto === "particolarita-sconto") return "is-special";
  if (line.origine_sconto === "matrice-sconti") return "is-matrix";
  return "is-none";
}

async function loadPaged(table, buildQuery, columns = "*") {
  const rows = [];
  let from = 0;

  while (true) {
    const query = buildQuery(
      supabase.from(table).select(columns).range(from, from + PAGE_SIZE - 1)
    );
    const { data, error } = await query;
    if (error) throw error;
    const page = data || [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
    from += PAGE_SIZE;
  }
}

async function loadPagedRpc(rpcName, buildQuery, columns = "*") {
  const rows = [];
  let from = 0;

  while (true) {
    const query = buildQuery(
      supabase.rpc(rpcName).select(columns).range(from, from + PAGE_SIZE - 1)
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
  const { moduleCode, basePath } = useOrdersModule();
  const navigate = useNavigate();
  const goBack = useBackNavigation(`${basePath}/elenco`);
  const location = useLocation();
  const { orderId: editingOrderId } = useParams();
  const requestedReservation = new URLSearchParams(location.search).get("tipo") === "prenotazione";
  const {
    loading: accessLoading,
    canAccessOrders,
    canWriteOrders,
    canSeeAll,
    visibleAgents,
    agentCode,
  } = useOrdersAccess(moduleCode);

  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [discountMatrix, setDiscountMatrix] = useState([]);
  const [specialConditions, setSpecialConditions] = useState([]);
  const [paymentRules, setPaymentRules] = useState([]);
  const [selectedPayment, setSelectedPayment] = useState(null);
  const [customerSearch, setCustomerSearch] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [customerResultIndex, setCustomerResultIndex] = useState(0);
  const [productResultIndex, setProductResultIndex] = useState(0);
  const [pendingProduct, setPendingProduct] = useState(null);
  const [pendingQuantity, setPendingQuantity] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [lines, setLines] = useState([]);
  const [comments, setComments] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [expandedLine, setExpandedLine] = useState("");
  const [availability, setAvailability] = useState(null);
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [availabilityInvalidated, setAvailabilityInvalidated] = useState(false);
  const [existingOrderType, setExistingOrderType] = useState("");
  const isReservation = !isPrivateOrderModule(moduleCode) && (editingOrderId ? existingOrderType === "prenotazione" : requestedReservation);
  const privateOrder = isPrivateOrderModule(moduleCode);
  const skipAvailability = moduleCode === "ph" || privateOrder;
  const availabilityRequestId = useRef(0);
  const productSearchRef = useRef(null);
  const productQuantityRef = useRef(null);
  const customerResultRefs = useRef([]);
  const productResultRefs = useRef([]);
  const aiDraftAppliedRef = useRef(false);

  function invalidateAvailability() {
    availabilityRequestId.current += 1;
    if (availability) setAvailabilityInvalidated(true);
    setAvailability(null);
  }

  useEffect(() => {
    if (!accessLoading) loadData();
  }, [accessLoading, canAccessOrders, canWriteOrders, canSeeAll, JSON.stringify(visibleAgents)]);

  useEffect(() => {
    if (!editingOrderId || !customers.length) return;
    let active = true;
    (async () => {
      const [{ data: existing, error: orderError }, { data: existingLines, error: linesError }, { data: docs, error: docsError }] = await Promise.all([
        supabase.from("ordini_testate").select("*").eq("id", editingOrderId).or(orderModuleFilter(moduleCode)).single(),
        supabase.from("ordini_righe").select("*").eq("ordine_id", editingOrderId).order("id"),
        supabase.from("ordini_documenti_mexal").select("numero").eq("ordine_id", editingOrderId).not("numero", "is", null),
      ]);
      if (orderError || linesError || docsError) { if (active) setError((orderError || linesError || docsError).message); return; }
      const isDraft = String(existing.stato || "").toLowerCase() === "bozza";
      if (!isDraft && (existing.numero_ocm || existing.numero_ocx || existing.numero_oci || existing.numero_oct || docs?.length || !["non_avviato", "non_inviato", "errore", "annullato", "arrestato"].includes(existing.stato_sincronizzazione || "non_inviato"))) { if (active) setError("Questo ordine non è più modificabile."); return; }
      if (!active) return;
      setSelectedCustomer(customers.find((customer) => customer.codice_cliente === existing.codice_cliente) || { codice_cliente: existing.codice_cliente, ragione_sociale: existing.ragione_sociale_cliente });
      setExistingOrderType(existing.tipo_ordine || "standard");
      setSelectedPayment({ codice: existing.codice_pagamento || "", descrizione: existing.descrizione_pagamento || "" }); setComments(existing.commenti || "");
      setLines((existingLines || []).map((line) => withEconomics({ ...line, prodotto_origine: findMexalProductByCode(products, line.codice_articolo) || line })));
    })();
    return () => { active = false; };
  }, [editingOrderId, customers, products]);

  useEffect(() => {
    const draft = location.state?.aiDraft;
    if (!draft || editingOrderId || loading || aiDraftAppliedRef.current || !customers.length || !products.length) return;
    aiDraftAppliedRef.current = true;
    const customer = customers.find((item) => normalize(item.codice_cliente) === normalize(draft.customerCode));
    const payment = customer ? { codice: customer.codice_pagamento || "", descrizione: paymentDescription(customer, paymentRules) } : null;
    const importedLines = (draft.lines || []).flatMap((item) => {
      const product = findMexalProductByCode(products, item.productCode);
      if (!product) return [];
      const quantity = Math.max(0.01, numberValue(item.quantity, 1));
      const code = normalize(product.codice_articolo || product.codice_mexal || product.codice);
      const conditions = calculateConditions(product, quantity, customer || null, payment);
      return [{
        codice_articolo: code,
        descrizione: normalize(product.descrizione || product.nome || code),
        quantita: quantity,
        prezzo_unitario: conditions.prezzo_base,
        ...withEconomics({ ...conditions, quantita: quantity, prodotto_origine: product }),
        disponibilita: numberValue(product.disponibilita, 0),
        unita_misura: normalize(product.unita_misura || product.um || "PZ"),
        prodotto_origine: product,
      }];
    });
    requestAnimationFrame(() => {
      if (customer) {
        setSelectedCustomer(customer);
        setSelectedPayment(payment);
      }
      setLines(importedLines);
      setComments(String(draft.comments || ""));
      if (!customer || importedLines.length < (draft.lines || []).length) {
        setError("Bozza AI caricata: completa gli abbinamenti mancanti prima di salvare.");
      }
    });
  }, [location.state, editingOrderId, loading, customers, products, discountMatrix, specialConditions, paymentRules]);

  async function loadData() {
    setLoading(true);
    setError("");

    try {
      if (!canAccessOrders) throw new Error("Accesso al modulo Ordini non autorizzato.");
      if (!canWriteOrders) throw new Error("Il ruolo consente soltanto la consultazione del modulo Ordini.");
      if (!canSeeAll && !visibleAgents?.length) {
        throw new Error("Nessun codice agente Mexal associato all'utente.");
      }

      const customerRows = canSeeAll
        ? await loadPaged("ordini_clienti_cache", (query) => query
          .eq("attivo_mexal", true)
          .order("ragione_sociale", { ascending: true })
          .order("codice_cliente", { ascending: true }), ORDER_CUSTOMER_COLUMNS)
        : await loadPagedRpc("visible_mexal_clients_for_me", (query) => query
          .order("ragione_sociale", { ascending: true })
          .order("codice_cliente", { ascending: true }), ORDER_CUSTOMER_COLUMNS);

      const directCatalog = await loadDirectProductCatalog(supabase, { includeEconomics: true });
      let productRows = directCatalog.products;
      const kitRows = directCatalog.implants;
      const productByCode = new Map(productRows.map((product) => [normalize(product.codice_articolo || product.codice_mexal || product.codice), product]));
      const kits = (kitRows || []).map((kit) => ({
        ...kit,
        is_impianto: true,
        option_kind: PRODUCT_OPTION_KIND.LOCAL_IMPLANT,
        codice_articolo: kit.codice,
        descrizione: kit.descrizione,
        componenti: (kit.componenti || []).map((component) => ({
          ...component,
          prodotto: productByCode.get(normalize(component.codice_articolo)),
        })).filter((component) => component.prodotto),
        prezzo_listino: (kit.componenti || []).reduce((sum, component) => {
          const product = productByCode.get(normalize(component.codice_articolo));
          return sum + numberValue(component.quantita) * numberValue(product?.prezzo_listino);
        }, 0),
      }));
      productRows = [
        ...kits,
        ...productRows.map((product) => ({ ...product, option_kind: PRODUCT_OPTION_KIND.MEXAL })),
      ];

      const [matrixRows, particularityRows, paymentRows] = await Promise.all([
        loadPaged("ordini_sconti_listini", (query) => query.eq("is_active", true)),
        loadPaged("ordini_particolarita", (query) => query.eq("is_active", true)),
        loadPaged("ordini_regole_pagamento", (query) => query.eq("is_active", true)),
      ]);

      setCustomers(customerRows);
      setProducts(productRows);
      setDiscountMatrix(matrixRows);
      setSpecialConditions(particularityRows);
      setPaymentRules(paymentRows);

      const unavailable = [];
      if (customerRows.length === 0) unavailable.push("clienti");
      if (productRows.length === 0) unavailable.push("prodotti e giacenze");
      if (unavailable.length) {
        setError(`I dati Mexal non sono disponibili (${unavailable.join(", ")}). Eseguire la sincronizzazione dal pannello Integrazioni.`);
      } else if (matrixRows.length === 0) {
        setError("La matrice sconti è vuota per l’utente collegato. Eseguire la sincronizzazione dal pannello Integrazioni.");
      }
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
          product.is_impianto ? "impianto" : "",
        ].some((value) => String(value ?? "").toLowerCase().includes(query))
      )
      .slice(0, 60);
  }, [products, productSearch]);

  const economics = useMemo(() => calculateOrderEconomics(lines), [lines]);
  const totals = useMemo(() => ({
    ...economics,
    pezzi: lines.reduce((sum, line) => sum + numberValue(line.quantita), 0),
  }), [economics, lines]);

  function withEconomics(line) {
    const product = line.prodotto_origine || line;
    return calculateOrderLineEconomicsWithPayment({
      ...line,
      quantita: line.quantita,
      // Mexal receives the list price and the commercial discount chain. The
      // UI only presents snapshots generated by this shared engine.
      prezzo_listino: line.prezzo_base ?? line.prezzo_listino,
      // VAT is a product-cache attribute. Never infer it from a stale raw
      // Mexal blob or from an order-line fallback.
      codice_iva_mexal: product.codice_iva_mexal || null,
      aliquota_iva: product.aliquota_iva,
    });
  }


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
    invalidateAvailability();
    const payment = {
      codice: customer.codice_pagamento || "",
      descrizione: paymentDescription(customer, paymentRules),
    };
    setSelectedCustomer(customer);
    setSelectedPayment(payment);
    setLines((current) =>
      current.map((line) => ({
        ...line,
        ...withEconomics({ ...line, ...calculateConditions(line.prodotto_origine || line, line.quantita, customer, payment) }),
      }))
    );
    setCustomerSearch("");
  }

  function moveResultSelection(type, direction, results) {
    if (!results.length) return;
    const setter = type === "customer" ? setCustomerResultIndex : setProductResultIndex;
    const refs = type === "customer" ? customerResultRefs : productResultRefs;
    setter((current) => {
      const next = Math.min(results.length - 1, Math.max(0, current + direction));
      requestAnimationFrame(() => refs.current[next]?.scrollIntoView({ block: "nearest" }));
      return next;
    });
  }

  function addProduct(product, requestedQuantity = 1) {
    if (product.is_impianto) {
      addKit(product, requestedQuantity);
      return;
    }
    const code = normalize(product.codice_articolo || product.codice_mexal || product.codice);
    if (!code) return;
    const addedQuantity = Math.max(1, numberValue(requestedQuantity, 1));

    invalidateAvailability();
    setLines((current) => {
      const existing = current.find((line) => line.codice_articolo === code);
      if (existing) {
        const quantity = existing.quantita + addedQuantity;
        return current.map((line) =>
          line.codice_articolo === code
            ? withEconomics({ ...line, quantita: quantity, ...calculateConditions(product, quantity) })
            : line
        );
      }

      const description = normalize(product.descrizione || product.nome || code);
      const conditions = calculateConditions(product, addedQuantity);
      return [
        {
          codice_articolo: code,
          descrizione: description,
          quantita: addedQuantity,
          prezzo_unitario: conditions.prezzo_base,
          ...withEconomics({ ...conditions, quantita: addedQuantity, prodotto_origine: product }),
          disponibilita: numberValue(product.disponibilita, 0),
          unita_misura: normalize(product.unita_misura || product.um || "PZ"),
          prodotto_origine: product,
        },
        ...current,
      ];
    });
    setProductSearch("");
  }

  function addKit(kit, requestedQuantity = 1) {
    const kitQuantity = Math.max(1, numberValue(requestedQuantity, 1));
    const grossKitTotal = kit.componenti.reduce((sum, component) => sum + numberValue(component.quantita) * numberValue(component.prodotto?.prezzo_listino), 0);
    invalidateAvailability();
    setLines((current) => {
      let next = [...current];
      for (const component of kit.componenti) {
        const product = component.prodotto;
        const code = normalize(product.codice_articolo || product.codice_mexal || product.codice);
        const addedQuantity = numberValue(component.quantita) * kitQuantity;
        let conditions = calculateConditions(product, addedQuantity);
        if (kit.modalita_prezzo === "prezzo_fisso") {
          const allocatedUnitPrice = grossKitTotal > 0 ? numberValue(kit.prezzo_fisso) * numberValue(product.prezzo_listino) / grossKitTotal : 0;
          conditions = {
            ...conditions,
            prezzo_base: allocatedUnitPrice,
            prezzo_listino: allocatedUnitPrice,
            sconto_commerciale: "",
            sconto_pagamento: "",
            origine_prezzo: "impianto-prezzo-fisso",
            origine_sconto: "impianto-prezzo-fisso",
            dettaglio_calcolo: { ...(conditions.dettaglio_calcolo || {}), sconto_commerciale: "", sconto_pagamento: "", impianto_prezzo_fisso: numberValue(kit.prezzo_fisso) },
          };
        } else if (kit.modalita_prezzo === "sconto_personalizzato") {
          const discount = String(numberValue(kit.sconto_personalizzato));
          conditions = {
            ...conditions,
            sconto_commerciale: discount,
            origine_sconto: "impianto-sconto-personalizzato",
            dettaglio_calcolo: { ...(conditions.dettaglio_calcolo || {}), sconto_commerciale: discount },
          };
        }
        const kitDetail = {
          ...(conditions.dettaglio_calcolo || {}),
          impianto: { id: kit.id, codice: kit.codice, descrizione: kit.descrizione, quantita: kitQuantity, modalita_prezzo: kit.modalita_prezzo },
        };
        const existing = next.find((line) => line.codice_articolo === code);
        if (existing) {
          const quantity = numberValue(existing.quantita) + addedQuantity;
          next = next.map((line) => line.codice_articolo === code
            ? withEconomics({ ...line, ...conditions, quantita: quantity, dettaglio_calcolo: kitDetail, prodotto_origine: product })
            : line);
        } else {
          next.unshift({
            codice_articolo: code,
            descrizione: normalize(product.descrizione || product.nome || code),
            quantita: addedQuantity,
            prezzo_unitario: conditions.prezzo_base,
            ...withEconomics({ ...conditions, quantita: addedQuantity, dettaglio_calcolo: kitDetail, prodotto_origine: product }),
            disponibilita: numberValue(product.disponibilita, 0),
            unita_misura: normalize(product.unita_misura || product.um || "PZ"),
            prodotto_origine: product,
          });
        }
      }
      return next;
    });
    setProductSearch("");
  }

  function focusProductSearch() {
    requestAnimationFrame(() => productSearchRef.current?.focus());
  }

  async function chooseProduct(product) {
    if (!product) return;
    if (window.matchMedia("(max-width: 1000px)").matches) {
      const description = product.descrizione || product.nome || product.codice_articolo || product.codice_mexal || product.codice;
      const value = await window.workspacePrompt?.(`Inserisci la quantità per ${description}`, "", { title: "Quantità prodotto", confirmLabel: "Aggiungi", inputType: "number", inputMode: "decimal", min: "1", step: "1" });
      if (value === null || value === undefined) return;
      const quantity = Number(String(value).replace(",", "."));
      if (!Number.isFinite(quantity) || quantity <= 0) {
        await window.workspaceAlert?.("Inserisci una quantità valida maggiore di zero.");
        return;
      }
      addProduct(product, quantity);
      focusProductSearch();
      return;
    }
    setPendingProduct(product);
    setPendingQuantity("1");
    setProductSearch("");
    requestAnimationFrame(() => {
      productQuantityRef.current?.focus();
      productQuantityRef.current?.select();
    });
  }

  function confirmPendingProduct() {
    if (!pendingProduct) return;
    const quantity = Number(String(pendingQuantity).replace(",", "."));
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setError("Inserisci una quantità valida maggiore di zero.");
      productQuantityRef.current?.focus();
      return;
    }
    addProduct(pendingProduct, quantity);
    setPendingProduct(null);
    setPendingQuantity("");
    setError("");
    focusProductSearch();
  }

  function updateLine(code, field, value) {
    invalidateAvailability();
    setLines((current) =>
      current.map((line) =>
        line.codice_articolo === code
          ? {
              ...line,
              ...(field === "quantita"
                ? (() => {
                    const quantity = Math.max(1, numberValue(value, 1));
                    return {
                      ...withEconomics({ ...line, quantita: quantity, ...calculateConditions(line.prodotto_origine || line, quantity) }),
                    };
                  })()
                : { [field]: Math.max(0, numberValue(value, 0)) }),
            }
          : line
      )
    );
  }

  function removeLine(code) {
    invalidateAvailability();
    setLines((current) => current.filter((line) => line.codice_articolo !== code));
  }

  const canCheckAvailability = lines.length > 0 && lines.every((line) => normalize(line.codice_articolo) && numberValue(line.quantita) > 0) && !checkingAvailability;
  const productsMissingVat = useMemo(() => lines.filter((line) => !normalize(line.codice_iva_mexal) || !Number.isFinite(Number(line.aliquota_iva))), [lines]);
  const availabilityValidity = useMemo(() => getAvailabilityValidity({ availability, lines, customer: selectedCustomer, invalidated: availabilityInvalidated, reservation: isReservation, skipAvailability }), [availability, lines, selectedCustomer, availabilityInvalidated, isReservation, skipAvailability]);
  const availabilityPreview = useMemo(() => buildAvailabilityPreview(lines, availability?.lines, { reservation: isReservation, skipAvailability }), [lines, availability, isReservation, skipAvailability]);
  const documentPreviewTotals = useMemo(() => ({
    ocm: availabilityPreview.ocm.reduce((sum, item) => sum + numberValue(item.quantity), 0),
    oci: availabilityPreview.oci.reduce((sum, item) => sum + numberValue(item.quantity), 0),
    ocx: availabilityPreview.ocx.reduce((sum, item) => sum + numberValue(item.quantity), 0),
  }), [availabilityPreview]);

  async function verifyAvailability() {
    if (!canCheckAvailability) return;
    setCheckingAvailability(true);
    setError("");
    const requestId = ++availabilityRequestId.current;
    try {
      const result = await checkOrderAvailability(lines);
      // Ignore a late response for a previous cart or a superseded request.
      if (requestId !== availabilityRequestId.current) return;
      const resultSignature = buildAvailabilitySignature({ lines, customer: selectedCustomer, warehouse: result.warehouse });
      setAvailability({ ...result, signature: resultSignature, checkedAt: result.checkedAt });
      setAvailabilityInvalidated(false);
    } catch (checkError) {
      setError(checkError.message || "Errore durante la verifica disponibilità.");
    } finally {
      setCheckingAvailability(false);
    }
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
    if (confirm && !availabilityValidity.valid) {
      setError("Verifica nuovamente le disponibilità prima di confermare l’ordine.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const now = new Date();
      const orderPayload = buildNewOrderInsertPayload({
        dataOrdine: now.toISOString().slice(0, 10),
        customer: selectedCustomer,
        agentCode,
        payment: selectedPayment,
        paymentDescription,
        comments,
        total: totals.totale_documento,
        taxableTotal: totals.totale_imponibile,
        vatTotal: totals.totale_iva,
        orderType: isReservation ? "prenotazione" : "standard",
      });

      let order;
      if (editingOrderId) {
        order = { id: editingOrderId };
      } else {
        const { data, error: orderError } = await supabase.from("ordini_testate").insert({ ...orderPayload, modulo_ordini: moduleCode }).select("id,numero_ordine_visualizzato").single();
        if (orderError) throw orderError; order = data;
      }

      // The database trigger has allocated the human number atomically. Do not
      // overwrite it with the UUID when saving the order's Mexal note.
      const noteMexal = `Workspace n. ${order.numero_ordine_visualizzato || order.id}`;
      const linePayload = lines.map((line) => {
        const quantities = privateOrder
          ? { quantita_disponibile: 0, quantita_ocm: 0, quantita_ocx: 0, quantita_oci: 0 }
          : quantitiesForOrderLine(line, availability, confirm, { reservation: isReservation, skipAvailability });
        return {
          ordine_id: order.id,
          codice_articolo: line.codice_articolo,
          descrizione: line.descrizione,
          quantita: line.quantita,
          ...(editingOrderId && !confirm
            ? { quantita_ocm: 0, quantita_ocx: 0, quantita_oci: 0 }
            : quantities),
          prezzo_listino: line.prezzo_listino,
          codice_iva_mexal: line.codice_iva_mexal || null,
          aliquota_iva: line.aliquota_iva,
          imponibile_riga: line.imponibile_riga,
          iva_riga: line.iva_riga,
          sconto_percentuale: line.sconto_percentuale,
          sconto_commerciale: line.sconto_commerciale || null,
          sconto_pagamento: line.sconto_pagamento || null,
          origine_prezzo: line.origine_prezzo || null,
          origine_sconto: line.origine_sconto || null,
          regola_prezzo_id: line.regola_prezzo_id || null,
          regola_sconto_id: line.regola_sconto_id || null,
          regola_pagamento_id: line.regola_pagamento_id || null,
          dettaglio_calcolo: line.dettaglio_calcolo || {},
          prezzo_netto: line.prezzo_netto,
          totale_riga: line.totale_riga,
        };
      });

      if (editingOrderId) {
        await updateOrder(order.id, { ...orderPayload, note_mexal: noteMexal }, linePayload);
      } else {
        const { error: linesError } = await supabase.from("ordini_righe").insert(linePayload);
        if (linesError) throw linesError;
        const { error: noteError } = await supabase.from("ordini_testate").update(buildWritableOrderPayload({ note_mexal: noteMexal })).eq("id", order.id);
        if (noteError) throw noteError;
      }

      let mexalMessage = "";
      if (confirm) {
        const { error: confirmError } = await supabase.rpc(
          "conferma_ordine_workspace",
          { p_ordine_id: order.id }
        );
        if (confirmError) throw confirmError;

        try {
          await enqueueOrderConfirmationEmail(order.id, moduleCode);
        } catch (emailQueueError) {
          console.error("Accodamento email conferma ordine non riuscito:", emailQueueError);
          mexalMessage = ` Email non accodata: ${emailQueueError.message}.`;
        }

        // Per PR e Private l'invio parte subito in produzione. PH resta interno
        // al Workspace e non avvia mai una sincronizzazione Mexal.
        const { data: moduleConfig, error: moduleConfigError } = await supabase.from("ordini_moduli_configurazione").select("invia_automaticamente_mexal").eq("modulo_ordini", moduleCode).maybeSingle();
        if (moduleConfigError) throw moduleConfigError;
        if (moduleCode === "ph") {
          mexalMessage += " Ordine PH confermato senza invio a Mexal.";
        } else if (moduleConfig?.invia_automaticamente_mexal !== false && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
          try {
            const syncResult = await submitOrderToMexal(order.id, moduleCode);
            mexalMessage += privateOrder
              ? ` OCT: ${syncResult.numero_oct || "-"}.`
              : ` OCM: ${syncResult.numero_ocm || "-"} · OCX: ${syncResult.numero_ocx || "-"} · OCI: ${syncResult.numero_oci || "-"}.`;
          } catch (syncError) {
            mexalMessage += ` Ordine salvato, ma invio Mexal non riuscito: ${syncError.message}`;
          }
        } else {
          mexalMessage += " In locale l'invio Mexal è disponibile dopo il deploy Vercel dalla pagina dettaglio.";
        }
      }

      navigate(confirm || editingOrderId ? `${basePath}/elenco/${order.id}` : `${basePath}/elenco`, {
        replace: true,
        state: {
          message: confirm
            ? `Ordine ${order.id} confermato.${mexalMessage}`
            : editingOrderId ? `Ordine ${order.id} modificato. Verifica nuovamente le disponibilità prima dell'invio.` : `Bozza ordine ${order.id} salvata.`,
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
        <button className="orders-secondary" type="button" onClick={goBack}>
          <ArrowLeft size={18} /> Torna agli ordini
        </button>
        <div>
          <h2>{editingOrderId ? `Modifica ${privateOrder ? "OCT" : "ordine"}` : privateOrder ? "Nuovo OCT" : isReservation ? "Nuovo ordine prenotazione" : "Nuovo ordine"}</h2>
          {editingOrderId && <p>Le ripartizioni saranno ricalcolate dopo una nuova verifica disponibilità.</p>}
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
              <span>Pagamento: {paymentDescription(selectedCustomer, paymentRules)}</span>
              <span>Listino: {selectedCustomer.codice_listino || "-"}</span>
              <span>Categoria sconto: {customerDiscountCategory(selectedCustomer) || "-"}</span>
            </div>
            <button className="orders-secondary" type="button" disabled={checkingAvailability} onClick={() => { invalidateAvailability(); setSelectedCustomer(null); }}>
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
                disabled={checkingAvailability}
                onChange={(event) => { setCustomerSearch(event.target.value); setCustomerResultIndex(0); }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") { event.preventDefault(); moveResultSelection("customer", 1, filteredCustomers); }
                  else if (event.key === "ArrowUp") { event.preventDefault(); moveResultSelection("customer", -1, filteredCustomers); }
                  else if (event.key === "Enter" && filteredCustomers[customerResultIndex]) { event.preventDefault(); selectCustomer(filteredCustomers[customerResultIndex]); }
                }}
                placeholder="Cerca cliente per codice, ragione sociale, località o P. IVA..."
              />
            </div>
            <div className="orders-picker-results">
              {filteredCustomers.map((customer, index) => (
                <button ref={(node) => { customerResultRefs.current[index] = node; }} className={index === customerResultIndex ? "is-keyboard-active" : ""} aria-selected={index === customerResultIndex} key={customer.codice_cliente} type="button" disabled={checkingAvailability} onMouseEnter={() => setCustomerResultIndex(index)} onClick={() => selectCustomer(customer)}>
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
        <div className="orders-product-entry">
        <div className="orders-picker">
          <div className="orders-search">
            <Search size={18} />
            <input
              ref={productSearchRef}
              value={productSearch}
              disabled={checkingAvailability}
              onChange={(event) => { setProductSearch(event.target.value); setProductResultIndex(0); setPendingProduct(null); setPendingQuantity(""); }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") { event.preventDefault(); moveResultSelection("product", 1, filteredProducts); }
                else if (event.key === "ArrowUp") { event.preventDefault(); moveResultSelection("product", -1, filteredProducts); }
                else if ((event.key === "Enter" || event.key === "Tab") && filteredProducts[productResultIndex]) {
                  event.preventDefault();
                  void chooseProduct(filteredProducts[productResultIndex]);
                }
              }}
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
              {filteredProducts.map((product, index) => {
                const code = product.codice_articolo || product.codice_mexal || product.codice;
                return (
                  <button ref={(node) => { productResultRefs.current[index] = node; }} className={index === productResultIndex ? "is-keyboard-active" : ""} aria-selected={index === productResultIndex} key={productOptionKey(product)} type="button" disabled={checkingAvailability} onMouseEnter={() => setProductResultIndex(index)} onClick={() => void chooseProduct(product)} onKeyDown={(event) => { if (event.key === "Tab") { event.preventDefault(); void chooseProduct(product); } }}>
                    <strong>{productOptionTypeLabel(product)} · {product.descrizione || product.nome || code}</strong>
                    <span>{code} · Entità: {productOptionTypeLabel(product).toLowerCase()} · Cat. sconto: {productDiscountCategory(product) || "-"} · {money(product.prezzo_listino || 0)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <label className="orders-product-quick-quantity">
          <span>Quantità{pendingProduct ? ` · ${normalize(pendingProduct.codice_articolo || pendingProduct.codice_mexal || pendingProduct.codice)}` : ""}</span>
          <input
            ref={productQuantityRef}
            type="number"
            min="1"
            step="1"
            value={pendingQuantity}
            disabled={!pendingProduct || checkingAvailability}
            onChange={(event) => setPendingQuantity(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === "Tab") {
                event.preventDefault();
                confirmPendingProduct();
              }
            }}
          />
        </label>
        </div>

        <div className="orders-order-lines-wrap">
          <table className="orders-table orders-order-lines">
            <thead>
              <tr>
                <th>Codice</th><th>Prodotto</th><th>Quantità</th>
                <th>Listino</th><th>Sconto commerciale</th><th>Netto</th><th>Imponibile</th><th>IVA</th><th>Totale</th><th></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const lineTotal = line.totale_riga;
                return (
                  <Fragment key={line.codice_articolo}>
                    <tr>
                      <td>{line.codice_articolo}</td>
                      <td>
                        <div>{line.descrizione}</div>
                        {line.dettaglio_calcolo?.impianto && <small className="orders-kit-line">Impianto {line.dettaglio_calcolo.impianto.codice} · {line.dettaglio_calcolo.impianto.descrizione}</small>}
                        <small>Categoria sconto articolo: {line.dettaglio_calcolo?.categoria_sconto_articolo || productDiscountCategory(line.prodotto_origine) || "-"}</small>
                      </td>
                      <td>
                        <div className="orders-quantity-control">
                          <button type="button" disabled={checkingAvailability} onClick={() => updateLine(line.codice_articolo, "quantita", line.quantita - 1)}><Minus size={15} /></button>
                          <input type="number" min="1" step="1" disabled={checkingAvailability} value={line.quantita} onChange={(event) => updateLine(line.codice_articolo, "quantita", event.target.value)} />
                          <button type="button" disabled={checkingAvailability} onClick={() => updateLine(line.codice_articolo, "quantita", line.quantita + 1)}><Plus size={15} /></button>
                        </div>
                      </td>
                      <td>{money(line.prezzo_listino)}</td>
                      <td>
                        <button
                          className={`orders-condition-chip ${conditionClass(line)}`}
                          type="button"
                          onClick={() => setExpandedLine((current) => current === line.codice_articolo ? "" : line.codice_articolo)}
                          title="Mostra il dettaglio del calcolo"
                        >
                          <Info size={14} />
                          {conditionLabel(line)}
                          {expandedLine === line.codice_articolo ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                        <small className="orders-line-discount">{line.sconto_commerciale || "-"}</small>
                      </td>
                      <td>{money(line.prezzo_netto)}</td>
                      <td>{money(line.imponibile_riga)}</td>
                      <td>{productsMissingVat.some((item) => item.codice_articolo === line.codice_articolo) ? <span className="orders-vat-missing">IVA mancante</span> : <>{money(line.iva_riga)} <small>({line.aliquota_iva}%)</small></>}</td>
                      <td>{money(lineTotal)}</td>
                      <td><button className="orders-icon-danger" type="button" disabled={checkingAvailability} onClick={() => removeLine(line.codice_articolo)} title="Elimina riga"><Trash2 size={17} /></button></td>
                    </tr>
                    {expandedLine === line.codice_articolo && (
                      <tr className="orders-calculation-row" key={`${line.codice_articolo}-detail`}>
                        <td colSpan="10">
                          <div className="orders-calculation-detail">
                            <div><span>Listino cliente</span><strong>{line.dettaglio_calcolo?.codice_listino || "-"}</strong></div>
                            <div><span>Prezzo listino</span><strong>{money(line.prezzo_listino)}</strong></div>
                            <div><span>Categoria cliente</span><strong>{line.dettaglio_calcolo?.categoria_sconto_cliente || "-"}</strong></div>
                            <div><span>Categoria articolo</span><strong>{line.dettaglio_calcolo?.categoria_sconto_articolo || "-"}</strong></div>
                            <div><span>Regola applicata</span><strong>{conditionLabel(line)}</strong></div>
                            <div><span>Sconto pagamento</span><strong>{line.sconto_pagamento || "-"}</strong></div>
                            <div><span>Prezzo netto</span><strong>{money(line.prezzo_netto)}</strong></div>
                          </div>
                          {line.origine_prezzo === "particolarita-prezzo" && (
                            <p className="orders-calculation-note">Il prezzo speciale sostituisce il listino e non applica la matrice sconti. Lo sconto pagamento resta applicabile.</p>
                          )}
                          {line.origine_sconto === "particolarita-sconto" && (
                            <p className="orders-calculation-note">La particolarità sconto ha priorità sulla matrice sconti.</p>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {!lines.length && <div className="orders-empty"><ShoppingCart size={24} /> Cerca e aggiungi i prodotti all'ordine.</div>}
        </div>
      </section>

      <section className="orders-panel orders-order-section">
        <h3>3. Commenti</h3>
        <textarea
          className="orders-comments"
          value={comments}
          disabled={checkingAvailability}
          onChange={(event) => setComments(event.target.value)}
          placeholder="Inserisci eventuali commenti."
          rows={5}
        />
      </section>

      {!isReservation && !skipAvailability && <section className="orders-panel orders-order-section">
        <h3>4. Disponibilità Mexal</h3>
        {availabilityInvalidated && <div className="orders-alert">Le disponibilità devono essere verificate nuovamente.</div>}
        <button className="orders-primary" type="button" disabled={!canCheckAvailability} onClick={verifyAvailability}>
          {checkingAvailability ? "Verifica disponibilità…" : "VERIFICA DISPONIBILITÀ"}
        </button>
        {availability && (
          <div className="orders-availability-results orders-availability-summary">
            <div className="orders-availability-check">
              <strong>✓ Verifica completata</strong>
              <span>{new Date(availability.checkedAt).toLocaleString("it-IT")}</span>
              <span>Magazzino {availability.warehouse}</span>
              <span className="orders-availability-errors">Errori: {availability.summary.errorLines}</span>
            </div>

            <div className="orders-document-preview">
              <div><span>Futuro OCM</span><strong>{pieces(documentPreviewTotals.ocm)} pezzi</strong></div>
              <div><span>Futuro OCI</span><strong>{pieces(documentPreviewTotals.oci)} pezzi</strong></div>
              <div><span>Futuro OCX</span><strong>{pieces(documentPreviewTotals.ocx)} pezzi</strong><OcxProductSummary items={availabilityPreview.ocx} /></div>
            </div>
          </div>
        )}
      </section>}
      {isReservation && !privateOrder && <section className="orders-panel orders-order-section"><h3>4. Ordine prenotazione</h3><div className="orders-alert">Gli articoli saranno inseriti in OCI senza verifica delle giacenze Mexal. Gli articoli IMP saranno inseriti sempre in OCM.</div></section>}

      <div className="orders-order-footer">
        <div className="orders-order-total orders-order-total-enhanced">
          <div><span>Totale ordine</span><strong>{pieces(totals.pezzi)} pezzi</strong></div>
          <div><span>Imponibile</span><strong>{money(totals.totale_imponibile)}</strong></div>
          <div><span>IVA</span><strong>{money(totals.totale_iva)}</strong></div>
          <div className="orders-order-grand-total"><span>TOTALE</span><strong>{money(totals.totale_documento)}</strong></div>
        </div>
        <div className="orders-order-actions">
          {(availability || isReservation || skipAvailability) && (
            <div className="orders-split-summary">
              {privateOrder ? <><strong>Il modulo creerà un unico OCT:</strong><span>OCT: {pieces(totals.pezzi)} pezzi</span></> : <>
                <strong>L'ordine verrà suddiviso automaticamente in:</strong>
                <span>OCM: {pieces(documentPreviewTotals.ocm)} pezzi (evasione immediata)</span>
                <span>OCI: {pieces(documentPreviewTotals.oci)} pezzi</span>
                <span>OCX: {pieces(documentPreviewTotals.ocx)} pezzi (backorder)</span>
                <OcxProductSummary items={availabilityPreview.ocx} compact />
              </>}
            </div>
          )}
          <button className="orders-secondary" type="button" disabled={saving} onClick={() => saveOrder({ confirm: false })}>
            <Save size={18} /> Salva bozza
          </button>
          <button className="orders-primary" type="button" disabled={saving || checkingAvailability || !availabilityValidity.valid || productsMissingVat.length > 0} onClick={() => saveOrder({ confirm: true })}>
            <ShoppingCart size={18} /> {saving ? "Salvataggio..." : privateOrder ? "Conferma e crea OCT" : "Conferma ordine"}
          </button>
          {!isReservation && !skipAvailability && !availabilityValidity.valid && <small className="orders-confirmation-note">{availabilityValidity.reason}</small>}
          {productsMissingVat.length > 0 && <small className="orders-confirmation-note">IVA mancante: {productsMissingVat.map((line) => line.codice_articolo).join(", ")}</small>}
        </div>
      </div>
    </div>
  );
}

function OcxProductSummary({ items = [], compact = false }) {
  if (!items.length) return <span className="orders-ocx-empty">Nessun prodotto destinato a OCX.</span>;
  return (
    <div className={`orders-ocx-detail${compact ? " is-compact" : ""}`}>
      <span>Prodotti destinati a OCX</span>
      <ul>
        {items.map((item, index) => (
          <li key={`${item.productCode}-${index}`}>
            <strong>{item.productCode}</strong>
            <span>{item.description || "Prodotto"}</span>
            <b>{pieces(item.quantity)} pezzi</b>
          </li>
        ))}
      </ul>
    </div>
  );
}
