import { useEffect, useMemo, useRef, useState } from "react";
import { Boxes, Plus, Save, Search, Trash2, X } from "lucide-react";
import { supabase } from "../../../lib/supabaseClient";
import { useAuth } from "../../../contexts/AuthContext";
import { loadDirectProductCatalog } from "../services/directProductCatalog";

const money = (value) => Number(value || 0).toLocaleString("it-IT", { style: "currency", currency: "EUR" });
const emptyForm = { id: null, codice: "", descrizione: "", modalita_prezzo: "sconto_ordine", prezzo_fisso: "", sconto_personalizzato: "", componenti: [] };
const numericPrice = (value, fallback = 0) => {
  const normalized = String(value ?? "").trim().replace(",", ".");
  if (!normalized) return fallback;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};
const isValidPrice = (value) => {
  const normalized = String(value ?? "").trim().replace(",", ".");
  return normalized !== "" && Number.isFinite(Number(normalized)) && Number(normalized) >= 0;
};

export default function Products({ implantsOnly = false }) {
  const { profile, canUseModule } = useAuth();
  const canManageImplants = canUseModule("prodotti", "amministrazione");
  const [tab, setTab] = useState(implantsOnly ? "impianti" : "prodotti");
  const [products, setProducts] = useState([]);
  const [kits, setKits] = useState([]);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(null);
  const [componentSearch, setComponentSearch] = useState("");
  const [componentResultIndex, setComponentResultIndex] = useState(0);
  const [pendingComponent, setPendingComponent] = useState(null);
  const [pendingComponentQuantity, setPendingComponentQuantity] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const componentResultRefs = useRef([]);
  const componentQuantityRef = useRef(null);

  useEffect(() => { void loadData(); }, []);
  async function loadData() {
    setLoading(true);
    try {
      const catalog = await loadDirectProductCatalog(supabase, { includeEconomics: true });
      setProducts(catalog.products);
      setKits(catalog.implants);
    } catch (error) {
      setMessage(error.message);
      setProducts([]);
      setKits([]);
    }
    setLoading(false);
  }

  const productMap = useMemo(() => new Map(products.map((item) => [item.codice_articolo, item])), [products]);
  const componentPrice = (row) => numericPrice(row.prezzo_unitario, numericPrice(productMap.get(row.codice_articolo)?.prezzo_listino));
  const kitTotal = (kit) => (kit.componenti || []).reduce((sum, row) => sum + Number(row.quantita || 0) * componentPrice(row), 0);
  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (q ? products.filter((item) => [item.codice_articolo, item.descrizione, item.ean, item.brand].some((value) => String(value || "").toLowerCase().includes(q))) : products).slice(0, 500);
  }, [products, search]);
  const filteredKits = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? kits.filter((item) => `${item.codice} ${item.descrizione}`.toLowerCase().includes(q)) : kits;
  }, [kits, search]);
  const componentResults = useMemo(() => {
    const q = componentSearch.trim().toLowerCase();
    if (!q) return [];
    const selected = new Set(form?.componenti.map((item) => item.codice_articolo));
    return products.filter((item) => !selected.has(item.codice_articolo) && `${item.codice_articolo} ${item.descrizione}`.toLowerCase().includes(q)).slice(0, 30);
  }, [componentSearch, products, form]);

  function editKit(kit) {
    setForm({ ...kit, prezzo_fisso: kit.prezzo_fisso ?? "", sconto_personalizzato: kit.sconto_personalizzato ?? "", componenti: [...(kit.componenti || [])].sort((a, b) => a.posizione - b.posizione).map((item) => ({ ...item, prezzo_unitario: item.prezzo_unitario ?? productMap.get(item.codice_articolo)?.prezzo_listino ?? "" })) });
    setMessage("");
  }
  async function addComponent(product) {
    if (window.matchMedia("(max-width: 1000px)").matches) {
      const value = await window.workspacePrompt?.(`Inserisci la quantità per ${product.descrizione || product.codice_articolo}`, "", { title: "Quantità prodotto", confirmLabel: "Aggiungi", inputType: "number", inputMode: "decimal", min: ".001", step: ".001" });
      if (value === null || value === undefined) return;
      const quantity = Number(String(value).replace(",", "."));
      if (!Number.isFinite(quantity) || quantity <= 0) {
        setMessage("Inserisci una quantità valida maggiore di zero.");
        return;
      }
      setForm((current) => ({ ...current, componenti: [...current.componenti, { codice_articolo: product.codice_articolo, quantita: quantity, prezzo_unitario: numericPrice(product.prezzo_listino) }] }));
      setComponentSearch("");
      setMessage("");
      return;
    }
    setPendingComponent(product);
    setPendingComponentQuantity("");
    setComponentSearch("");
    requestAnimationFrame(() => componentQuantityRef.current?.focus());
  }
  function confirmComponent() {
    const quantity = Number(String(pendingComponentQuantity).replace(",", "."));
    if (!pendingComponent || !Number.isFinite(quantity) || quantity <= 0) {
      setMessage("Inserisci una quantità valida maggiore di zero.");
      componentQuantityRef.current?.focus();
      return;
    }
    setForm((current) => ({ ...current, componenti: [...current.componenti, { codice_articolo: pendingComponent.codice_articolo, quantita: quantity, prezzo_unitario: numericPrice(pendingComponent.prezzo_listino) }] }));
    setPendingComponent(null);
    setPendingComponentQuantity("");
    setMessage("");
  }
  function moveComponentSelection(direction) {
    if (!componentResults.length) return;
    setComponentResultIndex((current) => {
      const next = Math.min(componentResults.length - 1, Math.max(0, current + direction));
      requestAnimationFrame(() => componentResultRefs.current[next]?.scrollIntoView({ block: "nearest" }));
      return next;
    });
  }
  async function saveKit() {
    const codice = form.codice.trim().toUpperCase();
    const descrizione = form.descrizione.trim();
    if (!codice || !descrizione || !form.componenti.length) return setMessage("Inserisci codice, descrizione e almeno un prodotto.");
    if (form.componenti.some((item) => !isValidPrice(item.prezzo_unitario))) return setMessage("Inserisci un prezzo valido per ogni prodotto dell’impianto.");
    if (form.modalita_prezzo === "prezzo_fisso" && Number(form.prezzo_fisso) < 0) return setMessage("Inserisci un prezzo fisso valido.");
    if (form.modalita_prezzo === "sconto_personalizzato" && (Number(form.sconto_personalizzato) < 0 || Number(form.sconto_personalizzato) > 100)) return setMessage("Lo sconto deve essere compreso tra 0 e 100.");
    const payload = {
      codice, descrizione, modalita_prezzo: form.modalita_prezzo,
      prezzo_fisso: form.modalita_prezzo === "prezzo_fisso" ? Number(form.prezzo_fisso) : null,
      sconto_personalizzato: form.modalita_prezzo === "sconto_personalizzato" ? Number(form.sconto_personalizzato) : null,
      creato_da: form.id ? undefined : profile?.id,
    };
    const { data: kit, error } = form.id
      ? await supabase.from("ordini_impianti").update(payload).eq("id", form.id).select().single()
      : await supabase.from("ordini_impianti").insert(payload).select().single();
    if (error) return setMessage(error.message);
    if (form.id) {
      const { error: deleteError } = await supabase.from("ordini_impianti_componenti").delete().eq("impianto_id", kit.id);
      if (deleteError) return setMessage(deleteError.message);
    }
    const { error: componentError } = await supabase.from("ordini_impianti_componenti").insert(form.componenti.map((item, index) => ({ impianto_id: kit.id, codice_articolo: item.codice_articolo, quantita: Number(item.quantita), prezzo_unitario: numericPrice(item.prezzo_unitario), posizione: index })));
    if (componentError) return setMessage(componentError.message);
    setForm(null); setMessage("Impianto salvato."); await loadData();
  }
  async function deactivateKit(id) {
    if (!(await window.workspaceConfirm?.("Eliminare questo impianto?", { title: "Elimina impianto" }))) return;
    const { error } = await supabase.from("ordini_impianti").update({ attivo: false }).eq("id", id);
    if (error) setMessage(error.message); else await loadData();
  }

  return <div className="orders-page">
    {!implantsOnly && <div className="orders-products-tabs">
      <button className={tab === "prodotti" ? "active" : ""} onClick={() => setTab("prodotti")}>Prodotti</button>
      <button className={tab === "impianti" ? "active" : ""} onClick={() => setTab("impianti")}><Boxes size={17}/> Impianti</button>
    </div>}
    <div className="orders-toolbar">
      <div className="orders-search"><Search size={18}/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Cerca ${tab === "impianti" ? "impianto" : "prodotto"}...`}/></div>
      {tab === "impianti" && canManageImplants && <button className="orders-primary" onClick={() => setForm({ ...emptyForm, componenti: [] })}><Plus size={17}/> Nuovo impianto</button>}
    </div>
    {message && <div className="orders-alert">{message}</div>}
    {tab === "prodotti" ? <div className="orders-table-wrap"><table className="orders-table"><thead><tr><th>Codice</th><th>Prodotto</th><th>Listino</th><th>IVA</th><th>Disponibile</th></tr></thead><tbody>{filteredProducts.map((item) => <tr key={item.codice_articolo}><td>{item.codice_articolo}</td><td>{item.descrizione}</td><td>{money(item.prezzo_listino)}</td><td>{item.aliquota_iva ?? "-"}</td><td>{item.disponibilita ?? "-"}</td></tr>)}</tbody></table></div>
    : <div className="orders-products-grid">{filteredKits.map((kit) => <article className="orders-product-card" key={kit.id}><div><strong>{kit.codice}</strong><h3>{kit.descrizione}</h3></div><p>{kit.componenti.length} prodotti · valore prodotti {money(kitTotal(kit))}</p><div className="orders-product-meta"><span>{kit.modalita_prezzo === "sconto_ordine" ? "Scontistica ordine" : kit.modalita_prezzo === "prezzo_fisso" ? `Prezzo fisso ${money(kit.prezzo_fisso)}` : `Sconto ${kit.sconto_personalizzato}%`}</span></div>{canManageImplants && <div className="orders-product-actions"><button className="orders-secondary" onClick={() => editKit(kit)}>Modifica</button><button className="orders-icon-danger" onClick={() => deactivateKit(kit.id)}><Trash2 size={17}/></button></div>}</article>)}</div>}
    {loading && <div className="orders-empty">Caricamento...</div>}
    {form && <div className="orders-kit-overlay"><section className="orders-kit-dialog"><div className="orders-kit-title"><div><h2>{form.id ? "Modifica impianto" : "Nuovo impianto"}</h2><p>Componi l’impianto usando i prodotti esistenti.</p></div><button className="orders-icon-danger" onClick={() => setForm(null)}><X/></button></div>
      <div className="orders-kit-fields"><label>Codice<input value={form.codice} onChange={(e) => setForm({...form, codice:e.target.value})}/></label><label>Descrizione<input value={form.descrizione} onChange={(e) => setForm({...form, descrizione:e.target.value})}/></label></div>
      <div className="orders-product-entry"><label className="orders-kit-label">Cerca prodotto<div className="orders-search"><Search size={17}/><input value={componentSearch} onChange={(e) => { setComponentSearch(e.target.value); setComponentResultIndex(0); setPendingComponent(null); setPendingComponentQuantity(""); }} onKeyDown={(e) => { if(e.key==="ArrowDown"){e.preventDefault();moveComponentSelection(1);}else if(e.key==="ArrowUp"){e.preventDefault();moveComponentSelection(-1);}else if((e.key==="Enter"||e.key==="Tab")&&componentResults[componentResultIndex]){e.preventDefault();addComponent(componentResults[componentResultIndex]);} }} placeholder="Codice o descrizione..."/></div></label>
      <label className="orders-product-quick-quantity">Quantità<input ref={componentQuantityRef} type="number" min=".001" step=".001" disabled={!pendingComponent} value={pendingComponentQuantity} onChange={(e)=>setPendingComponentQuantity(e.target.value)} onKeyDown={(e)=>{if(e.key==="Enter"||e.key==="Tab"){e.preventDefault();confirmComponent();}}}/></label></div>
      {componentResults.length > 0 && <div className="orders-picker-results">{componentResults.map((product,index) => <button ref={(node)=>{componentResultRefs.current[index]=node;}} className={index===componentResultIndex?"is-keyboard-active":""} key={product.codice_articolo} onMouseEnter={()=>setComponentResultIndex(index)} onClick={() => addComponent(product)}><strong>{product.descrizione}</strong><span>{product.codice_articolo} · {money(product.prezzo_listino)}</span></button>)}</div>}
      <div className="orders-table-wrap"><table className="orders-table"><thead><tr><th>Prodotto</th><th>Prezzo unitario</th><th>Quantità</th><th>Totale</th><th></th></tr></thead><tbody>{form.componenti.map((row) => { const product=productMap.get(row.codice_articolo)||{}; return <tr key={row.codice_articolo}><td><strong>{row.codice_articolo}</strong><br/>{product.descrizione}</td><td><input className="orders-number-input" aria-label={`Prezzo unitario ${row.codice_articolo}`} type="number" min="0" step=".01" value={row.prezzo_unitario} onChange={(e) => setForm({...form, componenti:form.componenti.map((item)=>item.codice_articolo===row.codice_articolo?{...item,prezzo_unitario:e.target.value}:item)})}/></td><td><input className="orders-number-input" type="number" min=".001" step=".001" value={row.quantita} onChange={(e) => setForm({...form, componenti:form.componenti.map((item)=>item.codice_articolo===row.codice_articolo?{...item,quantita:e.target.value}:item)})}/></td><td>{money(Number(row.quantita)*componentPrice(row))}</td><td><button className="orders-icon-danger" onClick={() => setForm({...form,componenti:form.componenti.filter((item)=>item.codice_articolo!==row.codice_articolo)})}><Trash2 size={17}/></button></td></tr>})}</tbody></table></div>
      <div className="orders-kit-total"><span>Somma prodotti</span><strong>{money(kitTotal(form))}</strong></div>
      <div className="orders-kit-pricing"><label><input type="radio" checked={form.modalita_prezzo==="sconto_ordine"} onChange={()=>setForm({...form,modalita_prezzo:"sconto_ordine"})}/> Stessa scontistica dell’ordine</label><label><input type="radio" checked={form.modalita_prezzo==="prezzo_fisso"} onChange={()=>setForm({...form,modalita_prezzo:"prezzo_fisso"})}/> Prezzo fisso <input type="number" min="0" step=".01" value={form.prezzo_fisso} onChange={(e)=>setForm({...form,prezzo_fisso:e.target.value})}/></label><label><input type="radio" checked={form.modalita_prezzo==="sconto_personalizzato"} onChange={()=>setForm({...form,modalita_prezzo:"sconto_personalizzato"})}/> Sconto diverso (%) <input type="number" min="0" max="100" step=".01" value={form.sconto_personalizzato} onChange={(e)=>setForm({...form,sconto_personalizzato:e.target.value})}/></label></div>
      <div className="orders-kit-actions"><button className="orders-secondary" onClick={()=>setForm(null)}>Annulla</button><button className="orders-primary" onClick={saveKit}><Save size={17}/> Salva impianto</button></div>
    </section></div>}
  </div>;
}
