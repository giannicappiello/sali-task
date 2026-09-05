import { useEffect, useMemo, useState } from "react";
import { Plus, Save, Search, X } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabaseClient";
import WorkspaceCustomerPicker from "./WorkspaceCustomerPicker";

const emptyForm = { titolo: "", descrizione: "", deadline: "", prodotti: [], reparti: [], tipo_progetto_id: "", crm_customer_key: "" };
const subtractDaysIso = (dateValue, days) => {
  const [year, month, day] = String(dateValue).slice(0, 10).split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() - Number(days || 0));
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

export default function WorkspaceProjectCreateDialog({ open, crmType, initialCustomerKey = "", onClose, onSaved }) {
  const { profile, hasPermission } = useAuth();
  const actorId = profile?.id || null;
  const canManage = hasPermission("projects.write");
  const [form, setForm] = useState(emptyForm);
  const [data, setData] = useState({ products: [], departments: [], templates: [], templateDepartments: [], projectTypes: [], projectTypePhases: [] });
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    const timer = window.setTimeout(async () => {
      setForm({ ...emptyForm, crm_customer_key: initialCustomerKey });
      setQuery("");
      const results = await Promise.all([
        supabase.from("prodotti").select("id,nome,codice,brand,categoria").order("nome").limit(5000),
        supabase.from("reparti").select("id,nome,attivo").eq("attivo", true).order("nome"),
        supabase.from("checklist_template").select("id,titolo,reparto_id,attivo").eq("attivo", true).order("ordine"),
        supabase.from("checklist_template_reparti").select("template_id,reparto_id"),
        supabase.from("tipi_progetto").select("id,nome,attivo").eq("attivo", true).order("nome"),
        supabase.from("tipo_progetto_fasi").select("id,tipo_progetto_id,template_id,giorni_anticipo,ordine,responsabile_id,dipende_da_id,priorita").order("ordine"),
      ]);
      if (!active) return;
      const error = results.find((result) => result.error)?.error;
      if (error) { window.alert(error.message); return; }
      setData({ products: results[0].data || [], departments: results[1].data || [], templates: results[2].data || [], templateDepartments: results[3].data || [], projectTypes: results[4].data || [], projectTypePhases: results[5].data || [] });
    }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [initialCustomerKey, open]);

  const filteredProducts = useMemo(() => {
    const text = query.trim().toLocaleLowerCase("it-IT");
    return text ? data.products.filter((product) => `${product.nome || ""} ${product.codice || ""} ${product.brand || ""}`.toLocaleLowerCase("it-IT").includes(text)) : data.products;
  }, [data.products, query]);

  const toggle = (field, value) => setForm((current) => ({ ...current, [field]: current[field].includes(value) ? current[field].filter((item) => item !== value) : [...current[field], value] }));
  const templateDepartments = (templateId) => {
    const linked = data.templateDepartments.filter((row) => row.template_id === templateId).map((row) => row.reparto_id);
    if (linked.length) return linked;
    return [data.templates.find((item) => item.id === templateId)?.reparto_id].filter(Boolean);
  };

  async function save(event) {
    event.preventDefault();
    if (!canManage) return window.alert("Non hai i permessi per creare progetti.");
    if (!form.titolo.trim() || !form.crm_customer_key || !form.tipo_progetto_id || !form.deadline) return window.alert("Compila titolo, cliente, tipo progetto e deadline.");
    setSaving(true);
    try {
      const rules = data.projectTypePhases.filter((row) => row.tipo_progetto_id === form.tipo_progetto_id).toSorted((a, b) => Number(a.ordine || 0) - Number(b.ordine || 0));
      const automaticDepartments = rules.flatMap((rule) => templateDepartments(rule.template_id));
      const departments = [...new Set([...form.reparti, ...automaticDepartments].filter(Boolean))];
      const { data: project, error } = await supabase.from("v4_progetti").insert({ titolo: form.titolo.trim(), descrizione: form.descrizione.trim() || null, deadline: form.deadline, tipo_progetto_id: form.tipo_progetto_id, crm_customer_key: form.crm_customer_key, stato: "aperto", creato_da: actorId, modificato_da: actorId }).select("id").single();
      if (error) throw error;
      if (form.prodotti.length) {
        const { error: productsError } = await supabase.from("v4_progetto_prodotti").insert(form.prodotti.map((prodotto_id) => ({ progetto_id: project.id, prodotto_id, prodotto_nome: data.products.find((item) => item.id === prodotto_id)?.nome || null })));
        if (productsError) throw productsError;
      }
      if (departments.length) {
        const { error: departmentsError } = await supabase.from("v4_progetto_reparti").insert(departments.map((reparto_id) => ({ progetto_id: project.id, reparto_id })));
        if (departmentsError) throw departmentsError;
      }
      const createdByRule = new Map();
      let previousPhaseId = null;
      for (const [index, rule] of rules.entries()) {
        const template = data.templates.find((item) => item.id === rule.template_id);
        if (!template) continue;
        const phaseDepartments = templateDepartments(template.id);
        const blockingId = rule.dipende_da_id ? createdByRule.get(rule.dipende_da_id) || null : previousPhaseId;
        const { data: phase, error: phaseError } = await supabase.from("v4_fasi_progetto").insert({ progetto_id: project.id, titolo: template.titolo, reparto_id: phaseDepartments[0] || null, stato: blockingId ? "bloccata" : "da_evadere", priorita: rule.priorita || "normale", assegnato_a: rule.responsabile_id || null, bloccante_id: blockingId, ordine: Number(rule.ordine || index + 1), deadline: subtractDaysIso(form.deadline, rule.giorni_anticipo), creato_da: actorId, modificato_da: actorId, crm_customer_key: form.crm_customer_key }).select("id").single();
        if (phaseError) throw phaseError;
        if (phaseDepartments.length) {
          const { error: phaseDepartmentsError } = await supabase.from("v4_fase_reparti").insert(phaseDepartments.map((reparto_id) => ({ fase_id: phase.id, reparto_id, completato: false })));
          if (phaseDepartmentsError) throw phaseDepartmentsError;
        }
        if (form.prodotti.length) {
          const { error: phaseProductsError } = await supabase.from("v4_fase_prodotti").insert(form.prodotti.map((prodotto_id) => ({ fase_id: phase.id, prodotto_id, prodotto_nome: data.products.find((item) => item.id === prodotto_id)?.nome || null })));
          if (phaseProductsError) throw phaseProductsError;
        }
        createdByRule.set(rule.id, phase.id);
        previousPhaseId = phase.id;
      }
      const { error: auditError } = await supabase.from("v4_audit_log").insert({ entity_type: "progetto", entity_id: project.id, azione: "creazione progetto", dettagli: { testo: form.titolo.trim() }, user_id: actorId });
      if (auditError) throw auditError;
      onSaved?.();
      onClose?.();
    } catch (error) {
      window.alert(error.message || "Errore durante la creazione del progetto.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;
  return <div className="modal-backdrop"><form className="modal-card v4-modal" onSubmit={save}>
    <div className="modal-header"><h2>Nuovo progetto</h2><button type="button" onClick={onClose}><X size={20} /></button></div>
    <label>Titolo<input required value={form.titolo} onChange={(event) => setForm({ ...form, titolo: event.target.value })} /></label>
    <label>Descrizione<textarea rows="4" value={form.descrizione} onChange={(event) => setForm({ ...form, descrizione: event.target.value })} /></label>
    <label>Cliente<WorkspaceCustomerPicker required crmType={crmType} value={form.crm_customer_key} onChange={(crm_customer_key) => setForm((current) => ({ ...current, crm_customer_key }))} /></label>
    <label>Tipo progetto<select required value={form.tipo_progetto_id} onChange={(event) => setForm({ ...form, tipo_progetto_id: event.target.value })}><option value="">Seleziona tipo progetto</option>{data.projectTypes.map((type) => <option key={type.id} value={type.id}>{type.nome}</option>)}</select></label>
    <label>Deadline<input required type="date" value={form.deadline} onChange={(event) => setForm({ ...form, deadline: event.target.value })} /></label>
    <div className="checkbox-group scrollable-check-group"><strong>Prodotti associati</strong><div className="task-search"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ricerca rapida prodotto" /></div>{filteredProducts.map((product) => <label key={product.id}><input type="checkbox" checked={form.prodotti.includes(product.id)} onChange={() => toggle("prodotti", product.id)} />{product.nome}{product.codice ? ` · ${product.codice}` : ""}</label>)}</div>
    <div className="checkbox-group"><strong>Reparti associati</strong>{data.departments.map((department) => <label key={department.id}><input type="checkbox" checked={form.reparti.includes(department.id)} onChange={() => toggle("reparti", department.id)} />{department.nome}</label>)}</div>
    <button className="primary-action" disabled={saving}>{saving ? <Save size={18} /> : <Plus size={18} />}{saving ? "Salvataggio..." : "Crea progetto"}</button>
  </form></div>;
}
