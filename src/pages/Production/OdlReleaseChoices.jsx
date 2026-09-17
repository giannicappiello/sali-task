import { useState } from "react";
import { Link } from "react-router-dom";

function releaseCandidates(snapshot) {
  const ids = [...new Set((snapshot?.tasks || []).filter(task => task.orderId > 0 && [0, 3, 7].includes(task.type)).map(task => task.orderId))];
  return ids.map(id => ({ id, ...snapshot.impacts?.find(row => row.orderId === id) }));
}

export default function OdlReleaseChoices({ version, busy, shortageSupported, onRecalculate }) {
  const candidates = releaseCandidates(version.snapshot);
  const [chosen, setChosen] = useState(() => candidates.map(row => row.id));
  const [shortageReason, setShortageReason] = useState("");
  const number = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 6 });
  return <section className="plan-notice" aria-label="Scelte per il rilascio bloccato">
    <h3>Decidi come procedere</h3>
    <p>Questa proposta non ha generato ODL. Puoi scegliere gli ordini da verificare insieme, gestire la priorità dei materiali o rivedere le date del piano.</p>
    <fieldset disabled={busy}><legend>Ordini da includere nella nuova anteprima</legend>
      <div className="plan-actions"><button type="button" onClick={() => setChosen(candidates.map(row => row.id))}>Seleziona tutti</button><button type="button" onClick={() => setChosen([])}>Deseleziona tutti</button></div>
      <div className="plan-table-wrap"><table><thead><tr><th>Includi</th><th>RdP / OP</th><th>Fabbisogno della proposta</th><th>Decisioni sui materiali</th></tr></thead><tbody>
        {candidates.map(row => <tr key={row.id}><td><input type="checkbox" aria-label={`Includi ${row.number || `OP ${row.id}`} nel rilascio`} checked={chosen.includes(row.id)} onChange={e => setChosen(e.target.checked ? [...chosen, row.id] : chosen.filter(id => id !== row.id))} /></td>
          <td><strong>{row.number || `OP ${row.id}`}</strong><br />{row.article} · {row.description}</td>
          <td>{version.snapshot.requirements?.filter(item => item.orderId === row.id).map((item, index) => <div key={index}>{item.code}: {number.format(item.quantity)} {item.unit}</div>)}</td>
          <td>{row.number && <Link to={`/revisione-priorita-produzione?order=${encodeURIComponent(row.number)}`}>Gestisci priorità e materiali di {row.number}</Link>}</td></tr>)}
      </tbody></table></div>
      <p>{chosen.length} ordini selezionati. Il MES verificherà nuovamente la copertura dell’intera selezione; gli ordini esclusi restano nel piano.</p>
      <button type="button" className="plan-primary" disabled={!chosen.length} onClick={() => onRecalculate(chosen)}>Ricalcola rilascio degli ordini selezionati</button>
    </fieldset>
    <div className="plan-actions"><Link to={`/versioni-piano-produzione?orders=${chosen.join(",")}`}>Rivedi date e fattibilità del piano</Link></div>
    <fieldset disabled={busy || !shortageSupported}><legend>Procedi con carenza e genera fabbisogno</legend>
      <p>Genera gli ODL selezionati registrando articolo, quantità mancante, ordine e fase. Si prenotano solo i materiali disponibili. Le fasi scoperte resteranno in attesa di copertura prima dell’avvio.</p>
      <label>Motivazione della carenza autorizzata<textarea maxLength={1000} value={shortageReason} onChange={e => setShortageReason(e.target.value)} /></label>
      <button type="button" disabled={!chosen.length || !shortageReason.trim()} onClick={() => onRecalculate(chosen, true, shortageReason.trim())}>Procedi con carenza e genera fabbisogno</button>
      <p>Il pulsante prepara una nuova anteprima: potrai controllare i fabbisogni e confermare il rilascio.</p>
    </fieldset>
    {!shortageSupported && <p>Aggiornare il MES e premere “Aggiorna stato” per abilitare il rilascio con carenza autorizzata.</p>}
  </section>;
}
