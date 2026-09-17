import { Link } from "react-router-dom";
import { planningDate } from "./planning-display";

export default function OdlShortages({ rows = [], busy, onOpen }) {
  if (!rows.length) return null;
  const phases = { 0: "Miscelazione", 3: "Confezionamento", 7: "Astucciatura" };
  return <section className="plan-panel"><h2>Fabbisogni specifici degli ODL</h2>
    <p>Quantità registrate al rilascio con carenza. Apri il dettaglio per verificare la copertura dopo l’arrivo dei materiali.</p>
    <div className="plan-actions"><Link to="/produzione/fabbisogni-acquisto">Apri fabbisogni acquisto</Link></div>
    <div className="plan-table-wrap"><table><thead><tr><th>RdP / OP</th><th>Fase</th><th>Articolo</th><th>Quantità</th><th>Necessario il</th><th>Stato</th><th>Azione</th></tr></thead><tbody>{rows.map((row, i) => <tr key={`${row.versionId}:${i}`}><td>{row.orderNumber || row.orderId}</td><td>{phases[row.phase] || row.phase}</td><td>{row.code}</td><td>{new Intl.NumberFormat("it-IT", { maximumFractionDigits: 6 }).format(row.quantity)} {row.unit}</td><td>{planningDate(row.requiredAt)}</td><td>{row.cancelled ? "ODL annullato" : row.coveredAtUtc ? "Coperto" : "Da coprire"}</td><td><button disabled={busy} onClick={() => onOpen(row.versionId)}>Apri fabbisogno</button></td></tr>)}</tbody></table></div>
  </section>;
}
