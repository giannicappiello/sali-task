import { displayDate } from '../../lib/displayDate';
import './PackagingSheet.css';
const number = value => Number(value || 0).toLocaleString('it-IT', { maximumFractionDigits: 3 });
export default function PackagingSheet({ sheet }) {
  return <article className="packaging-sheet">
    <header><strong>PROGRÉ · Foglio di confezionamento</strong><h2>{sheet.numeroOrdine}</h2><p>Cliente: {sheet.cliente}</p><p>Generato: {displayDate(sheet.generatoIl, true)} · Stampato: {displayDate(sheet.stampatoIl, true)}</p></header>
    <section><h3>{sheet.codiceProdottoFinito} · {sheet.descrizioneProdottoFinito}</h3><div className="packaging-sheet-grid"><p>Da confezionare: <strong>{number(sheet.quantitaDaConfezionare)} PZ</strong></p><p>Lotto: <strong>{sheet.lottoProduzione || 'Da assegnare da Mexal (CL)'}</strong></p><p>Scadenza: ________________</p><p>Responsabile qualità: ________________</p></div></section>
    {(sheet.avvisi || []).map((text, i) => <p className="pc-note" key={i}>{text}</p>)}
    {[['Semilavorato', sheet.semilavorati], ['Packaging', sheet.packaging]].map(([label, rows]) => <section key={label}><h3>{label}</h3><div className="packaging-sheet-table"><table><thead><tr><th>Codice</th><th>Descrizione</th><th>UM</th><th>Quantità</th><th>Disponibile</th><th>Magazzini</th></tr></thead><tbody>{(rows || []).map((row, i) => <tr key={`${row.codice}-${i}`}><td>{row.codice}</td><td>{row.descrizione}</td><td>{row.unitaMisura}</td><td>{number(row.quantitaRichiesta)}</td><td>{number(row.quantitaDisponibile)}</td><td>{sheet.magazziniOperativi}</td></tr>)}</tbody></table></div></section>)}
    <section><h3>Riempimento</h3><div className="packaging-sheet-grid"><p>Volume: {number(sheet.volumeMl)} ml</p><p>Densità: {number(sheet.densita)}</p><p>Peso unitario: {number(sheet.pesoUnitarioGr)} g</p></div></section>
    <section><h3>Confezionamento e imballo</h3><div className="packaging-sheet-grid"><p>Pezzi per collo: <strong>{sheet.pezziPerCollo > 0 ? number(sheet.pezziPerCollo) : '________________'}</strong></p>{['Cartoni per strato', 'Strati per pallet', 'Pezzi per pallet', 'Numero pallet', 'Totale pezzi'].map(label => <p key={label}>{label}: ________________</p>)}</div></section>
    <section><h3>Note e conferma operativa</h3><p>Note operatore: ________________________________________________________</p><p>Operatore confezionamento / firma: _____________________________________</p><p>Responsabile qualità / firma: __________________________________________</p></section>
  </article>;
}
