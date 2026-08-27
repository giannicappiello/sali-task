import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ExternalLink, FolderTree, Menu as MenuIcon, Plus, Save, Trash2 } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import useBackNavigation from "../../hooks/useBackNavigation";
import { getModuleIcon } from "../../config/moduleIcons";
import { supabase } from "../../lib/supabaseClient";
import { AssociationBadge, AssociationLinks, WorkspaceAssociationFilter, WorkspaceIconPicker, WorkspaceQuickSearch } from "./WorkspaceCatalogControls";
import { buildWorkspaceAssociations, filterKeepingSelected, matchesAssociationStatus, matchesWorkspaceSearch } from "./workspaceCatalog";
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
  const [searchParams, setSearchParams] = useSearchParams();
  const [view, setView] = useState(() => searchParams.get("view") === "menu" ? "menu" : "areas");
  const [catalog, setCatalog] = useState({ areas: [], menus: [], menuModules: [], modules: [], screens: [], moduleScreens: [], roles: [], departments: [], users: [], roleAreas: [], departmentAreas: [], userAreas: [] });
  const [areaForm, setAreaForm] = useState(EMPTY_AREA);
  const [menuForm, setMenuForm] = useState(EMPTY_MENU);
  const [selectedArea, setSelectedArea] = useState("");
  const [selectedMenu, setSelectedMenu] = useState("");
  const [search, setSearch] = useState(() => searchParams.get("search") || "");
  const [associationStatus, setAssociationStatus] = useState(() => searchParams.get("associationStatus") || "all");
  const [pickerSearch, setPickerSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const load = useCallback(async () => {
    const results = await Promise.all([
      supabase.from("workspace_aree").select("*").order("ordine").order("nome"),
      supabase.from("workspace_menu_voci").select("*").order("ordine").order("nome"),
      supabase.from("workspace_menu_moduli").select("*").order("ordine"),
      supabase.from("workspace_moduli").select("codice,nome,descrizione,icona,area,attivo,mostra_menu,ordine").order("ordine").order("nome"),
      supabase.from("workspace_schermate").select("codice,nome,descrizione,area,provider,percorso,attiva").order("ordine").order("nome"),
      supabase.from("workspace_moduli_schermate").select("*").order("ordine"),
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
      screens: results[4].data || [], moduleScreens: results[5].data || [], roles: results[6].data || [], departments: results[7].data || [], users: results[8].data || [], roleAreas: results[9].data || [],
      departmentAreas: results[10].data || [], userAreas: results[11].data || [],
    });
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load().catch((error) => setMessage({ type: "error", text: error.message })),0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (view !== "areas") next.set("view", view);
    if (search) next.set("search", search);
    if (associationStatus !== "all") next.set("associationStatus", associationStatus);
    setSearchParams(next, { replace: true });
  }, [associationStatus, search, setSearchParams, view]);

  const associations = useMemo(() => buildWorkspaceAssociations({ modules: catalog.modules, screens: catalog.screens, links: catalog.moduleScreens, menus: catalog.menus, menuModules: catalog.menuModules, areas: catalog.areas }), [catalog]);

  const visibleAreas = useMemo(() => catalog.areas.filter((area) => matchesWorkspaceSearch(area, search, ["nome", "codice", "descrizione"])), [catalog.areas, search]);
  const visibleMenus = useMemo(() => catalog.menus.filter((menu) => {
    const moduleLinks = associations.menuModuleLinks.get(menu.codice) || [];
    const searchableModules = moduleLinks.map((link) => `${link.module?.nome || ""} ${link.module?.codice || ""} ${link.module?.area || ""}`).join(" ");
    return matchesAssociationStatus(moduleLinks.length, associationStatus) && matchesWorkspaceSearch(menu, search, ["nome", "codice", "descrizione", "percorso", () => searchableModules]);
  }), [associationStatus, associations, catalog.menus, search]);

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
    const usedBy = catalog.modules.filter((item) => item.area === area?.codice).map((item) => item.nome);
    const warning = usedBy.length ? `\n\nQuesto elemento è utilizzato da:\n- ${usedBy.join("\n- ")}` : "";
    if (!area || area.protetta || !await window.workspaceConfirm(`Eliminare l’area “${area.nome}”?${warning}`)) return;
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
    const currentMenu = catalog.menus.find((item) => item.codice === selectedMenu);
    if (currentMenu?.attiva !== false && menuForm.attiva === false) {
      const usages = (associations.menuModuleLinks.get(selectedMenu) || []).map((item) => `Modulo: ${item.module?.nome || item.modulo_codice}`);
      if (usages.length && !await window.workspaceConfirm(`Disattivare “${currentMenu.nome}”?\n\nQuesto elemento è utilizzato da:\n- ${usages.join("\n- ")}`)) return;
    }
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
    const usedBy = (associations.menuModuleLinks.get(menu?.codice) || []).map((item) => item.module?.nome || item.modulo_codice);
    const warning = usedBy.length ? `\n\nQuesto elemento è utilizzato da:\n- Modulo: ${usedBy.join("\n- Modulo: ")}` : "\n\nLa voce non ha destinazioni associate.";
    if (!menu || !await window.workspaceConfirm(`Eliminare la voce di menu “${menu.nome}”?${warning}`)) return;
    const { error } = await supabase.from("workspace_menu_voci").delete().eq("codice", menu.codice);
    if (error) return setMessage({ type: "error", text: error.message });
    setSelectedMenu(""); setMenuForm(EMPTY_MENU); await load(); window.dispatchEvent(new CustomEvent("workspace:module-catalog-changed"));
  }

  const menuPickerModules = useMemo(() => {
    const available = catalog.modules.filter((module) => module.attivo || menuForm.moduli.includes(module.codice));
    return filterKeepingSelected(available, pickerSearch, ["nome", "codice", "descrizione", "area"], menuForm.moduli);
  }, [catalog.modules, menuForm.moduli, pickerSearch]);

  const selectedMenuScreens = useMemo(() => {
    const unique = new Map();
    (associations.menuModuleLinks.get(menuForm.codice) || []).forEach((menuLink) => {
      (associations.moduleLinks.get(menuLink.modulo_codice) || []).forEach((screenLink) => {
        if (screenLink.screen) unique.set(screenLink.schermata_codice, screenLink.screen);
      });
    });
    return [...unique.values()];
  }, [associations, menuForm.codice]);

  return <div className="module-settings-page menu-settings-page">
    <header className="module-settings-header"><div><button type="button" className="module-back" onClick={goBack}><ArrowLeft size={17} />Impostazioni</button><span>NAVIGAZIONE E SICUREZZA</span><h1>Aree e menu</h1><p>Definisci gli accessi alle Aree e raggruppa più moduli nella stessa voce di menu.</p></div></header>
    {message ? <div className={`module-message ${message.type}`}>{message.text}</div> : null}
    <div className="module-toolbar"><div className="module-view-tabs"><button type="button" className={view === "areas" ? "active" : ""} onClick={() => setView("areas")}><FolderTree size={17} />Aree</button><button type="button" className={view === "menu" ? "active" : ""} onClick={() => setView("menu")}><MenuIcon size={17} />Menu</button></div><WorkspaceQuickSearch value={search} onChange={setSearch}/>{view === "menu" ? <WorkspaceAssociationFilter value={associationStatus} onChange={setAssociationStatus}/> : null}<button type="button" className="primary-action" onClick={createItem}><Plus size={17} />Nuovo</button></div>
    {view === "areas" ? <div className="module-composer-grid">
      <section className="module-catalog-list">{visibleAreas.map((area) => { const Icon=getModuleIcon(area.icona,FolderTree); return <button type="button" key={area.codice} className={selectedArea === area.codice ? "active" : ""} onClick={() => editArea(area)}><span className="module-list-icon"><Icon /></span><span><strong>{area.nome}</strong><small>{area.codice} · {catalog.modules.filter((item) => item.area === area.codice).length} moduli</small></span><span className={area.attiva ? "status-on" : "status-off"}>{area.attiva ? "Attiva" : "Disattiva"}</span></button>; })}{visibleAreas.length === 0 ? <p className="catalog-empty">Nessuna area corrisponde alla ricerca.</p> : null}</section>
      <form className="module-editor" onSubmit={saveArea}><div className="module-editor-title"><div><h2>{selectedArea ? `Modifica ${areaForm.nome}` : "Nuova Area"}</h2><p>L’accesso è concesso se deriva dal ruolo, da un reparto o dall’eccezione individuale.</p></div>{selectedArea && !areaForm.protetta ? <button type="button" className="danger-action" onClick={deleteArea}><Trash2 size={17} />Elimina</button> : null}</div><div className="module-fields"><label>Nome<input required value={areaForm.nome} onChange={(event) => setAreaForm((current) => ({ ...current,nome:event.target.value,codice:selectedArea?current.codice:normalizeCode(event.target.value) }))} /></label><label>Codice<input required disabled={Boolean(selectedArea)} value={areaForm.codice} onChange={(event) => setAreaForm((current) => ({ ...current,codice:normalizeCode(event.target.value) }))} /></label><label className="wide">Descrizione<textarea rows="2" value={areaForm.descrizione || ""} onChange={(event) => setAreaForm((current) => ({ ...current,descrizione:event.target.value }))} /></label><label>Ordine<input type="number" value={areaForm.ordine} onChange={(event) => setAreaForm((current) => ({ ...current,ordine:event.target.value }))} /></label><label className="check-line"><input type="checkbox" checked={areaForm.attiva !== false} onChange={(event) => setAreaForm((current) => ({ ...current,attiva:event.target.checked }))} />Area attiva</label><WorkspaceIconPicker value={areaForm.icona} onChange={(icona) => setAreaForm((current) => ({ ...current,icona }))} /></div><AccessPicker title="Ruoli autorizzati" items={catalog.roles.filter((item) => !item.amministratore_workspace)} selected={areaForm.ruoli} getLabel={(item) => item.nome} onToggle={(id) => toggle("ruoli",id,setAreaForm)} /><AccessPicker title="Reparti autorizzati" items={catalog.departments.filter((item) => item.attivo !== false)} selected={areaForm.reparti} getLabel={(item) => item.nome} onToggle={(id) => toggle("reparti",id,setAreaForm)} /><AccessPicker title="Eccezioni individuali aggiuntive" items={catalog.users.filter((item) => item.attivo !== false)} selected={areaForm.utenti} getLabel={(item) => `${item.nome || ""} ${item.cognome || ""}`.trim() || item.email} onToggle={(id) => toggle("utenti",id,setAreaForm)} /><section className="workspace-associations"><h3>Associazioni</h3><div className="association-group"><strong>In uscita · Moduli</strong><span>{catalog.modules.filter((item) => item.area === areaForm.codice).map((item) => item.nome).join(", ") || "Nessun modulo"}</span></div></section><button className="primary-action module-save" disabled={busy}><Save size={18} />Salva Area</button></form>
    </div> : <div className="module-composer-grid">
      <section className="module-catalog-list">{visibleMenus.map((menu) => { const Icon=getModuleIcon(menu.icona,MenuIcon); const moduleLinks=associations.menuModuleLinks.get(menu.codice)||[]; return <div className={`module-catalog-item catalog-with-associations ${selectedMenu === menu.codice ? "active" : ""}`} key={menu.codice}><button type="button" className="module-catalog-select" onClick={() => editMenu(menu)}><span className="module-list-icon"><Icon /></span><span><strong>{menu.nome}</strong><small>{menu.codice} · {moduleLinks.slice(0,2).map((row)=>row.module?.nome).filter(Boolean).join(", ")||"nessun modulo"}{moduleLinks.length>2?` · + ${moduleLinks.length-2}`:""}</small></span><AssociationBadge associated={moduleLinks.length>0}/><span /></button><Link className="module-preview-link" to={`/settings/layout-builder/menu/${encodeURIComponent(menu.codice)}`} title={`Modifica la struttura della voce ${menu.nome}`}><ExternalLink size={16}/><span>Apri</span></Link></div>; })}{visibleMenus.length===0?<p className="catalog-empty">Nessuna voce menu corrisponde ai filtri.</p>:null}</section>
      <form className="module-editor" onSubmit={saveMenu}><div className="module-editor-title"><div><h2>{selectedMenu ? `Modifica ${menuForm.nome}` : "Nuova voce di menu"}</h2><p>Con un solo modulo apre direttamente il modulo; con più moduli apre un contenitore a card.</p></div>{selectedMenu ? <button type="button" className="danger-action" onClick={deleteMenu}><Trash2 size={17} />Elimina</button> : null}</div><div className="module-fields"><label>Nome<input required value={menuForm.nome} onChange={(event) => setMenuForm((current) => ({ ...current,nome:event.target.value,codice:selectedMenu?current.codice:normalizeCode(event.target.value) }))} /></label><label>Codice<input required disabled={Boolean(selectedMenu)} value={menuForm.codice} onChange={(event) => setMenuForm((current) => ({ ...current,codice:normalizeCode(event.target.value) }))} /></label><label className="wide">Descrizione<textarea rows="2" value={menuForm.descrizione || ""} onChange={(event) => setMenuForm((current) => ({ ...current,descrizione:event.target.value }))} /></label><label>Ordine<input type="number" value={menuForm.ordine} onChange={(event) => setMenuForm((current) => ({ ...current,ordine:event.target.value }))} /></label><label className="check-line"><input type="checkbox" checked={menuForm.attiva !== false} onChange={(event) => setMenuForm((current) => ({ ...current,attiva:event.target.checked }))} />Voce attiva</label><WorkspaceIconPicker value={menuForm.icona} description="Usata nel menu laterale, nella Home e nel contenitore della voce." onChange={(icona) => setMenuForm((current) => ({ ...current,icona }))} /></div><div className="menu-module-picker"><h3>Moduli nella voce</h3><p>Seleziona i moduli e assegna la posizione con cui compariranno nel contenitore. Lo stesso modulo può essere presente anche in altre voci di menu.</p><WorkspaceQuickSearch value={pickerSearch} onChange={setPickerSearch} label="Ricerca modulo da associare" placeholder="Ricerca modulo per nome, codice, descrizione o area"/>{menuPickerModules.map((module) => { const checked=menuForm.moduli.includes(module.codice); const position=menuForm.moduli.indexOf(module.codice)+1; return <div className={`menu-module-row ${checked?"selected":""}`} key={module.codice}><label><input type="checkbox" checked={checked} onChange={() => toggle("moduli",module.codice,setMenuForm)} /><span><strong>{module.nome}</strong><small>{catalog.areas.find((area) => area.codice===module.area)?.nome || module.area}</small></span></label>{checked ? <label className="menu-module-order"><span>Posizione</span><select value={position} onChange={(event) => moveMenuModuleToPosition(module.codice,event.target.value)}>{menuForm.moduli.map((code,index) => <option key={code} value={index+1}>{index+1}</option>)}</select></label> : null}</div>; })}</div><section className="workspace-associations"><h3>Associazioni</h3><div className="association-group"><strong>In uscita · Moduli</strong><AssociationLinks items={associations.menuModuleLinks.get(menuForm.codice)||[]} getKey={(item)=>item.modulo_codice} getLabel={(item)=>item.module?.nome||item.modulo_codice} onOpen={(item) => { window.location.href=`/settings/modules?module=${encodeURIComponent(item.modulo_codice)}`; }}/></div><div className="association-group"><strong>Destinazioni · Schermate</strong><AssociationLinks items={selectedMenuScreens} getKey={(item)=>item.codice} getLabel={(item)=>item.nome} onOpen={(item) => { window.location.href=`/settings/modules?screen=${encodeURIComponent(item.codice)}`; }} empty="Nessuna schermata raggiungibile"/></div></section><button className="primary-action module-save" disabled={busy}><Save size={18} />Salva voce</button></form>
    </div>}
  </div>;
}

function AccessPicker({ title, items, selected, getLabel, onToggle }) {
  const [search, setSearch] = useState("");
  const visibleItems = filterKeepingSelected(items, search, [(item) => getLabel(item)], selected, (item) => item.id);
  return <div className="menu-access-picker"><h3>{title}</h3><WorkspaceQuickSearch value={search} onChange={setSearch} label={`Ricerca in ${title}`} placeholder={`Ricerca ${title.toLocaleLowerCase("it-IT")}`}/><div>{visibleItems.map((item) => <label key={item.id}><input type="checkbox" checked={selected.includes(item.id)} onChange={() => onToggle(item.id)} />{getLabel(item)}</label>)}</div></div>;
}
