import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, FolderTree, Menu as MenuIcon, Plus, Save, Trash2 } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import useBackNavigation from "../../hooks/useBackNavigation";
import { getModuleIcon, MODULE_ICON_OPTIONS } from "../../config/moduleIcons";
import { supabase } from "../../lib/supabaseClient";
import "./modules-settings.css";
import "./menu-settings.css";

const normalizeCode = (value) => String(value || "").trim().toLowerCase().normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const cleanText = (value) => String(value ?? "").trim();

const EMPTY_AREA = { codice: "", nome: "", descrizione: "", icona: "blocks", ordine: 100, attiva: true, ruoli: [], reparti: [], utenti: [] };
const EMPTY_MENU = { codice: "", nome: "", descrizione: "", icona: "blocks", ordine: 100, attiva: true, moduli: [] };

export default function MenuManagement() {
  const goBack = useBackNavigation("/settings");
  const { isAdminUser, reloadProfile } = useAuth();
  const [view, setView] = useState("areas");
  const [catalog, setCatalog] = useState({ areas: [], menus: [], menuModules: [], modules: [], roles: [], departments: [], users: [], roleAreas: [], departmentAreas: [], userAreas: [] });
  const [areaForm, setAreaForm] = useState(EMPTY_AREA);
  const [menuForm, setMenuForm] = useState(EMPTY_MENU);
  const [selectedArea, setSelectedArea] = useState("");
  const [selectedMenu, setSelectedMenu] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const load = useCallback(async () => {
    const results = await Promise.all([
      supabase.from("workspace_aree").select("*").order("ordine").order("nome"),
      supabase.from("workspace_menu_voci").select("*").order("ordine").order("nome"),
      supabase.from("workspace_menu_moduli").select("*").order("ordine"),
      supabase.from("workspace_moduli").select("codice,nome,descrizione,icona,area,attivo,mostra_menu,ordine").order("ordine").order("nome"),
      supabase.from("ruoli").select("id,nome,amministratore_workspace").order("nome"),
      supabase.from("reparti").select("id,nome,attivo").order("nome"),
      supabase.from("utenti").select("id,nome,cognome,email,attivo").order("nome"),
      supabase.from("workspace_ruoli_aree").select("ruolo_id,area_codice"),
      supabase.from("workspace_reparti_aree").select("reparto_id,area_codice"),
      supabase.from("workspace_utenti_aree").select("utente_id,area_codice"),
    ]);
    const error = results.find((result) => result.error)?.error;
    if (error) throw error;
    setCatalog({
      areas: results[0].data || [], menus: results[1].data || [], menuModules: results[2].data || [], modules: results[3].data || [],
      roles: results[4].data || [], departments: results[5].data || [], users: results[6].data || [], roleAreas: results[7].data || [],
      departmentAreas: results[8].data || [], userAreas: results[9].data || [],
    });
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load().catch((error) => setMessage({ type: "error", text: error.message })),0);
    return () => window.clearTimeout(timer);
  }, [load]);

  function toggle(field, value, setter) {
    setter((current) => ({ ...current, [field]: current[field].includes(value) ? current[field].filter((item) => item !== value) : [...current[field], value] }));
  }

  function editArea(area) {
    setSelectedArea(area.codice);
    setAreaForm({ ...EMPTY_AREA, ...area,
      ruoli: catalog.roleAreas.filter((row) => row.area_codice === area.codice).map((row) => row.ruolo_id),
      reparti: catalog.departmentAreas.filter((row) => row.area_codice === area.codice).map((row) => row.reparto_id),
      utenti: catalog.userAreas.filter((row) => row.area_codice === area.codice).map((row) => row.utente_id),
    });
  }

  function editMenu(menu) {
    setSelectedMenu(menu.codice);
    setMenuForm({ ...EMPTY_MENU, ...menu, moduli: catalog.menuModules.filter((row) => row.voce_codice === menu.codice).map((row) => row.modulo_codice) });
  }

  function createItem() {
    if (view === "areas") {
      setSelectedArea("");
      setAreaForm(EMPTY_AREA);
    } else {
      setSelectedMenu("");
      setMenuForm(EMPTY_MENU);
    }
  }

  function moveMenuModuleToPosition(code, position) {
    setMenuForm((current) => {
      const currentIndex = current.moduli.indexOf(code);
      if (currentIndex < 0) return current;
      const targetIndex = Math.max(0, Math.min(Number(position) - 1, current.moduli.length - 1));
      if (currentIndex === targetIndex) return current;
      const ordered = [...current.moduli];
      ordered.splice(currentIndex, 1);
      ordered.splice(targetIndex, 0, code);
      return { ...current, moduli: ordered };
    });
  }

  async function saveArea(event) {
    event.preventDefault();
    if (!isAdminUser) return;
    const codice = selectedArea || normalizeCode(areaForm.codice || areaForm.nome);
    if (!codice || !cleanText(areaForm.nome)) return setMessage({ type: "error", text: "Inserisci nome e codice dell’area." });
    setBusy(true); setMessage(null);
    try {
      const { error } = await supabase.from("workspace_aree").upsert({ codice, nome: cleanText(areaForm.nome), descrizione: cleanText(areaForm.descrizione) || null, icona: areaForm.icona, ordine: Number(areaForm.ordine) || 0, attiva: areaForm.attiva !== false, aggiornata_il: new Date().toISOString() });
      if (error) throw error;
      const grantDeletes = await Promise.all([
        supabase.from("workspace_ruoli_aree").delete().eq("area_codice", codice),
        supabase.from("workspace_reparti_aree").delete().eq("area_codice", codice),
        supabase.from("workspace_utenti_aree").delete().eq("area_codice", codice),
      ]);
      const grantDeleteError = grantDeletes.find((result) => result.error)?.error;
      if (grantDeleteError) throw grantDeleteError;
      const rows = [
        ...areaForm.ruoli.map((ruolo_id) => ({ table: "workspace_ruoli_aree", row: { ruolo_id, area_codice: codice } })),
        ...areaForm.reparti.map((reparto_id) => ({ table: "workspace_reparti_aree", row: { reparto_id, area_codice: codice } })),
        ...areaForm.utenti.map((utente_id) => ({ table: "workspace_utenti_aree", row: { utente_id, area_codice: codice } })),
      ];
      for (const table of ["workspace_ruoli_aree", "workspace_reparti_aree", "workspace_utenti_aree"]) {
        const tableRows = rows.filter((item) => item.table === table).map((item) => item.row);
        if (tableRows.length) { const result = await supabase.from(table).insert(tableRows); if (result.error) throw result.error; }
      }
      await load();
      if (reloadProfile) await reloadProfile();
      window.dispatchEvent(new CustomEvent("workspace:module-catalog-changed"));
      setSelectedArea(codice);
      setMessage({ type: "success", text: "Area e autorizzazioni salvate." });
    } catch (error) { setMessage({ type: "error", text: error.message }); } finally { setBusy(false); }
  }

  async function deleteArea() {
    const area = catalog.areas.find((item) => item.codice === selectedArea);
    if (!area || area.protetta || !await window.workspaceConfirm(`Eliminare l’area “${area.nome}”?`)) return;
    const { error } = await supabase.from("workspace_aree").delete().eq("codice", area.codice);
    if (error) return setMessage({ type: "error", text: "Sposta prima moduli e schermate collegati a questa Area." });
    setSelectedArea(""); setAreaForm(EMPTY_AREA); await load();
  }

  async function saveMenu(event) {
    event.preventDefault();
    if (!isAdminUser) return;
    const codice = selectedMenu || normalizeCode(menuForm.codice || menuForm.nome);
    if (!codice || !cleanText(menuForm.nome)) return setMessage({ type: "error", text: "Inserisci nome e codice della voce di menu." });
    if (!menuForm.moduli.length) return setMessage({ type: "error", text: "Inserisci almeno un modulo nella voce di menu." });
    setBusy(true); setMessage(null);
    try {
      const { error } = await supabase.from("workspace_menu_voci").upsert({ codice, nome: cleanText(menuForm.nome), descrizione: cleanText(menuForm.descrizione) || null, icona: menuForm.icona, ordine: Number(menuForm.ordine) || 0, attiva: menuForm.attiva !== false, aggiornata_il: new Date().toISOString() });
      if (error) throw error;
      const remove = await supabase.from("workspace_menu_moduli").delete().eq("voce_codice", codice); if (remove.error) throw remove.error;
      const insert = await supabase.from("workspace_menu_moduli").insert(menuForm.moduli.map((modulo_codice, index) => ({ voce_codice: codice, modulo_codice, ordine: (index + 1) * 10 })));
      if (insert.error) throw insert.error;
      await load(); window.dispatchEvent(new CustomEvent("workspace:module-catalog-changed"));
      setSelectedMenu(codice); setMessage({ type: "success", text: "Voce di menu salvata." });
    } catch (error) { setMessage({ type: "error", text: error.message }); } finally { setBusy(false); }
  }

  async function deleteMenu() {
    const menu = catalog.menus.find((item) => item.codice === selectedMenu);
    if (!menu || !await window.workspaceConfirm(`Eliminare la voce di menu “${menu.nome}”?`)) return;
    const { error } = await supabase.from("workspace_menu_voci").delete().eq("codice", menu.codice);
    if (error) return setMessage({ type: "error", text: error.message });
    setSelectedMenu(""); setMenuForm(EMPTY_MENU); await load(); window.dispatchEvent(new CustomEvent("workspace:module-catalog-changed"));
  }

  const menuPickerModules = useMemo(() => {
    const available = catalog.modules.filter((module) => module.attivo || menuForm.moduli.includes(module.codice));
    const byCode = new Map(available.map((module) => [module.codice, module]));
    const selected = menuForm.moduli.map((code) => byCode.get(code)).filter(Boolean);
    const selectedCodes = new Set(menuForm.moduli);
    return [...selected, ...available.filter((module) => !selectedCodes.has(module.codice))];
  }, [catalog.modules, menuForm.moduli]);

  return <div className="module-settings-page menu-settings-page">
    <header className="module-settings-header"><div><button type="button" className="module-back" onClick={goBack}><ArrowLeft size={17} />Impostazioni</button><span>NAVIGAZIONE E SICUREZZA</span><h1>Aree e menu</h1><p>Definisci gli accessi alle Aree e raggruppa più moduli nella stessa voce di menu.</p></div></header>
    {message ? <div className={`module-message ${message.type}`}>{message.text}</div> : null}
    <div className="module-toolbar"><div className="module-view-tabs"><button type="button" className={view === "areas" ? "active" : ""} onClick={() => setView("areas")}><FolderTree size={17} />Aree</button><button type="button" className={view === "menu" ? "active" : ""} onClick={() => setView("menu")}><MenuIcon size={17} />Menu</button></div><button type="button" className="primary-action" onClick={createItem}><Plus size={17} />Nuovo</button></div>
    {view === "areas" ? <div className="module-composer-grid">
      <section className="module-catalog-list">{catalog.areas.map((area) => { const Icon=getModuleIcon(area.icona,FolderTree); return <button type="button" key={area.codice} className={selectedArea === area.codice ? "active" : ""} onClick={() => editArea(area)}><span className="module-list-icon"><Icon /></span><span><strong>{area.nome}</strong><small>{area.codice}</small></span><span className={area.attiva ? "status-on" : "status-off"}>{area.attiva ? "Attiva" : "Disattiva"}</span></button>; })}</section>
      <form className="module-editor" onSubmit={saveArea}><div className="module-editor-title"><div><h2>{selectedArea ? `Modifica ${areaForm.nome}` : "Nuova Area"}</h2><p>L’accesso è concesso se deriva dal ruolo, da un reparto o dall’eccezione individuale.</p></div>{selectedArea && !areaForm.protetta ? <button type="button" className="danger-action" onClick={deleteArea}><Trash2 size={17} />Elimina</button> : null}</div><div className="module-fields"><label>Nome<input required value={areaForm.nome} onChange={(event) => setAreaForm((current) => ({ ...current,nome:event.target.value,codice:selectedArea?current.codice:normalizeCode(event.target.value) }))} /></label><label>Codice<input required disabled={Boolean(selectedArea)} value={areaForm.codice} onChange={(event) => setAreaForm((current) => ({ ...current,codice:normalizeCode(event.target.value) }))} /></label><label className="wide">Descrizione<textarea rows="2" value={areaForm.descrizione || ""} onChange={(event) => setAreaForm((current) => ({ ...current,descrizione:event.target.value }))} /></label><label>Ordine<input type="number" value={areaForm.ordine} onChange={(event) => setAreaForm((current) => ({ ...current,ordine:event.target.value }))} /></label><label className="check-line"><input type="checkbox" checked={areaForm.attiva !== false} onChange={(event) => setAreaForm((current) => ({ ...current,attiva:event.target.checked }))} />Area attiva</label><IconPicker value={areaForm.icona} onChange={(icona) => setAreaForm((current) => ({ ...current,icona }))} /></div><AccessPicker title="Ruoli autorizzati" items={catalog.roles.filter((item) => !item.amministratore_workspace)} selected={areaForm.ruoli} getLabel={(item) => item.nome} onToggle={(id) => toggle("ruoli",id,setAreaForm)} /><AccessPicker title="Reparti autorizzati" items={catalog.departments.filter((item) => item.attivo !== false)} selected={areaForm.reparti} getLabel={(item) => item.nome} onToggle={(id) => toggle("reparti",id,setAreaForm)} /><AccessPicker title="Eccezioni individuali aggiuntive" items={catalog.users.filter((item) => item.attivo !== false)} selected={areaForm.utenti} getLabel={(item) => `${item.nome || ""} ${item.cognome || ""}`.trim() || item.email} onToggle={(id) => toggle("utenti",id,setAreaForm)} /><button className="primary-action module-save" disabled={busy}><Save size={18} />Salva Area</button></form>
    </div> : <div className="module-composer-grid">
      <section className="module-catalog-list">{catalog.menus.map((menu) => { const Icon=getModuleIcon(menu.icona,MenuIcon); const count=catalog.menuModules.filter((row) => row.voce_codice===menu.codice).length; return <button type="button" key={menu.codice} className={selectedMenu === menu.codice ? "active" : ""} onClick={() => editMenu(menu)}><span className="module-list-icon"><Icon /></span><span><strong>{menu.nome}</strong><small>{count} moduli</small></span><span className={menu.attiva ? "status-on" : "status-off"}>{menu.attiva ? "Attiva" : "Disattiva"}</span></button>; })}</section>
      <form className="module-editor" onSubmit={saveMenu}><div className="module-editor-title"><div><h2>{selectedMenu ? `Modifica ${menuForm.nome}` : "Nuova voce di menu"}</h2><p>Con un solo modulo apre direttamente il modulo; con più moduli apre un contenitore a card.</p></div>{selectedMenu ? <button type="button" className="danger-action" onClick={deleteMenu}><Trash2 size={17} />Elimina</button> : null}</div><div className="module-fields"><label>Nome<input required value={menuForm.nome} onChange={(event) => setMenuForm((current) => ({ ...current,nome:event.target.value,codice:selectedMenu?current.codice:normalizeCode(event.target.value) }))} /></label><label>Codice<input required disabled={Boolean(selectedMenu)} value={menuForm.codice} onChange={(event) => setMenuForm((current) => ({ ...current,codice:normalizeCode(event.target.value) }))} /></label><label className="wide">Descrizione<textarea rows="2" value={menuForm.descrizione || ""} onChange={(event) => setMenuForm((current) => ({ ...current,descrizione:event.target.value }))} /></label><label>Ordine<input type="number" value={menuForm.ordine} onChange={(event) => setMenuForm((current) => ({ ...current,ordine:event.target.value }))} /></label><label className="check-line"><input type="checkbox" checked={menuForm.attiva !== false} onChange={(event) => setMenuForm((current) => ({ ...current,attiva:event.target.checked }))} />Voce attiva</label><IconPicker value={menuForm.icona} description="Usata nel menu laterale, nella Home e nel contenitore della voce." onChange={(icona) => setMenuForm((current) => ({ ...current,icona }))} /></div><div className="menu-module-picker"><h3>Moduli nella voce</h3><p>Seleziona i moduli e assegna la posizione con cui compariranno nel contenitore. Lo stesso modulo può essere presente anche in altre voci di menu.</p>{menuPickerModules.map((module) => { const checked=menuForm.moduli.includes(module.codice); const position=menuForm.moduli.indexOf(module.codice)+1; return <div className={`menu-module-row ${checked?"selected":""}`} key={module.codice}><label><input type="checkbox" checked={checked} onChange={() => toggle("moduli",module.codice,setMenuForm)} /><span><strong>{module.nome}</strong><small>{catalog.areas.find((area) => area.codice===module.area)?.nome || module.area}</small></span></label>{checked ? <label className="menu-module-order"><span>Posizione</span><select value={position} onChange={(event) => moveMenuModuleToPosition(module.codice,event.target.value)}>{menuForm.moduli.map((code,index) => <option key={code} value={index+1}>{index+1}</option>)}</select></label> : null}</div>; })}</div><button className="primary-action module-save" disabled={busy}><Save size={18} />Salva voce</button></form>
    </div>}
  </div>;
}

function IconPicker({ value, onChange, description = "Scegli il simbolo identificativo." }) {
  return <fieldset className="module-icon-picker wide"><legend>Icona</legend><p>{description}</p><div>{MODULE_ICON_OPTIONS.map(({ code,label,Icon }) => <button key={code} type="button" className={value===code?"selected":""} onClick={() => onChange(code)}><Icon size={21}/><span>{label}</span></button>)}</div></fieldset>;
}

function AccessPicker({ title, items, selected, getLabel, onToggle }) {
  return <div className="menu-access-picker"><h3>{title}</h3><div>{items.map((item) => <label key={item.id}><input type="checkbox" checked={selected.includes(item.id)} onChange={() => onToggle(item.id)} />{getLabel(item)}</label>)}</div></div>;
}
