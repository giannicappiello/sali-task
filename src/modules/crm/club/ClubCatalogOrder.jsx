import { useState } from 'react';
import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';
import { CrmKpiDialog } from '../CrmKpiDetail';
import { clubError } from './clubModel';
import useClubRpc from './useClubRpc';

function OrderForm({ entry, onSaved, onClose }) {
  const [rows, setRows] = useState(entry.rows), [dragged, setDragged] = useState(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  function move(from, to) {
    if (busy || from === to || to < 0 || to >= rows.length) return;
    setRows(current => { const next = [...current];const [row] = next.splice(from, 1);next.splice(to, 0, row);return next; });
  }
  async function save(reset = false) {
    if (busy) return;setBusy(true);setError('');
    try {
      const { error: failure } = await supabase.rpc('club_set_catalog_order', { product_ids: reset ? [] : rows.map(row => row.id), expected_revision: entry.revision, reset_to_pdf: reset });
      if (failure) throw failure;
      await onSaved(reset ? 'Ripristinato l’ordine del catalogo PDF.' : 'Ordine dei prodotti nel Club aggiornato.');onClose();
    } catch (failure) { setError(clubError(failure)); } finally { setBusy(false); }
  }
  return <><p>Trascina le righe oppure usa le frecce o il numero di posizione. Il Club rispetterà questo ordine anche nelle ricerche e nelle categorie. I prodotti nascosti mantengono la posizione senza essere pubblicati.</p>{error && <p role="alert" className="crm-message error">{error}</p>}<div className="crm-table-wrap"><table className="crm-table club-order-table" data-column-controls="off"><thead><tr><th>Posizione</th><th>Prodotto</th><th>Sposta</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.id} draggable={!busy} onDragStart={e => { setDragged(row.id);e.dataTransfer.effectAllowed = 'move';e.dataTransfer.setData('text/plain', row.id); }} onDragOver={e => { if (dragged) { e.preventDefault();e.dataTransfer.dropEffect = 'move'; } }} onDrop={e => { e.preventDefault();const from = rows.findIndex(item => item.id === dragged);if (from >= 0) move(from, index);setDragged(null); }} onDragEnd={() => setDragged(null)}><td><span className="club-order-position"><GripVertical size={16} aria-hidden="true" /><input key={`${row.id}-${index}`} type="number" min={1} max={rows.length} defaultValue={index + 1} disabled={busy} aria-label={`Posizione di ${row.name}`} onBlur={e => { const value = Number(e.target.value);if (Number.isInteger(value) && value >= 1 && value <= rows.length) move(index, value - 1);else e.target.value = index + 1; }} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault();e.currentTarget.blur(); } }} /></span></td><td><strong>{row.name}</strong><small>{row.code} · {row.section}{!row.visible ? ' · Nascosto' : ''}</small></td><td><div className="crm-toolbar-actions"><button type="button" className="crm-table-action" disabled={busy || index === 0} aria-label={`Sposta su ${row.name}`} onClick={() => move(index, index - 1)}><ArrowUp size={16} /></button><button type="button" className="crm-table-action" disabled={busy || index === rows.length - 1} aria-label={`Sposta giù ${row.name}`} onClick={() => move(index, index + 1)}><ArrowDown size={16} /></button></div></td></tr>)}</tbody></table></div><div className="crm-modal-actions"><button type="button" className="secondary-action crm-secondary" disabled={busy} onClick={() => save(true)}>Ripristina ordine PDF</button><button type="button" className="primary-action crm-primary" disabled={busy} onClick={() => save(false)}>{busy ? 'Salvataggio…' : 'Salva ordine nel Club'}</button></div></>;
}
export default function ClubCatalogOrder({ onClose, onSaved }) {
  const { data, error, loading } = useClubRpc('club_catalog_order');
  return <CrmKpiDialog title="Ordine nel Club" onClose={onClose}>{error && <p role="alert" className="crm-message error">{error}</p>}{loading ? <p>Caricamento prodotti…</p> : data && <OrderForm entry={data} onSaved={onSaved} onClose={onClose} />}</CrmKpiDialog>;
}
