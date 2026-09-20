import { displayDate } from '../../lib/displayDate.js';
import './ThermalLabel.css';
import { piecesInBox } from './thermalLabelModel.js';
export default function ThermalLabel({ label, count, pieces, index = 1 }) {
  const boxQuantity = piecesInBox(label.quantitaDaConfezionare, pieces, index);
  return <article className="thermal-label"><div><strong className="thermal-label-brand">PROGRÉ</strong><p>ETICHETTA TERMICA · SEGNACOLLO</p>
    <div className="thermal-label-field">PRODOTTO<strong>{label.codiceProdotto}</strong></div><p className="thermal-label-description">{label.descrizioneProdotto}</p>
    <div className="thermal-label-lot">LOTTO {label.lottoProduzione}</div>
    <div className="thermal-label-field">ORDINE<strong>{label.numeroOrdine}</strong></div><div className="thermal-label-field">CLIENTE<strong>{label.cliente}</strong></div>
    <div className="thermal-label-field">CONSEGNA<strong>{displayDate(label.dataConsegna)}</strong></div><div className="thermal-label-field">PEZZI NEL COLLO<strong>{boxQuantity == null ? '________________' : boxQuantity.toLocaleString('it-IT')}</strong></div></div>
    <footer>COLLO {index} / {count}</footer></article>;
}
