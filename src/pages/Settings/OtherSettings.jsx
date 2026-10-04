import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import WorkspaceModuleContainer from '../Modules/WorkspaceModuleContainer';
export default function OtherSettings() {
  const [moduleCode, setModuleCode] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    supabase.from('workspace_moduli_schermate').select('modulo_codice').eq('schermata_codice', 'impostazioni.geolocalizzazione').order('ordine').limit(1).maybeSingle()
      .then(({ data, error: failure }) => { if (active) { if (failure || !data) setError(failure?.message || 'Modulo Altre impostazioni non configurato.'); else setModuleCode(data.modulo_codice); } });
    return () => { active = false; };
  }, []);
  if (error) return <p role="alert">{error}</p>;
  return moduleCode ? <WorkspaceModuleContainer configuredModuleCode={moduleCode} /> : <p>Caricamento impostazioni…</p>;
}
