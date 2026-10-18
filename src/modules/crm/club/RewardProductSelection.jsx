import { useState } from 'react';

import { isClubRewardProduct } from './rewardSelection';

export default function RewardProductSelection({ form, setForm, products, categories, loading }) {
  const [search, setSearch] = useState('');
  const scope = form.product_scope, choices = scope === 'categories' ? categories : products.filter(isClubRewardProduct);
  const field = scope === 'categories' ? 'category_ids' : 'product_ids';
  const query = search.trim().toLocaleLowerCase('it');
  const filtered = choices.filter(item => `${item.nome || item.name} ${item.codice_mexal || ''}`.toLocaleLowerCase('it').includes(query));
  function toggle(item, checked) {
    setForm(current => ({...current,[field]:checked ? [...current[field],item.id] : current[field].filter(id => id !== item.id),name:current.name || (scope === 'products' ? item.nome : '')}));
  }
  return <section className="club-reward-selection"><label>Prodotti disponibili come premio<select value={scope} onChange={event => {setSearch('');setForm(current => ({...current,product_scope:event.target.value}));}}><option value="all">Tutti i prodotti Sali di Ischia</option><option value="categories">Solo alcune categorie</option><option value="products">Uno o più prodotti</option></select></label><p>Solo prodotti Sali di Ischia con codice IT. Il cliente sceglie prodotti e quantità tra quelli abilitati. Il budget viene calcolato sui prezzi e sulle offerte attive del negozio di fiducia.</p>{scope !== 'all' && <><label>{scope === 'categories' ? 'Cerca categoria' : 'Cerca prodotto o codice IT'}<input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label><p aria-live="polite">{form[field].length} {scope === 'categories' ? 'categorie selezionate' : 'prodotti selezionati'}</p><div className="club-reward-choices">{loading ? <p role="status">Caricamento catalogo IT…</p> : filtered.map(item => <label key={item.id}><input type="checkbox" checked={form[field].includes(item.id)} onChange={event => toggle(item,event.target.checked)} /><span>{item.nome || item.name}{item.codice_mexal && <small>{item.codice_mexal}</small>}</span></label>)}{!loading && !filtered.length && <p>Nessun risultato.</p>}</div></>}</section>;
}
