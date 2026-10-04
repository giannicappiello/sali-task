import { useEffect, useState } from 'react';
import { ArrowLeft, Save } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { hrRpc } from '../../modules/hr/hrService';

export default function GeolocationSettings() {
  const { canUseScreen } = useAuth();
  const canSave = canUseScreen('impostazioni.geolocalizzazione', 'scrittura');
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);
  useEffect(() => {
    let active = true;
    hrRpc('workspace_hr_geolocation_settings').then(data => { if (active) setForm(data); })
      .catch(error => { if (active) setFeedback({ error: true, text: error.message }); });
    return () => { active = false; };
  }, []);
  async function save(event) {
    event.preventDefault(); if (busy || !canSave) return;
    setBusy(true); setFeedback(null);
    try {
      const data = await hrRpc('workspace_hr_save_geolocation_settings', { p_radius: Number(form.presence_radius), p_accuracy: Number(form.max_accuracy) });
      setForm(data); setFeedback({ text: 'Impostazioni salvate.' });
      window.dispatchEvent(new Event('workspace:hr-changed'));
    } catch (error) { setFeedback({ error: true, text: 'Errore di salvataggio: ' + error.message }); }
    finally { setBusy(false); }
  }
  return <div className="settings-page v4-page">
    <div className="page-title-row"><div><Link className="settings-hub-back" to="/settings/other"><ArrowLeft size={17} />Altre impostazioni</Link><h1>Impostazioni Geolocalizzazione</h1><p>Impostazioni → Altre impostazioni → Impostazioni Geolocalizzazione</p></div></div>
    {feedback && <p role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>}
    {!form && !feedback && <p>Caricamento impostazioni…</p>}
    {form && <form className="panel settings-panel v4-modal" onSubmit={save}>
      <div className="panel-header"><div><h3>Parametri GPS</h3><p>Configurazione delle presenze da smartphone.</p></div></div>
      <fieldset disabled={busy || !canSave}><div className="form-grid-2">
        <label>Raggio presenza (metri)<input type="number" required min="1" step="1" value={form.presence_radius} onChange={event => setForm({ ...form, presence_radius: event.target.value })} /><small>Distanza massima dalla sede entro la quale l'utente viene considerato ancora presente.</small></label>
        <label>Accuracy GPS massima ammessa (metri)<input type="number" required min="1" step="1" value={form.max_accuracy} onChange={event => setForm({ ...form, max_accuracy: event.target.value })} /><small>Le rilevazioni con accuratezza peggiore di questo valore vengono ignorate e non possono modificare lo stato presenza.</small></label>
      </div><button className="primary-action" type="submit"><Save size={18} />{busy ? 'Salvataggio…' : 'Salva impostazioni'}</button></fieldset>
    </form>}
  </div>;
}
