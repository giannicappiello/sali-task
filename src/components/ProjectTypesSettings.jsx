import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import CrmCompetencies, { CrmCompetencyBadges } from "./CrmCompetencies";
import "./project-settings.css";

const emptyType = { nome: "", descrizione: "", attivo: true, competenze_crm: [] };
const emptyRule = { template_id: "", giorni_anticipo: 0, ordine: 1, obbligatoria: true, responsabile_id: "", dipende_da_id: "", durata_giorni: 1, priorita: "normale" };
export default function ProjectTypesSettings({ canManage = false, searchTerm = "", checklistPanel, onTemplatesChanged }) {
  const [types, setTypes] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [rules, setRules] = useState([]);
  const [users, setUsers] = useState([]);
  const [selectedType, setSelectedType] = useState(null);
  const [typeModal, setTypeModal] = useState(false);
  const [ruleModal, setRuleModal] = useState(false);
  const [typeForm, setTypeForm] = useState(emptyType);
  const [ruleForm, setRuleForm] = useState(emptyRule);
  const [editingRule, setEditingRule] = useState(null);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("types");
  const [error, setError] = useState("");
  const [editingTypeId, setEditingTypeId] = useState(null);
  const [ruleCompetencies, setRuleCompetencies] = useState([]);

  useEffect(() => {
    loadData();
    // Il caricamento iniziale non deve ripetersi quando cambia il tipo selezionato.
  }, []);

  async function loadData() {
    const [typesRes, templatesRes, rulesRes, usersRes] = await Promise.all([
      supabase.from("tipi_progetto").select("*").order("nome"),
      supabase.from("checklist_template").select("id,titolo,attivo,competenze_crm").eq("attivo", true).order("ordine", { ascending: true }),
      supabase.from("tipo_progetto_fasi").select("*").order("ordine", { ascending: true }),
      supabase.from("utenti").select("id,nome,cognome").eq("attivo", true).order("nome"),
    ]);
    if (typesRes.error) console.error(typesRes.error.message);
    if (templatesRes.error) console.error(templatesRes.error.message);
    if (rulesRes.error) console.error(rulesRes.error.message);
    if (usersRes.error) console.error(usersRes.error.message);
    const loadedTypes = typesRes.data || [];
    setTypes(loadedTypes);
    setTemplates(templatesRes.data || []);
    setRules(rulesRes.data || []);
    setUsers(usersRes.data || []);
    setSelectedType((current) => loadedTypes.find((item) => item.id === current?.id) || loadedTypes[0] || null);
  }

  const selectedRules = useMemo(
    () => rules.filter((row) => row.tipo_progetto_id === selectedType?.id).sort((a, b) => Number(a.ordine || 0) - Number(b.ordine || 0)),
    [rules, selectedType?.id]
  );
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const filteredTypes = useMemo(() => types.filter((item) => !normalizedSearch || `${item.nome || ""} ${item.descrizione || ""}`.toLowerCase().includes(normalizedSearch)), [types, normalizedSearch]);
  const filteredRules = useMemo(() => selectedRules.filter((rule) => {
    const name = templates.find((item) => item.id === rule.template_id)?.titolo || "";
    return !normalizedSearch || `${name} ${rule.giorni_anticipo || ""} ${rule.ordine || ""}`.toLowerCase().includes(normalizedSearch);
  }), [selectedRules, templates, normalizedSearch]);

  function templateName(id) {
    return templates.find((item) => item.id === id)?.titolo || "Fase non disponibile";
  }

  function openNewType() {
    setTypeForm(emptyType);
    setEditingTypeId(null);
    setTypeModal(true);
  }

  function openEditType(item) {
    setEditingTypeId(item.id);
    setSelectedType(item);
    setTypeForm({ nome: item.nome || "", descrizione: item.descrizione || "", attivo: item.attivo !== false, competenze_crm: item.competenze_crm || [] });
    setTypeModal(true);
  }

  async function saveType(e) {
    e.preventDefault();
    if (!canManage) return alert("Non hai i permessi.");
    if (!typeForm.nome.trim()) return alert("Inserisci il nome del tipo progetto.");
    setSaving(true);
    const payload = { nome: typeForm.nome.trim(), descrizione: typeForm.descrizione.trim() || null, attivo: typeForm.attivo, competenze_crm: typeForm.competenze_crm, updated_at: new Date().toISOString() };
    const request = editingTypeId
      ? supabase.from("tipi_progetto").update(payload).eq("id", editingTypeId).select().single()
      : supabase.from("tipi_progetto").insert(payload).select().single();
    const { data, error } = await request;
    setSaving(false);
    if (error) return alert(error.message);
    setTypeModal(false);
    setSelectedType(data || selectedType);
    await loadData();
  }

  async function deleteType(item) {
    if (!canManage) return alert("Non hai i permessi.");
    if (!await window.workspaceConfirm(`Eliminare il tipo progetto "${item.nome}" e tutte le sue associazioni?`)) return;
    const { error } = await supabase.from("tipi_progetto").delete().eq("id", item.id);
    if (error) return alert(error.message);
    if (selectedType?.id === item.id) setSelectedType(null);
    await loadData();
  }

  function openNewRule() {
    if (!selectedType?.id) return alert("Seleziona prima un tipo progetto.");
    setEditingRule(null);
    setRuleCompetencies([]);
    setRuleForm({ ...emptyRule, ordine: selectedRules.length + 1 });
    setRuleModal(true);
  }

  function openEditRule(rule) {
    setEditingRule(rule);
    setRuleCompetencies(templates.find((item) => item.id === rule.template_id)?.competenze_crm || []);
    setRuleForm({
      template_id: rule.template_id || "",
      giorni_anticipo: Number(rule.giorni_anticipo || 0),
      ordine: Number(rule.ordine || 1),
      obbligatoria: rule.obbligatoria !== false,
      responsabile_id: rule.responsabile_id || "",
      dipende_da_id: rule.dipende_da_id || "",
      durata_giorni: Number(rule.durata_giorni || 1),
      priorita: rule.priorita || "normale",
    });
    setRuleModal(true);
  }

  async function saveRule(e) {
    e.preventDefault();
    if (!canManage) return alert("Non hai i permessi.");
    if (!selectedType?.id) return alert("Tipo progetto non selezionato.");
    if (!ruleForm.template_id) return alert("Seleziona una fase.");
    const duplicate = rules.some((row) => row.tipo_progetto_id === selectedType.id && row.template_id === ruleForm.template_id && row.id !== editingRule?.id);
    if (duplicate) return alert("Questa fase è già associata al tipo progetto.");
    setSaving(true);
    const payload = {
      tipo_progetto_id: selectedType.id,
      template_id: ruleForm.template_id,
      giorni_anticipo: Math.max(0, Number(ruleForm.giorni_anticipo || 0)),
      ordine: Math.max(1, Number(ruleForm.ordine || 1)),
      obbligatoria: Boolean(ruleForm.obbligatoria),
      responsabile_id: ruleForm.responsabile_id || null,
      dipende_da_id: ruleForm.dipende_da_id || null,
      durata_giorni: Math.max(1, Number(ruleForm.durata_giorni || 1)),
      priorita: ruleForm.priorita || "normale",
    };
    const { error: saveError } = await supabase.rpc("workspace_save_project_rule", {
      p_rule_id: editingRule?.id || null, p_rule: payload, p_competenze_crm: ruleCompetencies,
    });
    setSaving(false);
    if (saveError) return alert(saveError.message);
    setRuleModal(false);
    await loadData();
    onTemplatesChanged?.();
  }

  async function deleteRule(rule) {
    if (!canManage) return alert("Non hai i permessi.");
    if (!await window.workspaceConfirm("Eliminare questa fase dal tipo progetto?")) return;
    const { error } = await supabase.from("tipo_progetto_fasi").delete().eq("id", rule.id);
    if (error) return alert(error.message);
    await loadData();
  }

  async function changeCompetencies(item, competenze_crm, table) {
    if (!canManage) return;
    const { error: updateError } = await supabase.from(table).update({ competenze_crm }).eq("id", item.id);
    if (updateError) { setError(updateError.message); return; }
    setError("");
    await loadData();
    if (table === "checklist_template") onTemplatesChanged?.();
  }

  return (
    <div className="project-settings-workspace">
      <div className="project-settings-tabs" role="tablist" aria-label="Voci di progetto">
        <button id="project-types-tab" role="tab" aria-controls="project-types-panel" aria-selected={activeTab === "types"} onClick={() => { setActiveTab("types"); loadData(); }}>Tipi di progetto</button>
        <button id="project-checklist-tab" role="tab" aria-controls="project-checklist-panel" aria-selected={activeTab === "checklist"} onClick={() => setActiveTab("checklist")}>Voci checklist</button>
      </div>
      {error && <p role="alert">{error}</p>}
      <div id="project-checklist-panel" role="tabpanel" aria-labelledby="project-checklist-tab" hidden={activeTab !== "checklist"}>{checklistPanel}</div>
      <div id="project-types-panel" role="tabpanel" aria-labelledby="project-types-tab" hidden={activeTab !== "types"}>
      <div className="project-types-settings-grid">
        <section className="panel settings-panel">
          <div className="panel-header"><h3>Tipi di progetto</h3>{canManage && <button className="primary-action" onClick={openNewType}><Plus size={18} />Nuovo tipo</button>}</div>
          <div className="project-type-list">{filteredTypes.map((item) => <div className={`project-type-row ${selectedType?.id === item.id ? "active" : ""}`} key={item.id}>
            <button className="project-type-select" aria-pressed={selectedType?.id === item.id} onClick={() => setSelectedType(item)}><strong>{item.nome}</strong><CrmCompetencyBadges value={item.competenze_crm || []} /><small>{rules.filter((rule) => rule.tipo_progetto_id === item.id).length} voci checklist · {item.attivo ? "Attivo" : "Disattivo"}</small></button>
            {canManage && <button className="project-edit-button" aria-label={`Modifica ${item.nome}`} onClick={() => openEditType(item)}><Pencil size={18} /></button>}
          </div>)}{!filteredTypes.length && <p>Nessun tipo progetto corrisponde alla ricerca.</p>}</div>
        </section>
        <section className="panel settings-panel">
          {selectedType ? <>
            <div className="panel-header"><div><h3>{selectedType.nome}</h3><p>{selectedType.descrizione || "Configurazione del tipo di progetto"}</p></div>{canManage && <div className="config-actions"><button aria-label="Modifica tipo progetto" onClick={() => openEditType(selectedType)}><Pencil size={18} /></button><button className="danger" aria-label="Elimina tipo progetto" onClick={() => deleteType(selectedType)}><Trash2 size={18} /></button></div>}</div>
            <CrmCompetencies value={selectedType.competenze_crm || []} disabled={!canManage} onChange={(value) => changeCompetencies(selectedType, value, "tipi_progetto")} />
            <div className="panel-header"><h3>Checklist del progetto</h3>{canManage && <button className="primary-action" onClick={openNewRule}><Plus size={18} />Aggiungi fase</button>}</div>
            <div>{filteredRules.map((rule) => { const template = templates.find((item) => item.id === rule.template_id); return <div className="project-phase-setting" key={rule.id}>
              <div className="panel-header"><strong>{rule.ordine}. {templateName(rule.template_id)}</strong>{canManage && <div className="config-actions"><button aria-label={`Modifica fase ${templateName(rule.template_id)}`} onClick={() => openEditRule(rule)}><Pencil size={18} /></button><button className="danger" aria-label={`Rimuovi fase ${templateName(rule.template_id)}`} onClick={() => deleteRule(rule)}><Trash2 size={16} /></button></div>}</div>
              <p>{rule.obbligatoria ? "Obbligatoria" : "Facoltativa"} · {rule.giorni_anticipo} giorni di anticipo · Durata {rule.durata_giorni || 1} giorni · Priorità {rule.priorita || "normale"}</p>
              <CrmCompetencies value={template?.competenze_crm || []} disabled={!canManage || !template} onChange={(value) => changeCompetencies(template, value, "checklist_template")} />
            </div>; })}{!filteredRules.length && <p>Nessuna fase associata corrisponde alla ricerca.</p>}</div>
          </> : <p>Seleziona un tipo progetto.</p>}
        </section>
      </div></div>
      {typeModal && <div className="modal-backdrop"><form className="modal-card v4-modal" onSubmit={saveType}><div className="modal-header"><h2>{editingTypeId ? "Modifica tipo progetto" : "Nuovo tipo progetto"}</h2><button type="button" onClick={() => setTypeModal(false)}><X size={20} /></button></div><label>Nome<input value={typeForm.nome} onChange={(e) => setTypeForm({ ...typeForm, nome: e.target.value })} /></label><label>Descrizione<textarea rows="4" value={typeForm.descrizione} onChange={(e) => setTypeForm({ ...typeForm, descrizione: e.target.value })} /></label><CrmCompetencies value={typeForm.competenze_crm} onChange={(competenze_crm) => setTypeForm({ ...typeForm, competenze_crm })} /><label className="check-line"><input type="checkbox" checked={typeForm.attivo} onChange={(e) => setTypeForm({ ...typeForm, attivo: e.target.checked })} />Attivo</label><button className="primary-action" disabled={saving}><Save size={18} />{saving ? "Salvataggio..." : "Salva"}</button></form></div>}

      {ruleModal && <div className="modal-backdrop"><form className="modal-card v4-modal" onSubmit={saveRule}><div className="modal-header"><h2>{editingRule ? "Modifica fase associata" : "Aggiungi fase"}</h2><button type="button" onClick={() => setRuleModal(false)}><X size={20} /></button></div><label>Fase<select value={ruleForm.template_id} onChange={(e) => { setRuleForm({ ...ruleForm, template_id: e.target.value }); setRuleCompetencies(templates.find((item) => item.id === e.target.value)?.competenze_crm || []); }}><option value="">Seleziona fase...</option>{templates.map((item) => <option key={item.id} value={item.id}>{item.titolo}</option>)}</select></label><label>Giorni di anticipo<input type="number" min="0" value={ruleForm.giorni_anticipo} onChange={(e) => setRuleForm({ ...ruleForm, giorni_anticipo: e.target.value })} /></label><label>Durata prevista (giorni)<input type="number" min="1" value={ruleForm.durata_giorni} onChange={(e) => setRuleForm({ ...ruleForm, durata_giorni: e.target.value })} /></label><label>Ordine<input type="number" min="1" value={ruleForm.ordine} onChange={(e) => setRuleForm({ ...ruleForm, ordine: e.target.value })} /></label><label>Priorità<select value={ruleForm.priorita} onChange={(e) => setRuleForm({ ...ruleForm, priorita: e.target.value })}><option value="bassa">Bassa</option><option value="normale">Normale</option><option value="alta">Alta</option></select></label><label>Responsabile opzionale<select value={ruleForm.responsabile_id} onChange={(e) => setRuleForm({ ...ruleForm, responsabile_id: e.target.value })}><option value="">Da assegnare</option>{users.map((item) => <option key={item.id} value={item.id}>{`${item.nome || ""} ${item.cognome || ""}`.trim()}</option>)}</select></label><label>Dipende da<select value={ruleForm.dipende_da_id} onChange={(e) => setRuleForm({ ...ruleForm, dipende_da_id: e.target.value })}><option value="">Fase precedente</option>{selectedRules.filter((item) => item.id !== editingRule?.id).map((item) => <option key={item.id} value={item.id}>{templateName(item.template_id)}</option>)}</select></label><CrmCompetencies value={ruleCompetencies} onChange={setRuleCompetencies} /><p className="muted">Le competenze della voce checklist sono condivise con il catalogo.</p><label className="check-line"><input type="checkbox" checked={ruleForm.obbligatoria} onChange={(e) => setRuleForm({ ...ruleForm, obbligatoria: e.target.checked })} />Obbligatoria</label><button className="primary-action" disabled={saving}><Save size={18} />{saving ? "Salvataggio..." : "Salva"}</button></form></div>}

    </div>
  );
}
