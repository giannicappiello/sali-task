import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
test('catalog route renders the geolocation screen through the existing Access Guard',async()=>{
  const [app,migration,hub,form]=await Promise.all([read('src/App.jsx'),read('supabase/migrations/20261004120000_hr_geolocation_settings.sql'),read('src/pages/Settings/SettingsHub.jsx'),read('src/pages/Settings/GeolocationSettings.jsx')]);
  assert.match(app,/<Route path="settings\/geolocation" element={<WorkspaceAccessGuard screenCode="impostazioni.geolocalizzazione"><GeolocationSettings \/>/);
  assert.match(migration,/other_code,'impostazioni.geolocalizzazione',10,false,true/);
  assert.match(migration,/'impostazioni','impostazioni.altre',160,false,true/);
  assert.match(hub,/hasScreenAccess\(screen.codice, "impostazioni"\)/);
  assert.match(form,/canUseScreen\('impostazioni.geolocalizzazione', 'scrittura'\)/);
  assert.match(form,/Salva impostazioni/);
  assert.match(form,/form-grid-2/);
  assert.match(migration,/outside:=distance>cfg.presence_radius/);
  assert.match(migration,/if acc>cfg.max_accuracy then/);
  assert.doesNotMatch(migration,/distance[+-]acc|pending_exit|outside_since|last_outside_at/);
});
