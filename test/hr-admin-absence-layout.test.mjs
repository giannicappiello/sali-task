import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const moduleSource = fs.readFileSync('src/modules/hr/HrModule.jsx', 'utf8');
const appSource = fs.readFileSync('src/App.jsx', 'utf8');
const styles = fs.readFileSync('src/modules/hr/hr.css', 'utf8');
const viteConfig = fs.readFileSync('vite.config.js', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260924180000_workspace_hr_admin_absences.sql', 'utf8');

test('HR admin absence flow exposes the four supported absence causes', () => {
  assert.match(moduleSource, /Nuova assenza/);
  assert.match(moduleSource, /workspace_hr_admin_request/);
  assert.match(moduleSource, /\['illness', 'Malattia'\]/);
  assert.match(moduleSource, /\['pregnancy', 'Maternità'\]/);
  assert.match(moduleSource, /Assegna periodo di assenza/);
  assert.match(moduleSource, /La data finale deve essere successiva alla data iniziale/);
  assert.match(moduleSource, /KIND\[row\.kind\]/);
  assert.match(moduleSource, /field\('user_id', 'Dipendente', 'select'/);
  assert.match(moduleSource, /field\('starts_at', 'Dal · data e ora', 'datetime-local'/);
  assert.match(moduleSource, /field\('ends_at', 'Al · data e ora', 'datetime-local'/);
  assert.match(moduleSource, /canManage \|\| isAdminUser/);
  assert.match(moduleSource, /Assegna turno/);
  assert.match(moduleSource, /Consuntivi presenze/);
});

test('HR admin absence persistence is authorization-checked and immediately approved', () => {
  assert.match(migration, /workspace_hr_admin_request/);
  assert.match(migration, /workspace_user_is_admin\(\)/);
  assert.match(migration, /workspace_hr_members where user_id=target and active/);
  assert.match(migration, /values\(request_id,target,kind,starts_at,ends_at,note,'approved'/);
  assert.match(migration, /revoke all on function public\.workspace_hr_admin_request/);
  assert.match(migration, /ends_at-starts_at>interval '366 days'/);
  assert.match(migration, /Periodo sovrapposto a una richiesta già approvata/);
  assert.match(migration, /kind in \('leave','permission','illness','pregnancy','overtime'\)/);
});

test('the real /settings/hr route renders the current HR module and requested controls', () => {
  assert.ok(appSource.includes('<Route path="settings/hr" element={<SettingsAccessGuard adminOnly><HrModule key="hr-config" configuration /></SettingsAccessGuard>} />'));
  assert.match(appSource, /const HrModule = lazy\(\(\) => import\("\.\/modules\/hr\/HrModule"\)\)/);
  assert.match(moduleSource, /import '\.\/hr\.css';/);
  assert.match(moduleSource, /Calendario aziendale · vista settimanale/);
  assert.doesNotMatch(moduleSource, /Scostamento ore:/);
  assert.doesNotMatch(moduleSource, /Stato: \{row\.kind\}/);
  assert.match(moduleSource, /row\.kind === 'unjustified' \? 'ingiustificato' : 'ferie'/);
  assert.match(moduleSource, /formatMinutes\(worked - expected\)/);
  assert.match(moduleSource, /Dettaglio presenze/);
  assert.match(moduleSource, /Entrata:/);
  assert.match(moduleSource, /Motivazione:/);
  assert.match(moduleSource, /Consuntivi presenze/);
  assert.match(moduleSource, /option value="week">Settimana/);
  assert.match(moduleSource, /option value="month">Mese/);
  assert.match(moduleSource, /option value="custom">Date selezionate/);
  assert.match(moduleSource, /role="button" tabIndex=\{0\}/);
  assert.match(moduleSource, /page === 'company-calendar' && calendarView === 'week'/);
  assert.match(moduleSource, /page === 'company-calendar' && <section className="hr-panel hr-attendance-report"/);
  assert.match(moduleSource, /setCalendarView\('month'\)/);\n  assert.match(moduleSource, /<CompanyCalendar snapshot=\{data\} month=\{month\}/);\n  assert.match(moduleSource, /onViewChange=\{setCalendarView\}/);\n  assert.match(moduleSource, /Vista mensile/);\n  assert.doesNotMatch(moduleSource, /Calendario presenze mensile/);\n  assert.doesNotMatch(moduleSource, /false && page === 'calendar'/);\n  assert.match(moduleSource, /page === 'company-calendar' && calendarView === 'month'/);\n  assert.match(moduleSource, /aria-pressed=\{true\} onClick=\{\(\) => setCalendarView\('week'\)\}/);\n  assert.match(moduleSource, /aria-pressed=\{false\} onClick=\{\(\) => setCalendarView\('month'\)\}/);\n  const companyCalendar = fs.readFileSync('src/modules/hr/CompanyCalendar.jsx', 'utf8');\n  assert.match(companyCalendar, /Calendario aziendale · vista mensile/);\n  assert.match(companyCalendar, /onViewChange\?\.\('week'\)/);\n  assert.match(companyCalendar, /onViewChange\?\.\('month'\)/);\n  assert.match(companyCalendar, /monthDays\(month\)/);
  assert.match(companyCalendar, /ABSENCE_LABELS/);
  assert.match(companyCalendar, /Maternità/);
  assert.match(moduleSource, /Ore in più/);
  assert.match(moduleSource, /Ore in meno/);
  assert.match(styles, /\.hr-week-person\{[^}]*display:flex/);
  assert.match(styles, /white-space:nowrap/);
  assert.match(styles, /@media\(max-width:700px\)/);
});

test('weekly HR calendar keeps all person/status content while using compact spacing', () => {
  assert.match(moduleSource, /Calendario aziendale · vista settimanale/);
  assert.match(moduleSource, /Presenti/);
  assert.match(moduleSource, /Assenti/);
  assert.match(moduleSource, /Assegna turno/);
  assert.match(styles, /\.hr-week-day\{[^}]*padding:10px;min-height:250px/);
  assert.match(styles, /\.hr-week-person\{[^}]*padding:5px 0/);
});

test('PWA cache namespace is rotated with the published HR shell', () => {
  assert.match(viteConfig, /cacheId: "workspace-assets-v3"/);
  assert.match(viteConfig, /cleanupOutdatedCaches: true/);
});
