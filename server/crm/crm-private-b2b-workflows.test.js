import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CRM_ROUTE_CATALOG } from "../../src/modules/crm/crmRouteCatalog.js";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20260903100000_crm_private_b2b_workflows.sql");
const crm = read("src/modules/crm/CrmModule.jsx");
const opportunity = read("src/modules/crm/CrmOpportunityDetail.jsx");
const activities = read("src/modules/crm/CrmActivitiesPage.jsx");
const analytics = read("src/modules/crm/CrmAnalyticsPage.jsx");
const navigation = read("src/modules/crm/crmNavigation.js");
const beauty = read("src/modules/crm/CrmBeautyDays.jsx");
const edge = read("supabase/functions/report-giornate-api/index.ts");
const ai = read("server/ai/crm-brief.js");

test("CRM Core aggiunge solo strutture additive, configurabili e protette", () => {
  assert.match(migration, /create table if not exists public\.crm_workflow_settings/);
  assert.match(migration, /create table if not exists public\.crm_loss_reasons/);
  assert.match(migration, /add column if not exists probabilita_default/);
  assert.match(migration, /add column if not exists soglia_aging_giorni/);
  assert.doesNotMatch(migration, /drop table|truncate table|delete from public\.crm_/i);
  assert.match(migration, /crm_has_module_level\(public\.crm_module_for_type\(crm_tipo\), 'amministrazione'\)/);
});

test("chiusura opportunità e completamento attività sono atomici e auditati", () => {
  assert.match(migration, /crm_transition_opportunity/);
  assert.match(migration, /Il motivo della perdita e obbligatorio/);
  assert.match(migration, /when v_stage\.vinta then 100 when v_stage\.finale then 0/);
  assert.match(migration, /crm_complete_activity/);
  assert.match(migration, /next_activity_id/);
  assert.match(migration, /insert into public\.crm_audit_log/);
  assert.match(opportunity, /Completa e pianifica/);
});

test("PRIVATE e B2B hanno scheda opportunità, attività e analisi dedicate", () => {
  for (const type of ["conto_terzi", "b2b"]) {
    assert.ok(CRM_ROUTE_CATALOG.some((route) => route.type === type && route.view === "opportunity"));
    assert.ok(CRM_ROUTE_CATALOG.some((route) => route.type === type && route.view === "activities"));
    assert.ok(CRM_ROUTE_CATALOG.some((route) => route.type === type && route.view === "analytics"));
  }
  assert.match(crm, /nextStepFilter/);
  assert.match(activities, /Senza scadenza/);
  assert.match(analytics, /Conversione/);
  assert.match(analytics, /crm_opportunity_analytics/);
  assert.match(migration, /create or replace function public\.crm_opportunity_analytics/);
  assert.doesNotMatch(analytics, /limit\(5000\)/);
});

test("snapshot B2B usa ordini deduplicati e parametri per riordino e rischio", () => {
  assert.match(migration, /from public\.crm_order_kpi_source/);
  for (const classification of ["prospect", "primo_ordine", "riordino", "a_rischio", "dormiente", "perso"]) assert.match(migration, new RegExp(`'${classification}'`));
  assert.match(migration, /average_days/);
  assert.match(crm, /Frequenza media ordini/);
  assert.match(crm, /Prossimo riordino atteso/);
});

test("il brief PRIVATE espone i campi strutturati già presenti nello schema", () => {
  for (const field of ["brand", "tipo_prodotto", "posizionamento", "prezzo_target", "quantita", "packaging", "claim", "mercati", "certificazioni", "tempistiche"]) {
    assert.match(crm, new RegExp(`['\"]${field}['\"]`));
  }
  assert.match(crm, /opportunity_id/);
  assert.match(navigation, /Attività/);
  assert.match(navigation, /Analisi/);
});

test("BeautyDays riusa sorgente reale e mapping canonico senza copia dati", () => {
  assert.match(edge, /beauty_clienti_mexal/);
  assert.match(edge, /giornate_promozionali/);
  assert.match(edge, /vendite_prodotti/);
  assert.match(edge, /crm_order_kpi_source/);
  assert.match(edge, /mexal_fatture_vendita/);
  assert.match(beauty, /crm-beauty-customer/);
  assert.match(beauty, /crm-beauty-dashboard/);
  assert.doesNotMatch(migration, /create table.*beauty.*event/i);
});

test("AI riceve solo contesto CRM autorizzato e conserva approvazione umana", () => {
  assert.match(ai, /crm_account_commercial_snapshot/);
  assert.match(ai, /crm_account_journey/);
  assert.match(ai, /non eseguire aggiornamenti CRM senza approvazione umana esplicita/i);
  assert.match(ai, /applyPlan/);
});
