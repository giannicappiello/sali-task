import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { supabase } from "../lib/supabaseClient";

const emptyType = { nome: "", descrizione: "", attivo: true };
const emptyRule = { template_id: "", giorni_anticipo: 0, ordine: 1, obbligatoria: true };

export default function ProjectTypesSettings({ canManage = false }) {
  const [types, setTypes] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [rules, setRules] = useState([]);
  const [selectedType, setSelectedType] = useState(null);
  const [typeModal, setTypeModal] = useState(false);
  const [ruleModal, setRuleModal] = useState(false);
  const [typeForm, setTypeForm] = useState(emptyType);
  const [ruleForm, setRuleForm] = useState(emptyRule);
  const [editingRule, setEditingRule] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    const [typesRes, templatesRes, rulesRes] = await Promise.all([
      supabase.from("tipi_progetto").select("*").order("nome"),
      supabase.from("checklist_template").select("id,titolo,attivo").eq("attivo", true).order("ordine", { ascending: true }),
      supabase.from("tipo_progetto_fasi").select("*").order("ordine", { ascending: true }),
    ]);
    if (typesRes.error) console.error(typesRes.error.message);
    if (templatesRes.error) console.error(templatesRes.error.message);
    if (rulesRes.error) console.error(rulesRes.error.message);
    const loadedTypes = typesRes.data || [];
    setTypes(loadedTypes);
    setTemplates(templatesRes.data || []);
    setRules(rulesRes.data || []);
    if (selectedType) setSelectedType(loadedTypes.find((item) => item.id === selectedType.id) || null);
  }

  const selectedRules = useMemo(
    () => rules.filter((row) => row.tipo_progetto_id === selectedType?.id).sort((a, b) => Number(a.ordine || 0) - Number(b.ordine || 0)),
    [rules, selectedType?.id]
  );

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
    if (!confirm(`Eliminare il tipo progetto "${item.nome}" e tutte le sue associazioni?`)) return;
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
    if (!confirm("Eliminare questa fase dal tipo progetto?")) return;
    const { error } = await supabase.from("tipo_progetto_fasi").delete().eq("id", rule.id);
    if (error) return alert(error.message);
    await loadData();
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, .8fr) minmax(420px, 1.2fr)", gap: "16px" }}>
      <div className="panel settings-panel">
        <div className="panel-header"><h3>Tipi di progetto</h3>{canManage && <button className="primary-action" onClick={openNewType}><Plus size={18} />Nuovo tipo</button>}</div>
        <div className="settings-list">
          {types.map((item) => (
            <div className={`settings-row ${selectedType?.id === item.id ? "active" : ""}`} key={item.id}>
              <button type="button" style={{ textAlign: "left", flex: 1, background: "none", border: 0 }} onClick={() => setSelectedType(item)}>
                <strong>{item.nome}</strong><span>{item.descrizione || "Nessuna descrizione"}</span>
              </button>
              <span className={`config-status ${item.attivo !== false ? "active" : "inactive"}`}>{item.attivo !== false ? "Attivo" : "Disattivo"}</span>
              <div className="config-actions"><button onClick={() => openEditType(item)}><Pencil size={16} /></button><button className="danger" onClick={() => deleteType(item)}><Trash2 size={16} /></button></div>
            </div>
          ))}
          {!types.length && <p>Nessun tipo progetto configurato.</p>}
        </div>
      </div>

      <div className="panel settings-panel">
        <div className="panel-header"><div><h3>Fasi associate</h3><p>{selectedType ? selectedType.nome : "Seleziona un tipo progetto"}</p></div>{selectedType && canManage && <button className="primary-action" onClick={openNewRule}><Plus size={18} />Aggiungi fase</button>}</div>
        <div className="settings-list">
          {selectedType && selectedRules.map((rule) => (
            <div className="settings-row" key={rule.id}>
              <div><strong>{templateName(rule.template_id)}</strong><span>{rule.giorni_anticipo} giorni di anticipo</span></div>
              <span className="role-level">Ordine {rule.ordine}</span>
              <div className="config-actions"><button onClick={() => openEditRule(rule)}><Pencil size={16} /></button><button className="danger" onClick={() => deleteRule(rule)}><Trash2 size={16} /></button></div>
            </div>
          ))}
          {selectedType && !selectedRules.length && <p>Nessuna fase associata.</p>}
          {!selectedType && <p>Seleziona un tipo progetto dalla colonna di sinistra.</p>}
        </div>
      </div>

      {typeModal && <div className="modal-backdrop"><form className="modal-card v4-modal" onSubmit={saveType}><div className="modal-header"><h2>{selectedType?.id ? "Modifica tipo progetto" : "Nuovo tipo progetto"}</h2><button type="button" onClick={() => setTypeModal(false)}><X size={20} /></button></div><label>Nome<input value={typeForm.nome} onChange={(e) => setTypeForm({ ...typeForm, nome: e.target.value })} /></label><label>Descrizione<textarea rows="4" value={typeForm.descrizione} onChange={(e) => setTypeForm({ ...typeForm, descrizione: e.target.value })} /></label><label className="check-line"><input type="checkbox" checked={typeForm.attivo} onChange={(e) => setTypeForm({ ...typeForm, attivo: e.target.checked })} />Attivo</label><button className="primary-action" disabled={saving}><Save size={18} />{saving ? "Salvataggio..." : "Salva"}</button></form></div>}

      {ruleModal && <div className="modal-backdrop"><form className="modal-card v4-modal" onSubmit={saveRule}><div className="modal-header"><h2>{editingRule ? "Modifica fase associata" : "Aggiungi fase"}</h2><button type="button" onClick={() => setRuleModal(false)}><X size={20} /></button></div><label>Fase<select value={ruleForm.template_id} onChange={(e) => setRuleForm({ ...ruleForm, template_id: e.target.value })}><option value="">Seleziona fase...</option>{templates.map((item) => <option key={item.id} value={item.id}>{item.titolo}</option>)}</select></label><label>Giorni di anticipo<input type="number" min="0" value={ruleForm.giorni_anticipo} onChange={(e) => setRuleForm({ ...ruleForm, giorni_anticipo: e.target.value })} /></label><label>Ordine<input type="number" min="1" value={ruleForm.ordine} onChange={(e) => setRuleForm({ ...ruleForm, ordine: e.target.value })} /></label><label className="check-line"><input type="checkbox" checked={ruleForm.obbligatoria} onChange={(e) => setRuleForm({ ...ruleForm, obbligatoria: e.target.checked })} />Obbligatoria</label><button className="primary-action" disabled={saving}><Save size={18} />{saving ? "Salvataggio..." : "Salva"}</button></form></div>}
    </div>
  );
}
