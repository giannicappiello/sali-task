import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { supabase } from "../lib/supabaseClient";

const emptyType = { nome: "", descrizione: "", attivo: true };
const emptyRule = { template_id: "", giorni_anticipo: 0, ordine: 1, obbligatoria: true, responsabile_id: "", dipende_da_id: "", durata_giorni: 1, priorita: "normale" };
const emptyCrmType = { crm_tipo: "conto_terzi", codice: "", nome: "", descrizione: "", classe: "semplice", tipo_progetto_id: "", priorita_default: "normale", attivo: true, ordine: 10 };

export default function ProjectTypesSettings({ canManage = false, searchTerm = "" }) {
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
  const [crmTypes, setCrmTypes] = useState([]);
  const [crmTypeModal, setCrmTypeModal] = useState(false);
  const [editingCrmType, setEditingCrmType] = useState(null);
  const [crmTypeForm, setCrmTypeForm] = useState(emptyCrmType);

  useEffect(() => {
    loadData();
    // Il caricamento iniziale non deve ripetersi quando cambia il tipo selezionato.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadData() {
    const [typesRes, templatesRes, rulesRes, crmTypesRes, usersRes] = await Promise.all([
      supabase.from("tipi_progetto").select("*").order("nome"),
      supabase.from("checklist_template").select("id,titolo,attivo").eq("attivo", true).order("ordine", { ascending: true }),
      supabase.from("tipo_progetto_fasi").select("*").order("ordine", { ascending: true }),
      supabase.from("crm_activity_types").select("*").eq("crm_tipo", "conto_terzi").order("ordine", { ascending: true }),
      supabase.from("utenti").select("id,nome,cognome").eq("attivo", true).order("nome"),
    ]);
    if (typesRes.error) console.error(typesRes.error.message);
    if (templatesRes.error) console.error(templatesRes.error.message);
    if (rulesRes.error) console.error(rulesRes.error.message);
    if (crmTypesRes.error) console.error(crmTypesRes.error.message);
    if (usersRes.error) console.error(usersRes.error.message);
    const loadedTypes = typesRes.data || [];
    setTypes(loadedTypes);
    setTemplates(templatesRes.data || []);
    setRules(rulesRes.data || []);
    setCrmTypes(crmTypesRes.data || []);
    setUsers(usersRes.data || []);
    if (selectedType) setSelectedType(loadedTypes.find((item) => item.id === selectedType.id) || null);
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
    setSelectedType(null);
    setTypeModal(true);
  }

  function openEditType(item) {
    setSelectedType(item);
    setTypeForm({ nome: item.nome || "", descrizione: item.descrizione || "", attivo: item.attivo !== false });
    setTypeModal(true);
  }

  async function saveType(e) {
    e.preventDefault();
    if (!canManage) return alert("Non hai i permessi.");
    if (!typeForm.nome.trim()) return alert("Inserisci il nome del tipo progetto.");
    setSaving(true);
    const payload = { nome: typeForm.nome.trim(), descrizione: typeForm.descrizione.trim() || null, attivo: typeForm.attivo, updated_at: new Date().toISOString() };
    const request = selectedType?.id
      ? supabase.from("tipi_progetto").update(payload).eq("id", selectedType.id).select().single()
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
    setRuleForm({ ...emptyRule, ordine: selectedRules.length + 1 });
    setRuleModal(true);
  }

  function openEditRule(rule) {
    setEditingRule(rule);
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
    const request = editingRule?.id
      ? supabase.from("tipo_progetto_fasi").update(payload).eq("id", editingRule.id)
      : supabase.from("tipo_progetto_fasi").insert(payload);
    const { error } = await request;
    setSaving(false);
    if (error) return alert(error.message);
    setRuleModal(false);
    await loadData();
  }

  async function deleteRule(rule) {
    if (!canManage) return alert("Non hai i permessi.");
    if (!await window.workspaceConfirm("Eliminare questa fase dal tipo progetto?")) return;
    const { error } = await supabase.from("tipo_progetto_fasi").delete().eq("id", rule.id);
    if (error) return alert(error.message);
    await loadData();
  }

  function openCrmType(item = null) {
    setEditingCrmType(item);
    setCrmTypeForm(item ? { ...emptyCrmType, ...item, tipo_progetto_id: item.tipo_progetto_id || "" } : { ...emptyCrmType });
    setCrmTypeModal(true);
  }

  async function saveCrmType(event) {
    event.preventDefault();
    if (!canManage) return alert("Non hai i permessi.");
    if (!crmTypeForm.nome.trim() || !crmTypeForm.codice.trim()) return alert("Nome e codice sono obbligatori.");
    if (crmTypeForm.classe === "strutturata" && !crmTypeForm.tipo_progetto_id) return alert("Collega una tipologia progetto al workflow strutturato.");
    setSaving(true);
    const payload = { ...crmTypeForm, nome: crmTypeForm.nome.trim(), codice: crmTypeForm.codice.trim().toLowerCase().replaceAll(" ", "_"), descrizione: crmTypeForm.descrizione.trim() || null, tipo_progetto_id: crmTypeForm.classe === "strutturata" ? crmTypeForm.tipo_progetto_id : null, ordine: Number(crmTypeForm.ordine || 0) };
    const request = editingCrmType?.id ? supabase.from("crm_activity_types").update(payload).eq("id", editingCrmType.id) : supabase.from("crm_activity_types").insert(payload);
    const { error } = await request;
    setSaving(false);
    if (error) return alert(error.message);
    setCrmTypeModal(false);
    await loadData();
  }

  return (
    <div className="project-types-settings-grid">
      <div className="panel settings-panel" style={{ order: 1 }}>
        <div className="panel-header"><h3>Tipi di progetto</h3>{canManage && <button className="primary-action" onClick={openNewType}><Plus size={18} />Nuovo tipo</button>}</div>
        <div className="settings-list">
          {filteredTypes.map((item) => (
            <div className={`settings-row ${selectedType?.id === item.id ? "active" : ""}`} key={item.id}>
              <button type="button" style={{ textAlign: "left", flex: 1, background: "none", border: 0 }} onClick={() => setSelectedType(item)}>
                <strong>{item.nome}</strong><span>{item.descrizione || "Nessuna descrizione"}</span>
              </button>
              <span className={`config-status ${item.attivo !== false ? "active" : "inactive"}`}>{item.attivo !== false ? "Attivo" : "Disattivo"}</span>
              <div className="config-actions"><button onClick={() => openEditType(item)}><Pencil size={16} /></button><button className="danger" onClick={() => deleteType(item)}><Trash2 size={16} /></button></div>
            </div>
          ))}
          {!filteredTypes.length && <p>Nessun tipo progetto corrisponde alla ricerca.</p>}
        </div>
      </div>

      <div className="panel settings-panel" style={{ gridColumn: "1 / -1", order: 3 }}>
        <div className="panel-header"><div><h3>Tipi attività CRM PRIVATE</h3><p>Le attività strutturate riusano una tipologia progetto e le sue fasi configurate.</p></div>{canManage && <button className="primary-action" onClick={() => openCrmType()}><Plus size={18} />Nuovo tipo attività</button>}</div>
        <div className="settings-list">{crmTypes.map((item) => <div className="settings-row" key={item.id}><div><strong>{item.nome}</strong><span>{item.classe === "strutturata" ? `Strutturata · ${types.find((type) => type.id === item.tipo_progetto_id)?.nome || "workflow da collegare"}` : "Attività semplice · task Workspace"}</span></div><span className={`config-status ${item.attivo ? "active" : "inactive"}`}>{item.attivo ? "Attivo" : "Disattivo"}</span>{canManage ? <div className="config-actions"><button onClick={() => openCrmType(item)}><Pencil size={16} /></button></div> : null}</div>)}</div>
      </div>

      <div className="panel settings-panel" style={{ order: 2 }}>
        <div className="panel-header"><div><h3>Fasi associate</h3><p>{selectedType ? selectedType.nome : "Seleziona un tipo progetto"}</p></div>{selectedType && canManage && <button className="primary-action" onClick={openNewRule}><Plus size={18} />Aggiungi fase</button>}</div>
        <div className="settings-list">
          {selectedType && filteredRules.map((rule) => (
            <div className="settings-row" key={rule.id}>
              <div><strong>{templateName(rule.template_id)}</strong><span>{rule.giorni_anticipo} giorni di anticipo</span></div>
              <span className="role-level">Ordine {rule.ordine}</span>
              <div className="config-actions"><button onClick={() => openEditRule(rule)}><Pencil size={16} /></button><button className="danger" onClick={() => deleteRule(rule)}><Trash2 size={16} /></button></div>
            </div>
          ))}
          {selectedType && !filteredRules.length && <p>Nessuna fase corrisponde alla ricerca.</p>}
          {!selectedType && <p>Seleziona un tipo progetto dalla colonna di sinistra.</p>}
        </div>
      </div>

      {typeModal && <div className="modal-backdrop"><form className="modal-card v4-modal" onSubmit={saveType}><div className="modal-header"><h2>{selectedType?.id ? "Modifica tipo progetto" : "Nuovo tipo progetto"}</h2><button type="button" onClick={() => setTypeModal(false)}><X size={20} /></button></div><label>Nome<input value={typeForm.nome} onChange={(e) => setTypeForm({ ...typeForm, nome: e.target.value })} /></label><label>Descrizione<textarea rows="4" value={typeForm.descrizione} onChange={(e) => setTypeForm({ ...typeForm, descrizione: e.target.value })} /></label><label className="check-line"><input type="checkbox" checked={typeForm.attivo} onChange={(e) => setTypeForm({ ...typeForm, attivo: e.target.checked })} />Attivo</label><button className="primary-action" disabled={saving}><Save size={18} />{saving ? "Salvataggio..." : "Salva"}</button></form></div>}

      {ruleModal && <div className="modal-backdrop"><form className="modal-card v4-modal" onSubmit={saveRule}><div className="modal-header"><h2>{editingRule ? "Modifica fase associata" : "Aggiungi fase"}</h2><button type="button" onClick={() => setRuleModal(false)}><X size={20} /></button></div><label>Fase<select value={ruleForm.template_id} onChange={(e) => setRuleForm({ ...ruleForm, template_id: e.target.value })}><option value="">Seleziona fase...</option>{templates.map((item) => <option key={item.id} value={item.id}>{item.titolo}</option>)}</select></label><label>Giorni di anticipo<input type="number" min="0" value={ruleForm.giorni_anticipo} onChange={(e) => setRuleForm({ ...ruleForm, giorni_anticipo: e.target.value })} /></label><label>Durata prevista (giorni)<input type="number" min="1" value={ruleForm.durata_giorni} onChange={(e) => setRuleForm({ ...ruleForm, durata_giorni: e.target.value })} /></label><label>Ordine<input type="number" min="1" value={ruleForm.ordine} onChange={(e) => setRuleForm({ ...ruleForm, ordine: e.target.value })} /></label><label>Priorità<select value={ruleForm.priorita} onChange={(e) => setRuleForm({ ...ruleForm, priorita: e.target.value })}><option value="bassa">Bassa</option><option value="normale">Normale</option><option value="alta">Alta</option></select></label><label>Responsabile opzionale<select value={ruleForm.responsabile_id} onChange={(e) => setRuleForm({ ...ruleForm, responsabile_id: e.target.value })}><option value="">Da assegnare</option>{users.map((item) => <option key={item.id} value={item.id}>{`${item.nome || ""} ${item.cognome || ""}`.trim()}</option>)}</select></label><label>Dipende da<select value={ruleForm.dipende_da_id} onChange={(e) => setRuleForm({ ...ruleForm, dipende_da_id: e.target.value })}><option value="">Fase precedente</option>{selectedRules.filter((item) => item.id !== editingRule?.id).map((item) => <option key={item.id} value={item.id}>{templateName(item.template_id)}</option>)}</select></label><label className="check-line"><input type="checkbox" checked={ruleForm.obbligatoria} onChange={(e) => setRuleForm({ ...ruleForm, obbligatoria: e.target.checked })} />Obbligatoria</label><button className="primary-action" disabled={saving}><Save size={18} />{saving ? "Salvataggio..." : "Salva"}</button></form></div>}

      {crmTypeModal && <div className="modal-backdrop"><form className="modal-card v4-modal" onSubmit={saveCrmType}><div className="modal-header"><h2>{editingCrmType ? "Modifica tipo attività CRM" : "Nuovo tipo attività CRM"}</h2><button type="button" onClick={() => setCrmTypeModal(false)}><X size={20} /></button></div><label>Nome<input value={crmTypeForm.nome} onChange={(e) => setCrmTypeForm({ ...crmTypeForm, nome: e.target.value })} /></label><label>Codice<input value={crmTypeForm.codice} onChange={(e) => setCrmTypeForm({ ...crmTypeForm, codice: e.target.value })} /></label><label>Descrizione<textarea value={crmTypeForm.descrizione} onChange={(e) => setCrmTypeForm({ ...crmTypeForm, descrizione: e.target.value })} /></label><label>Classe<select value={crmTypeForm.classe} onChange={(e) => setCrmTypeForm({ ...crmTypeForm, classe: e.target.value })}><option value="semplice">Attività semplice</option><option value="strutturata">Attività strutturata</option></select></label>{crmTypeForm.classe === "strutturata" ? <label>Workflow / tipologia progetto<select value={crmTypeForm.tipo_progetto_id} onChange={(e) => setCrmTypeForm({ ...crmTypeForm, tipo_progetto_id: e.target.value })}><option value="">Seleziona...</option>{types.filter((item) => item.attivo !== false).map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}</select></label> : null}<label>Priorità predefinita<select value={crmTypeForm.priorita_default} onChange={(e) => setCrmTypeForm({ ...crmTypeForm, priorita_default: e.target.value })}><option value="bassa">Bassa</option><option value="normale">Normale</option><option value="alta">Alta</option></select></label><label>Ordine<input type="number" min="0" value={crmTypeForm.ordine} onChange={(e) => setCrmTypeForm({ ...crmTypeForm, ordine: e.target.value })} /></label><label className="check-line"><input type="checkbox" checked={crmTypeForm.attivo} onChange={(e) => setCrmTypeForm({ ...crmTypeForm, attivo: e.target.checked })} />Attivo</label><button className="primary-action" disabled={saving}><Save size={18} />{saving ? "Salvataggio..." : "Salva tipo"}</button></form></div>}
    </div>
  );
}
