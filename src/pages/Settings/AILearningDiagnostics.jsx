import {useEffect,useState} from 'react';
import {supabase} from '../../lib/supabaseClient';
const STATES={running:'In corso',completed:'Completata',no_evidence:'Nessuna evidenza utilizzabile',connector_disabled:'Connettore disabilitato',failed:'Non riuscita'};
export default function AILearningDiagnostics(){
  const [runs,setRuns]=useState([]);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const [observedAt]=useState(()=>Date.now());
  useEffect(()=>{
    let active=true;
    supabase.from('ai_learning_runs').select('id,started_at,finished_at,state,candidates,proposals_created,detail').order('started_at',{ascending:false}).limit(20)
      .then(({data,error:failure})=>{
        if(!active)return;
        if(failure)setError('Impossibile leggere le verifiche automatiche dei tempi.');
        else setRuns(data || []);
      }).catch(()=>{if(active)setError('Collegamento non disponibile.');})
      .finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[]);
  return <section className="ai-cost-report" aria-labelledby="ai-learning-runs-title">
    <div className="ai-cost-report-heading"><div><span>AUTOAPPRENDIMENTO</span><h2 id="ai-learning-runs-title">Verifiche dei tempi di lavorazione</h2><p>Esito di ogni analisi automatica. Le proposte richiedono approvazione prima di modificare gli standard.</p></div></div>
    {error?<p role="alert">{error}</p>:loading?<p>Caricamento verifiche…</p>:!runs.length?<p>Nessuna verifica registrata dopo l’attivazione della diagnostica.</p>:<div className="ai-cost-table-wrap"><table className="ai-cost-table"><thead><tr><th>Avvio</th><th>Esito</th><th>Evidenze utilizzabili</th><th>Proposte create</th><th>Dettaglio</th></tr></thead><tbody>{runs.map(run=><tr key={run.id}><td>{new Date(run.started_at).toLocaleString('it-IT')}</td><td>{STATES[run.state] || run.state}{run.state==='running' && observedAt-Date.parse(run.started_at)>15*60*1000?<small>Esito non ancora registrato: verificare il servizio.</small>:null}</td><td>{run.candidates}</td><td>{run.proposals_created}</td><td>{run.detail || '—'}<small>Riferimento: {run.id}</small></td></tr>)}</tbody></table></div>}
  </section>;
}
