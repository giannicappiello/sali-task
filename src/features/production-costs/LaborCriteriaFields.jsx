import CostInfo from "./CostInfo";
import { Field, Numeric } from "./common";
import { laborRules, rulesSummary } from "./labor-rules";
export default function LaborCriteriaFields({settings,onChange}) {
 const rules=laborRules(settings);
 const edit=(group,key,value)=>onChange({...rules,[group]:{...rules[group],[key]:value}});
 return <section className="pc-panel pc-labor-criteria"><h2>Criteri di manodopera <CostInfo title="Criteri di manodopera"><p>Puoi definire i criteri con l’assistente oppure modificarli manualmente; diventano operativi solo salvando una nuova versione.</p>{rulesSummary(settings).map(t=><p key={t}>{t}</p>)}</CostInfo></h2><div className="pc-labor-grid"><div>
 <h3>STATION  {rules.station.basis==="historical_productivity"&&<CostInfo title="Metodo storico STATION"><p><strong>Ricalcolo retroattivo STATION.</strong> Dalla decorrenza la modalità si applica anche alle produzioni già concluse. Primo turno dagli orari MES attuali estesi allo storico; dal secondo turno usa gli orari aggiuntivi configurati sotto, anche nel conteggio della media. 8 ore economiche, mezzo turno superiore e minimo 0,5 solo se ci sono ore entro calendario. Straordinario soltanto se registrato esplicitamente nel consuntivo, al costo medio turno / 8 × ore × moltiplicatore. Nessuna modifica al planning MES; FILLING mantiene i suoi criteri.</p></CostInfo>}</h3><div className="pc-fields">
 <Field label="Base di valorizzazione"><select value={rules.station.basis} onChange={e=>edit("station","basis",e.target.value)}><option value="shifts">Turni × ore economiche configurate</option><option value="scheduled_hours">Ore effettivamente comprese nel calendario</option><option value="historical_productivity">Media storica di reparto (anche produzioni concluse)</option></select></Field>
 {rules.station.basis!=="historical_productivity"&&<Field label="Arrotondamento turni"><select value={rules.station.rounding} onChange={e=>edit("station","rounding",Number(e.target.value))}><option value="0.5">Mezzo turno superiore</option><option value="1">Turno intero superiore</option><option value="0">Frazione esatta</option></select></Field>}
 <Field label="Moltiplicatore straordinario (1 = tariffa normale)"><Numeric max="5" value={rules.station.overtimeMultiplier} onChange={v=>edit("station","overtimeMultiplier",v===""?null:Number(v))}/></Field></div>

 </div><div><h3>FILLING / astucciatura</h3>
 <Field label="Base di valorizzazione FILLING"><select value={rules.filling.basis} onChange={e=>edit("filling","basis",e.target.value)}><option value="presence_hours">Ore pianificate e presenze effettive</option><option value="historical_pieces">Media storica pezzi per turno</option></select></Field>
 {rules.filling.basis==="historical_pieces"?<CostInfo title="Metodo storico FILLING"><p>La tariffa unica e l’organico Confezionamento attivo MES determinano il costo di 8 ore economiche. Il calendario segue le stesse regole STATION. I pezzi astucciati sono separati, esclusi dalla media FILLING e senza costo autonomo. Le impostazioni del metodo a presenze restano conservate per un eventuale cambio proposto dall’IA. L’attivazione ricalcola anche le produzioni concluse.</p></CostInfo>:<div className="pc-fields">
 <Field label="Ore per il preventivo"><select value={rules.filling.plannedTime} onChange={e=>edit("filling","plannedTime",e.target.value)}><option value="scheduled">Ore planning entro calendario</option><option value="elapsed">Intera durata degli intervalli planning</option></select></Field>
 <Field label="Arrotondamento ore per intervallo"><select value={rules.filling.roundingMinutes} onChange={e=>edit("filling","roundingMinutes",Number(e.target.value))}><option value="0">Nessuno: ore esatte</option>{[15,30,60].map(n=><option key={n} value={n}>{n} minuti superiori</option>)}</select></Field>
 <label><input type="checkbox" checked={rules.filling.includeCleaning} onChange={e=>edit("filling","includeCleaning",e.target.checked)}/> Includi la manodopera dei lavaggi nel preventivo FILLING</label></div>}
 </div></div>
 </section>;
}
