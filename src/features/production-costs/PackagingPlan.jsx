import { money, quantity, unitMoney } from "./client";
import CostInfo from "./CostInfo";

export function PackagingPlan({record}) {
 const rows=record.plannedPackaging||[];
 return <section className="pc-panel"><h3>Packaging preventivo<CostInfo title="Fonte del packaging preventivo">
  <p>Distinta × pezzi previsti, mai quantità consumate nello SL. I valori originali disponibili hanno precedenza.</p>
  <p>{record.historicalPackaging?.source}</p>
 </CostInfo></h3>{!rows.length?<p>Distinta packaging non disponibile.</p>:
 <div className="pc-table-wrap"><table><thead><tr><th>Articolo</th><th>Quantità prevista</th><th>Costo unitario</th><th>Importo</th><th>Fonte</th></tr></thead>
 <tbody>{rows.map((m,i)=><tr key={i}><td>{m.code}<small>{m.description}</small></td><td>{quantity(m.quantity)} {m.unit}</td>
 <td>{unitMoney(m.unitCost)}</td><td>{money(m.unitCost==null||m.quantity==null?null:m.unitCost*m.quantity)}</td>
 <td>{m.reconstructed?"Distinta MES disponibile":"Preventivo conservato"}</td></tr>)}</tbody></table></div>}</section>;
}
