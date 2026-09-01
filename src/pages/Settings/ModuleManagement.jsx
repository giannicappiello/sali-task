import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Blocks, ExternalLink, Monitor, Pencil, Plus, Save, ShieldCheck, Trash2 } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import useBackNavigation from "../../hooks/useBackNavigation";
import { supabase } from "../../lib/supabaseClient";
import { getModuleIcon } from "../../config/moduleIcons";
import InfoTooltip from "../../components/InfoTooltip";
import { AssociationBadge, AssociationLinks, WorkspaceAssociationFilter, WorkspaceIconPicker, WorkspaceQuickSearch } from "./WorkspaceCatalogControls";
import { buildWorkspaceAssociations, filterKeepingSelected, matchesAssociationStatus, matchesWorkspaceSearch } from "./workspaceCatalog";
import "./modules-settings.css";

const EMPTY_MODULE = {
  codice: "",
  nome: "",
  descrizione: "",
  provider: "workspace",
  tipo: "modulo",
  area: "workspace",
  assegnabile_reparto: true,
  configurabile_ruolo: true,
  mostra_menu: true,
  attivo: true,
  ordine: 100,
  icona: "blocks",
  schermate: [],
  predefinita: "",
};

const normalizeCode = (value) => String(value || "")
  .trim()
  .toLowerCase()
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, "_")
  .replace(/^_+|_+$/g, "");

const cleanText = (value) => String(value ?? "").trim();

const screenDestination = (screen) => screen.provider === "progremes"
  ? cleanText(screen.metadati?.external_route) || "/"
  : screen.percorso;

const screenRouteSummary = (screen) => screen.provider === "progremes"
  ? `${screenDestination(screen)} · ProgreMES`
  : `${screen.percorso} · Workspace`;

const screenPreviewRoute = (screen) => cleanText(screen.percorso);

export default function ModuleManagement() {
  const goBack = useBackNavigation("/settings");
  const { isAdminUser } = useAuth();
  const [modules, setModules] = useState([]);
  const [screens, setScreens] = useState([]);
  const [links, setLinks] = useState([]);
  const [areas, setAreas] = useState([]);
  const [menus, setMenus] = useState([]);
  const [menuModules, setMenuModules] = useState([]);
  const [searchParams, setSearchParams] = useSearchParams();
  const [initialTarget] = useState(() => ({ module: searchParams.get("module") || "", screen: searchParams.get("screen") || "" }));
  const [selectedCode, setSelectedCode] = useState(() => initialTarget.module);
  const [form, setForm] = useState(EMPTY_MODULE);
  const [screenForm, setScreenForm] = useState(null);
  const [view, setView] = useState(() => initialTarget.screen || searchParams.get("view") === "screens" ? "screens" : "modules");
  const [search, setSearch] = useState(() => searchParams.get("search") || "");
  const [provider, setProvider] = useState(() => searchParams.get("origine") || "all");
  const [status, setStatus] = useState(() => searchParams.get("stato") || "all");
  const [associationStatus, setAssociationStatus] = useState(() => searchParams.get("associationStatus") || "all");
  const [areaFilter, setAreaFilter] = useState(() => searchParams.get("area") || "all");
  const [pickerSearch, setPickerSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const load = useCallback(async () => {
    const [modulesResult, screensResult, linksResult, areasResult, menusResult, menuModulesResult] = await Promise.all([
      supabase.from("workspace_moduli").select("*").order("ordine").order("nome"),
      supabase.from("workspace_schermate").select("*").order("provider").order("ordine").order("nome"),
      supabase.from("workspace_moduli_schermate").select("*").order("ordine"),
      supabase.from("workspace_aree").select("*").order("ordine").order("nome"),
      supabase.from("workspace_menu_voci").select("*").order("ordine").order("nome"),
      supabase.from("workspace_menu_moduli").select("*").order("ordine"),
    ]);
    const error = modulesResult.error || screensResult.error || linksResult.error || areasResult.error || menusResult.error || menuModulesResult.error;
    if (error) throw error;
    setModules(modulesResult.data || []);
    setScreens(screensResult.data || []);
    setLinks(linksResult.data || []);
    setAreas(areasResult.data || []);
    setMenus(menusResult.data || []);
    setMenuModules(menuModulesResult.data || []);
    const targetModule = (modulesResult.data || []).find((item) => item.codice === initialTarget.module);
    const targetScreen = (screensResult.data || []).find((item) => item.codice === initialTarget.screen);
    if (targetModule) {
      const targetLinks = (linksResult.data || []).filter((link) => link.modulo_codice === targetModule.codice);
      setForm({ ...EMPTY_MODULE, ...targetModule, schermate: targetLinks.map((link) => link.schermata_codice), predefinita: targetLinks.find((link) => link.predefinita)?.schermata_codice || "" });
    } else if (targetScreen) setScreenForm({ ...targetScreen });
  }, [initialTarget]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load().catch((error) => setMessage({ type: "error", text: error.message })), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (view !== "modules") next.set("view", view);
    if (search) next.set("search", search);
    if (provider !== "all") next.set("origine", provider);
    if (status !== "all") next.set("stato", status);
    if (associationStatus !== "all") next.set("associationStatus", associationStatus);
    if (areaFilter !== "all") next.set("area", areaFilter);
    setSearchParams(next, { replace: true });
  }, [areaFilter, associationStatus, provider, search, setSearchParams, status, view]);

  const associations = useMemo(() => buildWorkspaceAssociations({ modules, screens, links, menus, menuModules, areas }), [areas, links, menuModules, menus, modules, screens]);

  const visibleModules = useMemo(() => modules.filter((item) => {
    const matchesProvider = provider === "all" || item.provider === provider;
    const matchesStatus = status === "all" || (status === "active" ? item.attivo !== false : item.attivo === false);
    const associationCount = (associations.moduleLinks.get(item.codice)?.length || 0) + (associations.moduleMenus.get(item.codice)?.length || 0);
    const area = associations.areaByCode.get(item.area);
    return matchesProvider && matchesStatus && (areaFilter === "all" || item.area === areaFilter)
      && matchesAssociationStatus(associationCount, associationStatus)
      && matchesWorkspaceSearch(item, search, ["nome", "codice", "descrizione", "area", "provider", "percorso", () => area?.nome]);
  }), [areaFilter, associationStatus, associations, modules, provider, search, status]);

  const visibleScreens = useMemo(() => screens.filter((item) => {
    const matchesProvider = provider === "all" || item.provider === provider;
    const matchesStatus = status === "all" || (status === "active" ? item.attiva !== false : item.attiva === false);
    const associationCount = associations.screenLinks.get(item.codice)?.length || 0;
    const area = associations.areaByCode.get(item.area);
    return matchesProvider && matchesStatus && (areaFilter === "all" || item.area === areaFilter)
      && matchesAssociationStatus(associationCount, associationStatus)
      && matchesWorkspaceSearch(item, search, ["nome", "codice", "descrizione", "area", "provider", "percorso", screenDestination, () => area?.nome]);
  }), [areaFilter, associationStatus, associations, provider, screens, search, status]);

  function editModule(module) {
    const moduleLinks = links.filter((link) => link.modulo_codice === module.codice);
    setSelectedCode(module.codice);
    setScreenForm(null);
    setForm({
      ...EMPTY_MODULE,
      ...module,
      schermate: moduleLinks.map((link) => link.schermata_codice),
      predefinita: moduleLinks.find((link) => link.predefinita)?.schermata_codice || "",
    });
  }

  function createModule() {
    setSelectedCode("");
    setScreenForm(null);
    setForm({ ...EMPTY_MODULE });
  }

  function toggleScreen(code) {
    setForm((current) => {
      const selected = current.schermate.includes(code)
        ? current.schermate.filter((item) => item !== code)
        : [...current.schermate, code];
      return {
        ...current,
        schermate: selected,
        predefinita: selected.includes(current.predefinita) ? current.predefinita : "",
      };
    });
  }

  function moveScreenToPosition(code, position) {
    setForm((current) => {
      const currentIndex = current.schermate.indexOf(code);
      if (currentIndex < 0) return current;
      const targetIndex = Math.max(0, Math.min(Number(position) - 1, current.schermate.length - 1));
      if (currentIndex === targetIndex) return current;
      const ordered = [...current.schermate];
      ordered.splice(currentIndex, 1);
      ordered.splice(targetIndex, 0, code);
      return { ...current, schermate: ordered };
    });
  }

  async function saveModule(event) {
    event.preventDefault();
    if (!isAdminUser) return setMessage({ type: "error", text: "Operazione riservata all’amministratore Workspace." });
    const code = selectedCode || normalizeCode(form.codice || form.nome);
    const name = cleanText(form.nome);
    if (!code || !name) return setMessage({ type: "error", text: "Inserisci codice e nome del modulo." });
    if (!cleanText(form.area)) return setMessage({ type: "error", text: "Seleziona l’area del modulo." });
    const currentModule = modules.find((item) => item.codice === selectedCode);
    if (currentModule?.attivo !== false && form.attivo === false) {
      const usages = [...(associations.moduleLinks.get(selectedCode) || []).map((item) => `Schermata: ${item.screen?.nome || item.schermata_codice}`), ...(associations.moduleMenus.get(selectedCode) || []).map((item) => `Menu: ${item.menu?.nome || item.voce_codice}`)];
      if (usages.length && !await window.workspaceConfirm(`Disattivare “${currentModule.nome}”?\n\nQuesto elemento è utilizzato da:\n- ${usages.join("\n- ")}`)) return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const defaultScreen = screens.find((screen) => screen.codice === form.predefinita);
      const dedicatedContainer = form.tipo === "contenitore" && cleanText(form.percorso) && !cleanText(form.percorso).startsWith("/moduli/");
      const payload = {
        codice: code,
        nome: name,
        descrizione: cleanText(form.descrizione) || null,
        provider: cleanText(form.provider) || "workspace",
        tipo: form.predefinita || dedicatedContainer ? cleanText(form.tipo) || "modulo" : "contenitore",
        area: cleanText(form.area) || null,
        percorso: dedicatedContainer
          ? cleanText(form.percorso)
          : defaultScreen?.percorso || `/moduli/${code}`,
        sempre_disponibile: form.protetto ? true : form.sempre_disponibile === true,
        assegnabile_reparto: form.protetto ? false : form.assegnabile_reparto === true,
        configurabile_ruolo: form.protetto ? form.configurabile_ruolo !== false : form.configurabile_ruolo === true,
        mostra_menu: form.mostra_menu !== false,
        attivo: form.protetto ? true : form.attivo !== false,
        ordine: Number(form.ordine) || 0,
        icona: cleanText(form.icona) || "blocks",
        aggiornato_il: new Date().toISOString(),
      };
      const { error: saveError } = await supabase.rpc("admin_save_workspace_module", {
        target_module: payload,
        target_screen_codes: form.schermate,
        target_default_screen: form.predefinita || null,
      });
      if (saveError) throw saveError;
      await load();
      window.dispatchEvent(new CustomEvent("workspace:module-catalog-changed"));
      setSelectedCode(code);
      setMessage({ type: "success", text: form.schermate.length ? "Modulo e composizione salvati." : "Modulo salvato senza schermate associate." });
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setBusy(false);
    }
  }

  async function deleteModule() {
    const module = modules.find((item) => item.codice === selectedCode);
    if (!module || module.protetto || !isAdminUser) return;
    const linkedScreens = associations.moduleLinks.get(module.codice)?.map((item) => item.screen?.nome).filter(Boolean) || [];
    const linkedMenus = associations.moduleMenus.get(module.codice)?.map((item) => item.menu?.nome).filter(Boolean) || [];
    const usages = [...linkedScreens.map((name) => `Schermata: ${name}`), ...linkedMenus.map((name) => `Menu: ${name}`)];
    const warning = usages.length ? `\n\nQuesto elemento è utilizzato da:\n- ${usages.join("\n- ")}` : "\n\nIl modulo non ha associazioni.";
    if (!await window.workspaceConfirm(`Eliminare il modulo “${module.nome}”?${warning}\n\nLe schermate e i dati operativi non verranno cancellati.`)) return;
    setBusy(true);
    const { error } = await supabase.rpc("admin_delete_workspace_module", { target_code: module.codice });
    setBusy(false);
    if (error) return setMessage({ type: "error", text: error.message });
    await load();
    window.dispatchEvent(new CustomEvent("workspace:module-catalog-changed"));
    createModule();
    setMessage({ type: "success", text: "Modulo eliminato. Le schermate sono rimaste nel catalogo." });
  }

  function editScreen(screen) {
    setScreenForm({ ...screen });
    setSelectedCode("");
  }

  async function saveScreen(event) {
    event.preventDefault();
    if (!screenForm || !isAdminUser) return;
    const currentScreen = screens.find((item) => item.codice === screenForm.codice);
    const screenUsages = (associations.screenLinks.get(screenForm.codice) || []).map((item) => `Modulo: ${item.module?.nome || item.modulo_codice}`);
    if (currentScreen?.attiva !== false && screenForm.attiva === false && screenUsages.length && !await window.workspaceConfirm(`Disattivare “${currentScreen.nome}”?\n\nQuesto elemento è utilizzato da:\n- ${screenUsages.join("\n- ")}`)) return;
    setBusy(true);
    const { error } = await supabase.rpc("admin_update_workspace_screen", { target_screen: {
      codice: screenForm.codice,
      nome: screenForm.nome.trim(),
      descrizione: screenForm.descrizione?.trim() || null,
      area: screenForm.area || "workspace",
      icona: cleanText(screenForm.icona) || "blocks",
      attiva: screenForm.protetta ? true : screenForm.attiva !== false,
      ordine: Number(screenForm.ordine) || 0,
    } });
    setBusy(false);
    if (error) return setMessage({ type: "error", text: error.message });
    await load();
    window.dispatchEvent(new CustomEvent("workspace:module-catalog-changed"));
    setMessage({ type: "success", text: "Schermata aggiornata." });
  }

  const selectedModule = modules.find((item) => item.codice === selectedCode);
  const pickerScreens = useMemo(() => {
    const available = screens.filter((screen) => screen.attiva || form.schermate.includes(screen.codice));
    return filterKeepingSelected(available, pickerSearch, ["nome", "codice", "descrizione", "area", "provider", "percorso", screenDestination], form.schermate);
  }, [form.schermate, pickerSearch, screens]);

  function openModuleAssociation(item) {
    const module = item.module || item;
    setView("modules");
    editModule(module);
  }

  function openScreenAssociation(item) {
    const screen = item.screen || item;
    setView("screens");
    editScreen(screen);
  }

  return (
    <div className="module-settings-page">
      <header className="module-settings-header">
        <div>
          <button type="button" className="module-back" onClick={goBack}><ArrowLeft size={17} />Impostazioni</button>
          <span>CONFIGURAZIONE WORKSPACE</span>
          <h1>Moduli e schermate</h1>
          <p>Componi i moduli con schermate Workspace e ProgreMES senza modificare le route applicative.</p>
        </div>
        <div className="module-settings-summary"><strong>{modules.filter((item) => item.attivo).length}</strong><span>moduli attivi<InfoTooltip label="Moduli attivi" text="Numero di moduli del catalogo Workspace con stato attivo." /></span><strong>{screens.filter((item) => item.attiva).length}</strong><span>schermate disponibili<InfoTooltip label="Schermate disponibili" text="Numero di schermate del catalogo Workspace con stato attivo." /></span></div>
      </header>

      {message ? <div className={`module-message ${message.type}`}>{message.text}</div> : null}

      <div className="module-toolbar">
        <div className="module-view-tabs">
          <button type="button" className={view === "modules" ? "active" : ""} onClick={() => setView("modules")}><Blocks size={17} />Moduli</button>
          <button type="button" className={view === "screens" ? "active" : ""} onClick={() => setView("screens")}><Monitor size={17} />Schermate</button>
        </div>
        <WorkspaceQuickSearch value={search} onChange={setSearch}/>
        <select value={provider} onChange={(event) => setProvider(event.target.value)}><option value="all">Tutte le origini</option><option value="workspace">Workspace</option><option value="progremes">ProgreMES</option></select>
        <select value={areaFilter} onChange={(event) => setAreaFilter(event.target.value)} aria-label="Filtra per area"><option value="all">Tutte le aree</option>{areas.map((area) => <option key={area.codice} value={area.codice}>{area.nome}</option>)}</select>
        <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filtra per stato"><option value="all">Tutti gli stati</option><option value="active">Attivi</option><option value="inactive">Non attivi</option></select>
        <WorkspaceAssociationFilter value={associationStatus} onChange={setAssociationStatus}/>
        {view === "modules" && isAdminUser ? <button type="button" className="primary-action" onClick={createModule}><Plus size={17} />Nuovo modulo</button> : null}
      </div>

      {view === "modules" ? (
        <div className="module-composer-grid">
          <section className="module-catalog-list">
            {visibleModules.map((item) => {
              const screenAssociations = associations.moduleLinks.get(item.codice) || [];
              const menuAssociations = associations.moduleMenus.get(item.codice) || [];
              const associated = screenAssociations.length + menuAssociations.length > 0;
              const ModuleIcon = getModuleIcon(item.icona, item.protetto ? ShieldCheck : Blocks);
              const defaultScreen = screenAssociations.find((link) => link.predefinita)?.screen || screenAssociations[0]?.screen;
              const builderTarget = item.tipo === "contenitore" || !defaultScreen
                ? `/settings/layout-builder/module/${encodeURIComponent(item.codice)}`
                : `/settings/layout-builder/screen/${encodeURIComponent(defaultScreen.codice)}`;
              return <div className={`module-catalog-item catalog-with-associations ${selectedCode === item.codice ? "active" : ""}`} key={item.codice}><button type="button" className="module-catalog-select" onClick={() => editModule(item)}><span className="module-list-icon"><ModuleIcon /></span><span><strong>{item.nome}</strong><small>{item.codice} · {associations.areaByCode.get(item.area)?.nome || item.area} · {item.provider}</small><span className="catalog-relations">Schermate: {screenAssociations.slice(0,2).map((link) => link.screen?.nome).filter(Boolean).join(", ") || "nessuna"}{screenAssociations.length > 2 ? ` · + ${screenAssociations.length - 2}` : ""} · Menu: {menuAssociations.slice(0,2).map((link) => link.menu?.nome).filter(Boolean).join(", ") || "nessuno"}</span></span><AssociationBadge associated={associated}/><Pencil size={16} /></button><Link className="module-preview-link" to={builderTarget} title={`Modifica la struttura di ${defaultScreen && item.tipo !== "contenitore" ? defaultScreen.nome : item.nome}`}><ExternalLink size={16} /><span>Apri</span></Link></div>;
            })}
            {visibleModules.length === 0 ? <p className="catalog-empty">Nessun modulo corrisponde ai filtri.</p> : null}
          </section>

          <form className="module-editor" onSubmit={saveModule}>
            <div className="module-editor-title"><div><h2>{selectedModule ? `Modifica ${selectedModule.nome}` : "Nuovo modulo"}</h2><p>{form.protetto ? "Modulo fondamentale protetto." : "Configura identità, visibilità e composizione."}</p></div>{selectedModule && !selectedModule.protetto && isAdminUser ? <button type="button" className="danger-action" onClick={deleteModule}><Trash2 size={17} />Elimina</button> : null}</div>
            <div className="module-fields">
              <label>Nome<input required disabled={!isAdminUser} value={form.nome} onChange={(event) => setForm((current) => ({ ...current, nome: event.target.value, codice: selectedCode ? current.codice : normalizeCode(event.target.value) }))} /></label>
              <label>Codice<input required disabled={Boolean(selectedCode) || !isAdminUser} value={form.codice} onChange={(event) => setForm((current) => ({ ...current, codice: normalizeCode(event.target.value) }))} /></label>
              <label>Origine<select disabled={form.protetto || !isAdminUser} value={form.provider} onChange={(event) => setForm((current) => ({ ...current, provider: event.target.value }))}><option value="workspace">Workspace</option><option value="progremes">ProgreMES</option></select></label>
              <label>Area<select required disabled={!isAdminUser} value={form.area || ""} onChange={(event) => setForm((current) => ({ ...current, area: event.target.value }))}><option value="">Seleziona area</option>{areas.filter((area) => area.attiva || area.codice === form.area).map((area) => <option key={area.codice} value={area.codice}>{area.nome}</option>)}</select></label>
              <label className="wide">Descrizione<textarea rows="3" disabled={!isAdminUser} value={form.descrizione || ""} onChange={(event) => setForm((current) => ({ ...current, descrizione: event.target.value }))} /></label>
              <label>Ordine<input type="number" disabled={!isAdminUser} value={form.ordine} onChange={(event) => setForm((current) => ({ ...current, ordine: event.target.value }))} /></label>
              <WorkspaceIconPicker value={form.icona} disabled={!isAdminUser} description="Scegli il simbolo mostrato nel menu, nella Home e nell’intestazione del modulo." onChange={(icona) => setForm((current) => ({ ...current, icona }))}/>
            </div>
            <div className="module-flags">
              <label><input type="checkbox" disabled={form.protetto || !isAdminUser} checked={form.attivo !== false} onChange={(event) => setForm((current) => ({ ...current, attivo: event.target.checked }))} />Modulo attivo</label>
              <label><input type="checkbox" disabled={!isAdminUser} checked={form.mostra_menu !== false} onChange={(event) => setForm((current) => ({ ...current, mostra_menu: event.target.checked }))} />Mostra nel menu agli utenti autorizzati</label>
              <label><input type="checkbox" disabled={form.protetto || !isAdminUser} checked={form.assegnabile_reparto === true} onChange={(event) => setForm((current) => ({ ...current, assegnabile_reparto: event.target.checked }))} />Assegnabile ai reparti</label>
              <label><input type="checkbox" disabled={!isAdminUser} checked={form.configurabile_ruolo !== false} onChange={(event) => setForm((current) => ({ ...current, configurabile_ruolo: event.target.checked }))} />Livelli operativi per ruolo</label>
            </div>
            <div className="screen-picker">
              <div><h3>Schermate del modulo</h3><p>Associazione e schermata iniziale sono facoltative; l’ordine è specifico di questo modulo. Senza una pagina iniziale il modulo viene mostrato come contenitore a card.</p></div>
              <WorkspaceQuickSearch value={pickerSearch} onChange={setPickerSearch} label="Ricerca schermata da associare" placeholder="Ricerca schermata per nome, codice, area, origine o route"/>
              <label className={`container-default-option ${!form.predefinita ? "selected" : ""}`}><input type="radio" name="default-screen" disabled={!isAdminUser} checked={!form.predefinita} onChange={() => setForm((current) => ({ ...current, predefinita: "" }))} /><span><strong>Nessuna schermata iniziale</strong><small>Apri il modulo come contenitore e mostra le schermate associate sotto forma di card.</small></span></label>
              {pickerScreens.map((screen) => {
                const checked = form.schermate.includes(screen.codice);
                const position = form.schermate.indexOf(screen.codice) + 1;
                const screenLinks = links.filter((link) => link.schermata_codice === screen.codice);
                const isCurrentLink = screenLinks.some((link) => link.modulo_codice === selectedCode);
                const protectedLastLink = screen.protetta && isCurrentLink && screenLinks.length === 1;
                return <div className={`screen-picker-row ${checked ? "selected" : ""}`} key={screen.codice}><label><input type="checkbox" disabled={!isAdminUser || protectedLastLink} checked={checked} onChange={() => toggleScreen(screen.codice)} /><span><strong>{screen.nome}</strong><small>{screenRouteSummary(screen)}{protectedLastLink ? " · ultimo collegamento protetto" : ""}</small></span></label><div className="screen-link-options">{checked ? <label className="screen-order-field"><span>Ordine nel modulo</span><select disabled={!isAdminUser} value={position} onChange={(event) => moveScreenToPosition(screen.codice, event.target.value)}>{form.schermate.map((code, index) => <option key={code} value={index + 1}>{index + 1}</option>)}</select></label> : null}<label className="default-screen"><input type="radio" name="default-screen" disabled={!checked || !isAdminUser} checked={form.predefinita === screen.codice} onChange={() => setForm((current) => ({ ...current, predefinita: screen.codice }))} />Iniziale</label></div></div>;
              })}
            </div>
            <section className="workspace-associations"><h3>Associazioni</h3><div className="association-group"><strong>In ingresso · Voci menu</strong><AssociationLinks items={associations.moduleMenus.get(form.codice) || []} getKey={(item) => item.voce_codice} getLabel={(item) => item.menu?.nome || item.voce_codice} onOpen={() => { window.location.href = "/settings/menu?view=menu"; }}/></div><div className="association-group"><strong>In uscita · Schermate</strong><AssociationLinks items={associations.moduleLinks.get(form.codice) || []} getKey={(item) => item.schermata_codice} getLabel={(item) => `${item.screen?.nome || item.schermata_codice}${item.predefinita ? " · predefinita" : ""}`} onOpen={openScreenAssociation}/></div><div className="association-group"><strong>Area e dipendenze</strong><span>{associations.areaByCode.get(form.area)?.nome || form.area || "Nessuna area"}{form.dipendenze?.length ? ` · Dipendenze: ${form.dipendenze.join(", ")}` : " · Nessuna dipendenza"}</span></div></section>
            {isAdminUser ? <button className="primary-action module-save" disabled={busy}><Save size={18} />{busy ? "Salvataggio..." : "Salva modulo"}</button> : null}
          </form>
        </div>
      ) : (
        <div className="module-composer-grid">
          <section className="module-catalog-list">
            {visibleScreens.map((screen) => { const moduleAssociations=associations.screenLinks.get(screen.codice)||[]; const ScreenIcon=getModuleIcon(screen.icona,screen.protetta?ShieldCheck:Monitor); return <div className={`module-catalog-item catalog-with-associations ${screenForm?.codice === screen.codice ? "active" : ""}`} key={screen.codice}><button type="button" className="module-catalog-select" onClick={() => editScreen(screen)}><span className="module-list-icon"><ScreenIcon /></span><span><strong>{screen.nome}</strong><small>{screen.codice} · {screenRouteSummary(screen)}</small><span className="catalog-relations">Moduli: {moduleAssociations.slice(0,2).map((link)=>link.module?.nome).filter(Boolean).join(", ")||"nessuno"}{moduleAssociations.length>2?` · + ${moduleAssociations.length-2}`:""}</span></span><AssociationBadge associated={moduleAssociations.length>0} orphanLabel="Non raggiungibile"/><Pencil size={16} /></button><Link className="module-preview-link" to={`/settings/layout-builder/screen/${encodeURIComponent(screen.codice)}`} title={`Modifica la struttura della schermata ${screen.nome}`}><ExternalLink size={16} /><span>Apri</span></Link></div>; })}
            {visibleScreens.length === 0 ? <p className="catalog-empty">Nessuna schermata corrisponde ai filtri.</p> : null}
          </section>
          <form className="module-editor" onSubmit={saveScreen}>
            {screenForm ? <><div className="module-editor-title"><div><h2>{screenForm.nome}</h2><p>La route e il componente restano controllati dal codice applicativo.</p></div></div><div className="module-fields"><label>Nome<input required disabled={!isAdminUser} value={screenForm.nome} onChange={(event) => setScreenForm((current) => ({ ...current, nome: event.target.value }))} /></label><label>Codice<input disabled value={screenForm.codice} /></label><label>Area<select required disabled={!isAdminUser} value={screenForm.area || "workspace"} onChange={(event) => setScreenForm((current) => ({ ...current, area: event.target.value }))}>{areas.filter((area) => area.attiva || area.codice === screenForm.area).map((area) => <option key={area.codice} value={area.codice}>{area.nome}</option>)}</select></label><label className="wide">Collegamento Workspace<input disabled value={screenForm.percorso} /></label>{screenForm.provider === "progremes" ? <label className="wide">Destinazione ProgreMES<input disabled value={screenDestination(screenForm)} /></label> : null}<label className="wide">Descrizione<textarea rows="3" disabled={!isAdminUser} value={screenForm.descrizione || ""} onChange={(event) => setScreenForm((current) => ({ ...current, descrizione: event.target.value }))} /></label><label>Ordine nel catalogo<input type="number" disabled={!isAdminUser} value={screenForm.ordine} onChange={(event) => setScreenForm((current) => ({ ...current, ordine: event.target.value }))} /><small>Non modifica la posizione nei moduli.</small></label><WorkspaceIconPicker value={screenForm.icona || "blocks"} disabled={!isAdminUser} description="Usata nelle card del modulo e nell’intestazione della schermata." onChange={(icona) => setScreenForm((current) => ({ ...current,icona }))}/></div><div className="module-flags"><label><input type="checkbox" disabled={screenForm.protetta || !isAdminUser} checked={screenForm.attiva !== false} onChange={(event) => setScreenForm((current) => ({ ...current, attiva: event.target.checked }))} />Schermata attiva</label></div><section className="workspace-associations"><h3>Associazioni</h3><div className="association-group"><strong>In ingresso · Moduli</strong><AssociationLinks items={associations.screenLinks.get(screenForm.codice)||[]} getKey={(item)=>item.modulo_codice} getLabel={(item)=>`${item.module?.nome||item.modulo_codice}${item.predefinita?" · predefinita":""}`} onOpen={openModuleAssociation}/></div><div className="association-group"><strong>In uscita · Route</strong><a href={screenPreviewRoute(screenForm)||undefined}>{screenDestination(screenForm)||"Nessuna route"}</a></div></section>{isAdminUser ? <button className="primary-action module-save" disabled={busy}><Save size={18} />Salva schermata</button> : null}</> : <div className="module-empty-editor"><Monitor size={42} /><h2>Seleziona una schermata</h2><p>Le schermate Workspace sono registrate dal codice; quelle ProgreMES arrivano dalla sincronizzazione.</p></div>}
          </form>
        </div>
      )}
    </div>
  );
}
