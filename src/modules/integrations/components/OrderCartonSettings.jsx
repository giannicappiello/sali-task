import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { CARTON_RULE_TYPES, cartonRuleLabel, normalizeCartonRule } from '../../orders/services/orderCartonRules.js';
import './order-carton-settings.css';
const emptyRule = () => ({ tipo: 'multiple_of', valore: '', prodotti: [], attiva: true, messaggio: '' });
async function allRows(table, columns, configure = query => query) {
  const rows = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await configure(supabase.from(table).select(columns)).range(start, start + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) return rows;
  }
}
export default function OrderCartonSettings({ moduleCode }) {
  const [rules, setRules] = useState([]), [products, setProducts] = useState([]);
  const [form, setForm] = useState(emptyRule), [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false);
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    Promise.all([
      allRows('ordini_regole_cartonaggi', '*', q => q.eq('modulo_ordini', moduleCode).order('creato_il').order('id')),
      allRows('ordini_prodotti_cache', 'codice_articolo,descrizione', q => q.order('codice_articolo')),
    ]).then(([items, catalog]) => { if (active) { setRules(items); setProducts(catalog.map(product => ({ ...product, codice_articolo: String(product.codice_articolo).trim().toUpperCase() }))); } })
      .catch(e => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [moduleCode]);
  const visible = useMemo(() => {
    const search = query.trim().toLowerCase();
    return products.filter(p => [p.codice_articolo, p.descrizione].some(v => String(v || '').toLowerCase().includes(search))).slice(0, 100);
  }, [products, query]);
  const names = useMemo(() => new Map(products.map(p => [p.codice_articolo, p.descrizione])), [products]);
  function select(code, checked) {
    setForm(current => ({ ...current, prodotti: checked ? [...new Set([...current.prodotti, code])] : current.prodotti.filter(item => item !== code) }));
  }
  async function save() {
    if (saving) return;
    setError(''); setMessage('');
    let payload;
    try { payload = normalizeCartonRule(form, moduleCode); } catch (e) { setError(e.message); return; }
    setSaving(true);
    try {
      const { data, error: failure } = await supabase.from('ordini_regole_cartonaggi').upsert(payload).select().single();
      if (failure) throw failure;
      setRules(items => [...items.filter(item => item.id !== data.id), data]);
      setForm(emptyRule()); setQuery(''); setMessage('Regola cartonaggi salvata.');
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  }
  async function remove(rule) {
    if (saving || !await window.workspaceConfirm('Eliminare questa regola cartonaggi?')) return;
    setSaving(true); setError(''); setMessage('');
    try {
      const { error: failure } = await supabase.from('ordini_regole_cartonaggi').delete().eq('id', rule.id).eq('modulo_ordini', moduleCode);
      if (failure) throw failure;
      setRules(items => items.filter(item => item.id !== rule.id));
      if (form.id === rule.id) setForm(emptyRule());
      setMessage('Regola eliminata.');
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  }
  if (loading) return <p>Caricamento cartonaggi...</p>;
  return <div className="order-carton-settings">
    <h4>Gestione Cartonaggi</h4>
    <p>Le regole si applicano alla quantità totale della referenza nell’ordine. Puoi combinare più vincoli; le altre referenze restano libere.</p>
    {error && <div className="mexal-alert alert-error" role="alert">{error}</div>}
    {message && <p role="status">{message}</p>}
    <fieldset disabled={saving} className="carton-rule-editor">
      <legend>{form.id ? 'Modifica regola' : 'Nuova regola'}</legend>
      <div className="carton-rule-fields">
        <label>Limitazione<select value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value })}>{CARTON_RULE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}</select></label>
        <label>Valore<input type="number" min="0.000001" max="1000000000" step="any" value={form.valore} onChange={e => setForm({ ...form, valore: e.target.value })} /></label>
      </div>
      <label><input type="checkbox" checked={form.attiva} onChange={e => setForm({ ...form, attiva: e.target.checked })} /> Regola attiva</label>
      <label>Messaggio sull’articolo (facoltativo)<input maxLength={500} value={form.messaggio} onChange={e => setForm({ ...form, messaggio: e.target.value })} placeholder="Esempio: articolo venduto solo a cartoni completi" /></label>
      <label>Cerca referenze<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Codice o descrizione articolo" /></label>
      <div className="carton-selection-actions"><span>{form.prodotti.length} referenze selezionate</span><button type="button" onClick={() => setForm({ ...form, prodotti: [...new Set([...form.prodotti, ...visible.map(p => p.codice_articolo)])] })}>Seleziona le referenze visualizzate</button><button type="button" onClick={() => setForm({ ...form, prodotti: [] })}>Deseleziona tutte</button></div>
      <div className="carton-product-list" aria-label="Referenze a cui applicare la regola">
        {visible.map(p => <label key={p.codice_articolo}><input type="checkbox" checked={form.prodotti.includes(p.codice_articolo)} onChange={e => select(p.codice_articolo, e.target.checked)} /><span><strong>{p.codice_articolo}</strong> · {p.descrizione}</span></label>)}
        {!visible.length && <p>Nessuna referenza trovata.</p>}
      </div>
      {products.length > 100 && <small>Visualizzate al massimo 100 referenze: usa la ricerca per trovare gli altri articoli.</small>}
      <details><summary>Referenze selezionate ({form.prodotti.length})</summary>{form.prodotti.map(code => <div key={code}>{code} · {names.get(code) || 'Referenza non presente nel catalogo'} <button type="button" onClick={() => select(code, false)} aria-label={'Rimuovi ' + code}>Rimuovi</button></div>)}</details>
      <div className="carton-selection-actions"><button type="button" className="orders-primary" onClick={save}>{saving ? 'Salvataggio...' : 'Salva regola'}</button>{form.id && <button type="button" onClick={() => { setForm(emptyRule()); setError(''); }}>Annulla modifica</button>}</div>
    </fieldset>
    <h4>Regole configurate</h4>
    {!rules.length && <p>Nessuna limitazione configurata.</p>}
    {rules.map(rule => <article className="carton-saved-rule" key={rule.id}>
      <strong>{cartonRuleLabel(rule)} · {rule.attiva ? 'Attiva' : 'Disattivata'}</strong>
      <p>{rule.messaggio}</p><details><summary>{rule.prodotti.length} referenze</summary>{rule.prodotti.map(code => <div key={code}>{code} · {names.get(code) || ''}</div>)}</details>
      <div className="carton-selection-actions"><button type="button" disabled={saving} onClick={() => { setForm({ ...rule }); setError(''); setMessage(''); }}>Modifica</button><button type="button" disabled={saving} onClick={() => void remove(rule)}>Elimina</button></div>
    </article>)}
  </div>;
}
