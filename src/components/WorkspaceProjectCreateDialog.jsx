import { createSaveOutcome } from "../save-outcomes.js";
import { isCustomerRecordScope } from '../lib/customerRecordAccess.js';
import { useEffect, useState } from "react";
import { Save, X } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabaseClient";
import { loadDirectProductCatalog } from "../modules/orders/services/directProductCatalog";
import { loadWorkspaceProducts, loadDirectWorkspaceProducts } from "../lib/workspaceCrmCatalog";
import { matchesCrmCompetency, projectRulesForCrm, resolveRuleBlocker } from "../lib/crmCompetencies";
import useCustomerWorkspaceProducts from "../lib/useCustomerWorkspaceProducts";
import "./workspace-project-dialog.css";
import WorkspaceCustomerPicker from "./WorkspaceCustomerPicker";

const emptyForm = { titolo: "", descrizione: "", deadline: "", prodotti: [], reparti: [], tipo_progetto_id: "", crm_customer_key: "" };
const subtractDaysIso = (dateValue, days) => {
  const [year, month, day] = String(dateValue).slice(0, 10).split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() - Number(days || 0));
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

export default function WorkspaceProjectCreateDialog({ open, crmType, initialCustomerKey = "", onClose, onSaved }) {
  const { profile, authUser, hasPermission, dataScope } = useAuth();
  const actorId = profile?.id || null;
  const auditActorId = authUser?.id || null;
  const canManage = !isCustomerRecordScope(dataScope) && hasPermission("projects.write");
  const [form, setForm] = useState(emptyForm);
  const [data, setData] = useState({ products: [], departments: [], templates: [], templateDepartments: [], projectTypes: [], projectTypePhases: [] });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    const timer = window.setTimeout(async () => {
      setForm({ ...emptyForm, crm_customer_key: initialCustomerKey });
      const productsRequest = crmType === "b2b" ? loadDirectWorkspaceProducts(supabase) : crmType === "brand_direct"
        ? loadDirectProductCatalog(supabase)
          .then(({ products, implants }) => ({
            data: [
              ...products.map((product) => ({
                ...product,
                codice: product.codice_mexal || product.codice_articolo || product.codice,
                catalogSource: "mexal",
              })),
              ...implants.map((implant) => ({
                ...implant,
                nome: implant.descrizione,
                codice: implant.codice,
                brand: "DIRECT",
                categoria: "Impianto",
                catalogSource: "impianto",
              })),
            ].sort((left, right) => String(left.codice || "").localeCompare(String(right.codice || ""), "it-IT")),
            error: null,
          }))
          .catch((error) => ({ data: [], error }))
        : loadWorkspaceProducts(supabase);
      const results = await Promise.all([
        productsRequest,
        supabase.from("reparti").select("id,nome,attivo").eq("attivo", true).order("nome"),
        supabase.from("checklist_template").select("id,titolo,reparto_id,attivo,competenze_crm").eq("attivo", true).order("ordine"),
        supabase.from("checklist_template_reparti").select("template_id,reparto_id"),
        supabase.from("tipi_progetto").select("id,nome,attivo,competenze_crm").eq("attivo", true).order("nome"),
        supabase.from("tipo_progetto_fasi").select("id,tipo_progetto_id,template_id,giorni_anticipo,ordine,responsabile_id,dipende_da_id,priorita,obbligatoria,durata_giorni").order("ordine"),
      ]);
      if (!active) return;
      const error = results.find((result) => result.error)?.error;
      if (error) { window.alert(error.message); return; }
      setData({ products: results[0].data || [], departments: results[1].data || [], templates: results[2].data || [], templateDepartments: results[3].data || [], projectTypes: results[4].data || [], projectTypePhases: results[5].data || [] });
    }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [crmType, initialCustomerKey, open]);

  const customerProducts = useCustomerWorkspaceProducts(data.products, form.crm_customer_key, crmType, open);
  const templateDepartments = (templateId) => {
    const linked = data.templateDepartments.filter((row) => row.template_id === templateId).map((row) => row.reparto_id);
    if (linked.length) return linked;
    return [data.templates.find((item) => item.id === templateId)?.reparto_id].filter(Boolean);
  };

  async function save(event) {
    const _saveOutcome = createSaveOutcome();
    try {

    event.preventDefault();
    if (!canManage) return (window.alert(_saveOutcome.observeFailure("Non hai i permessi per creare progetti.")));
    if (!form.titolo.trim() || !form.crm_customer_key || !form.tipo_progetto_id || !form.deadline) return (window.alert(_saveOutcome.observeFailure("Compila titolo, cliente, tipo progetto e deadline.")));
    if (!data.projectTypes.some((item) => item.id === form.tipo_progetto_id && matchesCrmCompetency(item, crmType))) return (window.alert(_saveOutcome.observeFailure("Tipo progetto non disponibile in questa sezione CRM.")));
    if (customerProducts.loading || customerProducts.error || form.prodotti.some(id => !customerProducts.products.some(p => p.id === id))) return (window.alert(_saveOutcome.observeFailure("Verifica i prodotti associati al cliente prima di salvare.")));
    setSaving(true);
    try {
      const rules = projectRulesForCrm(data.projectTypePhases, data.templates, form.tipo_progetto_id, crmType);
      const automaticDepartments = rules.flatMap((rule) => templateDepartments(rule.template_id));
      const departments = [...new Set([...form.reparti, ...automaticDepartments].filter(Boolean))];
      const { data: project, error } = await supabase.from("v4_progetti").insert({ titolo: form.titolo.trim(), descrizione: form.descrizione.trim() || null, deadline: form.deadline, tipo_progetto_id: form.tipo_progetto_id, crm_customer_key: form.crm_customer_key, crm_tipo: crmType || null, stato: "aperto", creato_da: actorId, modificato_da: actorId }).select("id").single();
    _saveOutcome.failure(error);

      if (error) throw error;
      if (form.prodotti.length) {
        const { error: productsError } = await supabase.from("v4_progetto_prodotti").insert(form.prodotti.map((prodotto_id) => ({ progetto_id: project.id, prodotto_id, prodotto_nome: data.products.find((item) => item.id === prodotto_id)?.nome || null })));
    _saveOutcome.failure(productsError);

        if (productsError) throw productsError;
      }
      if (departments.length) {
        const { error: departmentsError } = await supabase.from("v4_progetto_reparti").insert(departments.map((reparto_id) => ({ progetto_id: project.id, reparto_id })));
    _saveOutcome.failure(departmentsError);

        if (departmentsError) throw departmentsError;
      }
      const createdByRule = new Map();
      let previousPhaseId = null;
      for (const [index, rule] of rules.entries()) {
        const template = data.templates.find((item) => item.id === rule.template_id);
        if (!template) continue;
        const phaseDepartments = templateDepartments(template.id);
        const blockingId = resolveRuleBlocker(rule, data.projectTypePhases, createdByRule, previousPhaseId);
        const { data: phase, error: phaseError } = await supabase.from("v4_fasi_progetto").insert({ progetto_id: project.id, template_id: template.id, durata_giorni: rule.durata_giorni || 1, obbligatoria: rule.obbligatoria !== false, crm_tipo: crmType || null, titolo: template.titolo, reparto_id: phaseDepartments[0] || null, stato: blockingId ? "bloccata" : "da_evadere", priorita: rule.priorita || "normale", assegnato_a: rule.responsabile_id || null, bloccante_id: blockingId, ordine: Number(rule.ordine || index + 1), deadline: subtractDaysIso(form.deadline, rule.giorni_anticipo), creato_da: actorId, modificato_da: actorId, crm_customer_key: form.crm_customer_key }).select("id").single();
    _saveOutcome.failure(phaseError);

        if (phaseError) throw phaseError;
        if (phaseDepartments.length) {
          const { error: phaseDepartmentsError } = await supabase.from("v4_fase_reparti").insert(phaseDepartments.map((reparto_id) => ({ fase_id: phase.id, reparto_id, completato: false })));
    _saveOutcome.failure(phaseDepartmentsError);

          if (phaseDepartmentsError) throw phaseDepartmentsError;
        }
        if (form.prodotti.length) {
          const { error: phaseProductsError } = await supabase.from("v4_fase_prodotti").insert(form.prodotti.map((prodotto_id) => ({ fase_id: phase.id, prodotto_id, prodotto_nome: data.products.find((item) => item.id === prodotto_id)?.nome || null })));
    _saveOutcome.failure(phaseProductsError);

          if (phaseProductsError) throw phaseProductsError;
        }
        createdByRule.set(rule.id, phase.id);
        previousPhaseId = phase.id;
      }
      if (auditActorId) {
        const { error: auditError } = await supabase.from("v4_audit_log").insert({ entity_type: "progetto", entity_id: project.id, azione: "creazione progetto", dettagli: { testo: form.titolo.trim() }, user_id: auditActorId });
    _saveOutcome.failure(auditError);

        if (auditError) console.error("Errore registrazione audit creazione progetto:", auditError);
      }
      onSaved?.();
      onClose?.();
    } catch (error) {
      _saveOutcome.failure(error);

      (window.alert(_saveOutcome.observeFailure(error.message || "Errore durante la creazione del progetto.")));
    } finally {
      setSaving(false);
    }

      _saveOutcome.success();
    } catch (_saveError) { _saveOutcome.failure(_saveError); throw _saveError; }
}

  if (!open) return null;
  const selection = (label, field, options, disabled = false, placeholder = 'Seleziona') => <div className="project-selection">
    <label>{label}<select aria-label={label} value="" disabled={disabled} onChange={event => { const id = event.target.value; if (id) setForm(current => ({ ...current, [field]: [...new Set([...current[field], id])] })); }}>
      <option value="">{placeholder}</option>{options.filter(item => !form[field].includes(item.id)).map(item => <option key={item.id} value={item.id}>{item.nome}{item.codice ? ` · ${item.codice}` : ''}</option>)}
    </select></label>
    {form[field].length > 0 && <div className="project-selected-values">{form[field].map(id => { const item = options.find(option => option.id === id); return <span key={id}>{item?.nome || id}<button type="button" aria-label={`Rimuovi ${item?.nome || label}`} onClick={() => setForm(current => ({ ...current, [field]: current[field].filter(value => value !== id) }))}><X size={13}/></button></span>; })}</div>}
  </div>;
  return <div className="modal-backdrop"><form className="modal-card v4-modal workspace-project-dialog" onSubmit={save}>
    <div className="modal-header"><h2>Nuovo progetto</h2><button type="button" aria-label="Chiudi nuovo progetto" onClick={onClose}><X size={20} /></button></div>
    <div className="project-dialog-columns">
      <fieldset><legend>Cliente e prodotto</legend>
        <label>Cliente<WorkspaceCustomerPicker required crmType={crmType} value={form.crm_customer_key} onChange={(crm_customer_key) => setForm((current) => ({ ...current, crm_customer_key, prodotti: [] }))} /></label>
        {selection('Prodotto', 'prodotti', customerProducts.products, !form.crm_customer_key || customerProducts.loading || Boolean(customerProducts.error), !form.crm_customer_key ? 'Seleziona prima il cliente' : customerProducts.loading ? 'Caricamento prodotti…' : 'Seleziona prodotto')}
        {customerProducts.error && <p role="alert">{customerProducts.error}</p>}
        {form.crm_customer_key && !customerProducts.loading && !customerProducts.error && !customerProducts.products.length && <small>Nessun prodotto associato al cliente.</small>}
        <label>Deadline<input required type="date" value={form.deadline} onChange={(event) => setForm({ ...form, deadline: event.target.value })} /></label>
      </fieldset>
      <fieldset><legend>Progetto</legend>
        <label>Tipo progetto<select required value={form.tipo_progetto_id} onChange={(event) => setForm({ ...form, tipo_progetto_id: event.target.value })}><option value="">Seleziona tipo progetto</option>{data.projectTypes.filter((item) => matchesCrmCompetency(item, crmType)).map((type) => <option key={type.id} value={type.id}>{type.nome}</option>)}</select></label>
        <label>Titolo<input required value={form.titolo} onChange={(event) => setForm({ ...form, titolo: event.target.value })} /></label>
        <label>Descrizione<textarea rows="3" value={form.descrizione} onChange={(event) => setForm({ ...form, descrizione: event.target.value })} /></label>
      </fieldset>
    </div>
    <footer className="project-dialog-actions" data-assistant-actions><button className="primary-action" disabled={saving}><Save size={18} />{saving ? "Salvataggio..." : "Salva"}</button></footer>
  </form></div>;
}
