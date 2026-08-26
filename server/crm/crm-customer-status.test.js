import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20260825120000_crm_customer_status.sql");
const crm = read("src/modules/crm/CrmModule.jsx");
const link = read("src/modules/crm/CrmCustomerLink.jsx");
const identity = read("src/modules/crm/crmCustomerIdentity.js");
const status = read("src/modules/crm/CrmCustomerStatus.jsx");
const statusModel = read("src/modules/crm/crmCustomerStatusModel.js");
const classification = read("src/modules/crm/CustomerClassificationPanel.jsx");
const workspaceUi = read("src/modules/crm/CrmWorkspaceUI.jsx");
const workspaceCss = read("src/modules/crm/workspace-alignment.css");
const config = read("src/modules/crm/crmConfig.js");
const routeCatalog = read("src/modules/crm/crmRouteCatalog.js");
const periodFilter = read("src/modules/crm/CrmPeriodFilter.jsx");
const digital = read("src/modules/crm/DigitalCommerce.jsx");

test("lo stato CRM è additivo, canonico e separato dall'anagrafica Mexal", () => {
  assert.match(migration, /create table if not exists public\.crm_customer_status/);
  assert.match(migration, /crm_active boolean not null default true/);
  assert.match(migration, /customer_key ~ '\^mexal:/);
  assert.match(migration, /customer_key ~ '\^crm:/);
  assert.match(migration, /customer\.attivo_mexal/);
  assert.doesNotMatch(migration, /update\s+public\.ordini_clienti_cache/i);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.(?:ordini_clienti_cache|crm_accounts)/i);
});

test("disattivazione e riattivazione richiedono scrittura e producono audit", () => {
  assert.match(migration, /crm_has_module_level\(public\.crm_module_for_type\(p_crm_type\), 'scrittura'\)/);
  assert.match(migration, /insert into public\.crm_audit_log/);
  assert.match(migration, /customer_deactivated/);
  assert.match(migration, /customer_reactivated/);
  assert.match(migration, /changed_at/);
  assert.match(migration, /changed_by/);
  assert.match(migration, /reason/);
  assert.match(migration, /alter table public\.crm_customer_status enable row level security/);
  assert.match(migration, /grant select on public\.crm_customer_status to authenticated/);
  assert.doesNotMatch(migration, /grant (?:insert|update|delete|all) on public\.crm_customer_status to authenticated/i);
});

test("il link cliente unico costruisce route canoniche e preserva la query string", () => {
  assert.match(identity, /if \(customerCode\) return `mexal:\$\{customerCode\}`/);
  assert.match(identity, /if \(accountId\) return `crm:\$\{accountId\}`/);
  assert.match(identity, /basePath}\/clienti\/\$\{encodeURIComponent\(key\)\}/);
  assert.match(link, /period\.withPeriod\(path\)/);
  assert.match(link, /location\.search/);
  assert.match(link, /aria-label=\{`Apri scheda cliente/);
  for (const route of ["/crm/conto-terzi", "/crm/b2b", "/crm/online"]) assert.ok(config.includes(route));
  assert.match(crm, /<CrmCustomerLink/);
  assert.match(classification, /<CrmCustomerLink/);
});

test("ricerca, pagina, stato e contesto restano nella query string tornando dal cliente", () => {
  assert.match(crm, /searchParams\.get\("customerSearch"\)/);
  assert.match(crm, /searchParams\.get\("customerPage"\)/);
  assert.match(crm, /pipelineParams\.get\("search"\)/);
  assert.match(crm, /pipelineParams\.get\("stage"\)/);
  assert.match(classification, /searchParams\.get\("classification_page"\)/);
  assert.doesNotMatch(periodFilter, /withPeriod[\s\S]*params\.delete\("page"\)/);
  assert.match(link, /state=\{\{ from:/);
});

test("Pipeline, Brief e Customer Journey usano il link cliente condiviso", () => {
  assert.match(crm, /function Pipeline[\s\S]*<CrmCustomerLink/);
  assert.match(crm, /function BriefsPage[\s\S]*<CrmCustomerLink/);
  assert.match(digital, /function DigitalJourney[\s\S]*<CrmCustomerLink/);
  assert.match(digital, /crm_accounts\(id,nome,codice_cliente_mexal\)/);
  assert.match(digital, /searchParams\.get\("journeyPage"\)/);
});

test("filtri active inactive all persistono nella query string con default operativo active", () => {
  for (const value of ["active", "inactive", "all"]) assert.ok(statusModel.includes(`["${value}",`));
  assert.match(statusModel, /searchParams\.get\("customerStatus"\)/);
  assert.match(statusModel, /params\.set\("customerStatus", next\)/);
  assert.match(crm, /useCrmCustomerStatus\("active"\)/);
  assert.match(classification, /useCrmCustomerStatus\("all"\)/);
  assert.match(migration, /p_customer_status text/);
  assert.match(migration, /count\(\*\) over\(\)::bigint total_count/);
});

test("gli elenchi clienti restano nelle schermate Clienti e non appesantiscono le dashboard", () => {
  assert.doesNotMatch(crm, /function CrmDashboardCustomerList\(\{ type, period \}\)/);
  assert.match(crm, /p_crm_type: type/);
  assert.match(crm, /crm_customer_status_counts/);
  assert.doesNotMatch(crm, /<CrmDashboardCustomerList/);
  assert.match(crm, /case "online-home": return <DigitalHome \/>/);
  assert.match(routeCatalog, /path: "conto-terzi"[^\n]+view: "dashboard"[^\n]+type: "conto_terzi"/);
  assert.match(routeCatalog, /path: "b2b"[^\n]+view: "dashboard"[^\n]+type: "b2b"/);
  assert.match(routeCatalog, /path: "online"[^\n]+view: "online-home"/);
  assert.match(crm, /crm_prospect_customer_details/);
  assert.match(crm, /function AccountsPage\(\{ type \}\)/);
});

test("KPI e tabelle distinguono stato CRM da inattività commerciale", () => {
  assert.match(crm, /Clienti CRM attivi/);
  assert.match(crm, /Clienti CRM non attivi/);
  assert.match(crm, /Clienti senza attività nel periodo/);
  assert.match(crm, /non è lo stato CRM/);
  assert.match(crm, /<CrmCustomerStatusBadge active=/);
  assert.match(crm, /customerStatus: "active"/);
  assert.match(crm, /customerStatus: "inactive"/);
  assert.match(crm, /customerStatus: "all"/);
});

test("la scheda conserva storico e usa conferma esplicita per cambiare stato", () => {
  assert.match(status, /ordini, fatture, opportunità, attività e documenti/);
  assert.match(status, /Non verrà eliminato nulla/);
  assert.match(crm, /<CrmCustomerStatusDialog/);
  assert.match(crm, /crm_customer_period_metrics/);
  assert.match(crm, /related\.activities/);
  assert.match(crm, /related\.opportunities/);
  assert.match(crm, /related\.orders/);
  assert.match(crm, /related\.invoices/);
});

test("layout e interazioni riusano i componenti e i breakpoint Workspace", () => {
  assert.match(workspaceUi, /className="panel crm-panel crm-page-header"/);
  assert.match(workspaceUi, /crm-section-nav/);
  assert.match(crm, /<CrmPageHeader/);
  assert.match(crm, /<CrmSectionNav/);
  assert.match(crm, /className="kpi-card crm-kpi/);
  assert.match(workspaceCss, /\.crm-customer-link:focus-visible/);
  assert.match(workspaceCss, /\.crm-kpi:focus-visible/);
  assert.match(workspaceCss, /\.crm-kpi-grid\{grid-template-columns:repeat\(auto-fit/);
  for (const breakpoint of [1024, 768, 390]) assert.match(workspaceCss, new RegExp(`@media\\(max-width:${breakpoint}px\\)`));
});
