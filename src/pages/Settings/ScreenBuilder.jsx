import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, Copy, Eye, Link2, Monitor, PanelTop, Plus, Save, Smartphone, Tablet, Trash2, Type } from "lucide-react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import WorkspaceScreenComposition from "../../components/WorkspaceScreenComposition";
import { DEFAULT_WORKSPACE_LAYOUT, normalizeWorkspaceLayout } from "../../components/workspaceScreenLayoutConfig";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabaseClient";
import "./screen-builder.css";

const TARGETS = Object.freeze({
  screen: { table: "workspace_schermate", code: "codice", route: (item) => item.percorso },
  module: { table: "workspace_moduli", code: "codice", route: (item) => item.percorso || `/moduli/${item.codice}` },
  menu: { table: "workspace_menu_voci", code: "codice", route: (item) => `/menu/${item.codice}` },
});

const BLOCKS = Object.freeze([
  { type: "text", label: "Testo", icon: Type },
  { type: "panel", label: "Pannello", icon: PanelTop },
  { type: "button", label: "Pulsante", icon: Plus },
  { type: "links", label: "Link", icon: Link2 },
  { type: "divider", label: "Separatore", icon: Monitor },
]);

const cleanCode = (value) => String(value || "").trim().toLowerCase().normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const newId = () => globalThis.crypto?.randomUUID?.() || `block-${Date.now()}-${Math.random().toString(16).slice(2)}`;

function createBlock(type) {
  const common = { id: newId(), type, width: "full" };
  if (type === "text") return { ...common, title: "Nuovo titolo", text: "Inserisci qui il testo." };
  if (type === "panel") return { ...common, title: "Nuovo pannello", text: "Descrizione del pannello." };
  if (type === "button") return { ...common, label: "Apri", href: "/home", variant: "primary" };
  if (type === "links") return { ...common, title: "Collegamenti", items: [{ label: "Home", href: "/home" }] };
  return common;
}

export default function ScreenBuilder() {
  const { targetType = "", targetCode = "" } = useParams();
  const navigate = useNavigate();
  const { isAdminUser } = useAuth();
  const targetDefinition = TARGETS[targetType];
  const [target, setTarget] = useState(null);
  const [layout, setLayout] = useState(DEFAULT_WORKSPACE_LAYOUT);
  const [selectedId, setSelectedId] = useState("system-content");
  const [viewport, setViewport] = useState("desktop");
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [clone, setClone] = useState({ name: "", code: "", description: "" });

  const load = useCallback(async () => {
    if (!targetDefinition) return;
    setLoading(true);
    const [targetResult, layoutResult, versionsResult] = await Promise.all([
      supabase.from(targetDefinition.table).select("*").eq(targetDefinition.code, targetCode).maybeSingle(),
      supabase.from("workspace_builder_layouts").select("layout,current_version,updated_at").eq("target_type", targetType).eq("target_code", targetCode).maybeSingle(),
      supabase.from("workspace_builder_versions").select("version,created_at,target_name,layout").eq("target_type", targetType).eq("target_code", targetCode).order("version", { ascending: false }).limit(8),
    ]);
    const error = targetResult.error || layoutResult.error || versionsResult.error;
    if (error) throw error;
    const item = targetResult.data;
    setTarget(item ? { ...item, name: item.nome || "", description: item.descrizione || "" } : null);
    const customScreen = targetType === "screen" && item?.chiave_componente === "screen-builder";
    setLayout(normalizeWorkspaceLayout(layoutResult.data?.layout || DEFAULT_WORKSPACE_LAYOUT, { requireSystemContent: !customScreen }));
    setVersions(versionsResult.data || []);
    setLoading(false);
  }, [targetCode, targetDefinition, targetType]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load().catch((error) => { setMessage({ type: "error", text: error.message }); setLoading(false); }), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const blocks = layout.blocks || [];
  const selected = blocks.find((block) => block.id === selectedId) || blocks[0];
  const previewRoute = target ? targetDefinition?.route(target) : "";

  function updateBlock(patch) {
    setLayout((current) => ({ ...current, blocks: current.blocks.map((block) => block.id === selected?.id ? { ...block, ...patch } : block) }));
  }

  function addBlock(type) {
    const block = createBlock(type);
    setLayout((current) => ({ ...current, blocks: [...current.blocks, block] }));
    setSelectedId(block.id);
  }

  function moveBlock(direction) {
    const index = blocks.findIndex((block) => block.id === selected?.id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= blocks.length) return;
    const next = [...blocks];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    setLayout((current) => ({ ...current, blocks: next }));
  }

  function removeBlock() {
    if (!selected || selected.type === "system-content" || selected.locked) return;
    const remaining = blocks.filter((block) => block.id !== selected.id);
    setLayout((current) => ({ ...current, blocks: remaining }));
    setSelectedId(remaining[0]?.id || "");
  }

  function restoreVersion(version) {
    const customScreen = targetType === "screen" && target?.chiave_componente === "screen-builder";
    const restored = normalizeWorkspaceLayout(version.layout, { requireSystemContent: !customScreen });
    setLayout(restored);
    setSelectedId(restored.blocks[0]?.id || "system-content");
    setMessage({ type: "success", text: `Versione ${version.version} caricata in anteprima. Salva per pubblicarla come nuova versione.` });
  }

  async function save() {
    if (!target || !isAdminUser) return;
    setBusy(true); setMessage(null);
    const { data, error } = await supabase.rpc("admin_save_workspace_builder_layout", {
      p_target_type: targetType,
      p_target_code: targetCode,
      p_target_name: target.name.trim(),
      p_target_description: target.description?.trim() || "",
      p_target_layout: normalizeWorkspaceLayout(layout, { requireSystemContent: targetType !== "screen" || target.chiave_componente !== "screen-builder" }),
    });
    setBusy(false);
    if (error) return setMessage({ type: "error", text: error.message });
    setMessage({ type: "success", text: `Versione ${data} pubblicata.` });
    window.dispatchEvent(new CustomEvent("workspace:module-catalog-changed"));
    window.dispatchEvent(new CustomEvent("workspace:builder-layout-changed"));
    await load();
  }

  async function saveAsNew(event) {
    event.preventDefault();
    const code = cleanCode(clone.code || clone.name);
    if (!code || !clone.name.trim()) return setMessage({ type: "error", text: "Inserisci nome e codice della nuova schermata." });
    const customBlocks = blocks.filter((block) => block.type !== "system-content");
    const clonedLayout = { version: 1, blocks: customBlocks.length ? customBlocks : [createBlock("panel")] };
    setBusy(true);
    const { data, error } = await supabase.rpc("admin_clone_workspace_builder_screen", {
      p_source_code: targetCode,
      p_new_code: code,
      p_new_name: clone.name.trim(),
      p_new_description: clone.description.trim(),
      p_target_layout: clonedLayout,
    });
    setBusy(false);
    if (error) return setMessage({ type: "error", text: error.message });
    window.dispatchEvent(new CustomEvent("workspace:module-catalog-changed"));
    navigate(`/settings/layout-builder/screen/${encodeURIComponent(data)}`, { replace: true });
  }

  if (!targetDefinition) return <Navigate to="/settings/modules" replace />;
  if (loading) return <div className="screen-builder-loading">Caricamento editor…</div>;
  if (!target) return <div className="module-message error">Elemento non trovato.</div>;

  return <div className="screen-builder-page">
    <div className="screen-builder-toolbar">
      <button type="button" className="secondary-action" onClick={() => navigate(targetType === "menu" ? "/settings/menu?view=menu" : `/settings/modules?view=${targetType === "screen" ? "screens" : "modules"}`)}><ArrowLeft size={17} />Catalogo</button>
      <div><strong>Editor visuale</strong><span>{targetType === "screen" ? "Schermata" : targetType === "module" ? "Modulo" : "Voce menu"} · {targetCode}</span></div>
      <div className="screen-builder-viewports" aria-label="Anteprima responsive"><button type="button" className={viewport === "desktop" ? "active" : ""} onClick={() => setViewport("desktop")} aria-label="Desktop"><Monitor /></button><button type="button" className={viewport === "tablet" ? "active" : ""} onClick={() => setViewport("tablet")} aria-label="Tablet"><Tablet /></button><button type="button" className={viewport === "mobile" ? "active" : ""} onClick={() => setViewport("mobile")} aria-label="Mobile"><Smartphone /></button></div>
      {previewRoute ? <Link className="secondary-action" to={previewRoute} target="_blank"><Eye size={17} />Visualizza</Link> : null}
      {targetType === "screen" ? <button type="button" className="secondary-action" onClick={() => { setClone({ name: `${target.name} copia`, code: `${targetCode}_copia`, description: target.description || "" }); setCloneOpen(true); }}><Copy size={17} />Salva come nuova</button> : null}
      <button type="button" className="primary-action" disabled={busy} onClick={save}><Save size={17} />{busy ? "Salvataggio…" : "Salva e pubblica"}</button>
    </div>

    {message ? <div className={`module-message ${message.type}`}>{message.text}</div> : null}

    <div className="screen-builder-meta"><label>Nome<input value={target.name} onChange={(event) => setTarget((current) => ({ ...current, name: event.target.value }))} /></label><label>Descrizione<input value={target.description || ""} onChange={(event) => setTarget((current) => ({ ...current, description: event.target.value }))} /></label><span>{versions[0] ? `Versione pubblicata ${versions[0].version}` : "Nessuna personalizzazione pubblicata"}</span></div>

    <div className="screen-builder-shell">
      <aside className="screen-builder-palette"><h2>Aggiungi elemento</h2>{BLOCKS.map(({ type, label, icon: Icon }) => <button type="button" key={type} onClick={() => addBlock(type)}><Icon size={18} />{label}</button>)}<h2>Struttura</h2><ol>{blocks.map((block, index) => <li key={block.id}><button type="button" className={selected?.id === block.id ? "active" : ""} onClick={() => setSelectedId(block.id)}><span>{index + 1}</span>{block.type === "system-content" ? "Contenuto applicativo" : block.title || block.label || BLOCKS.find((item) => item.type === block.type)?.label || block.type}</button></li>)}</ol>{versions.length ? <><h2>Versioni</h2><div className="screen-builder-versions">{versions.map((version) => <button type="button" key={version.version} onClick={() => restoreVersion(version)}><strong>v{version.version}</strong><span>{new Date(version.created_at).toLocaleString("it-IT")}</span></button>)}</div></> : null}</aside>

      <main className={`screen-builder-canvas viewport-${viewport}`}><div className="screen-builder-preview"><WorkspaceScreenComposition layout={layout} preview requireSystemContent={targetType !== "screen" || target.chiave_componente !== "screen-builder"}><div className="screen-builder-system-placeholder"><Monitor size={30} /><strong>Contenuto applicativo protetto</strong><span>Qui rimangono tabelle, filtri, form e funzioni della schermata originale.</span></div></WorkspaceScreenComposition></div></main>

      <aside className="screen-builder-properties"><h2>Proprietà</h2>{selected ? <><div className="screen-builder-order"><button type="button" onClick={() => moveBlock(-1)} aria-label="Sposta elemento su"><ArrowUp /></button><button type="button" onClick={() => moveBlock(1)} aria-label="Sposta elemento giù"><ArrowDown /></button><button type="button" className="danger-action" disabled={selected.type === "system-content" || selected.locked} onClick={removeBlock} aria-label="Elimina elemento"><Trash2 /></button></div><label>Larghezza<select disabled={selected.type === "system-content"} value={selected.width || "full"} onChange={(event) => updateBlock({ width: event.target.value })}><option value="full">Intera</option><option value="half">Metà</option><option value="third">Un terzo</option></select></label>{["text","panel"].includes(selected.type) ? <><label>Titolo<input value={selected.title || ""} onChange={(event) => updateBlock({ title: event.target.value })} /></label><label>Testo<textarea rows="6" value={selected.text || ""} onChange={(event) => updateBlock({ text: event.target.value })} /></label></> : null}{selected.type === "button" ? <><label>Etichetta<input value={selected.label || ""} onChange={(event) => updateBlock({ label: event.target.value })} /></label><label>Destinazione<input value={selected.href || ""} onChange={(event) => updateBlock({ href: event.target.value })} placeholder="/percorso oppure https://…" /></label><label>Stile<select value={selected.variant || "primary"} onChange={(event) => updateBlock({ variant: event.target.value })}><option value="primary">Primario</option><option value="secondary">Secondario</option><option value="danger">Pericolo</option></select></label></> : null}{selected.type === "links" ? <><label>Titolo<input value={selected.title || ""} onChange={(event) => updateBlock({ title: event.target.value })} /></label><label>Link, uno per riga<textarea rows="8" value={(selected.items || []).map((item) => `${item.label}|${item.href}`).join("\n")} onChange={(event) => updateBlock({ items: event.target.value.split("\n").filter(Boolean).map((line) => { const [label, ...href] = line.split("|"); return { label: label.trim(), href: href.join("|").trim() }; }) })} placeholder="Etichetta|/destinazione" /></label></> : null}{selected.type === "system-content" ? <p className="screen-builder-protected-note">Questo blocco contiene la funzione reale ed è protetto. Puoi spostarlo, ma non eliminarlo.</p> : null}</> : <p>Seleziona un elemento.</p>}</aside>
    </div>

    {cloneOpen ? <div className="screen-builder-modal-backdrop" role="presentation" onMouseDown={() => setCloneOpen(false)}><form className="screen-builder-modal" role="dialog" aria-modal="true" aria-label="Salva come nuova schermata" onSubmit={saveAsNew} onMouseDown={(event) => event.stopPropagation()}><h2>Salva come nuova schermata</h2><p>Verrà creata una schermata indipendente, collegata agli stessi moduli della sorgente.</p><label>Nome<input required value={clone.name} onChange={(event) => setClone((current) => ({ ...current, name: event.target.value, code: cleanCode(event.target.value) }))} /></label><label>Codice<input required value={clone.code} onChange={(event) => setClone((current) => ({ ...current, code: cleanCode(event.target.value) }))} /></label><label>Descrizione<textarea rows="3" value={clone.description} onChange={(event) => setClone((current) => ({ ...current, description: event.target.value }))} /></label><div><button type="button" className="secondary-action" onClick={() => setCloneOpen(false)}>Annulla</button><button className="primary-action" disabled={busy}><Copy size={17} />Crea schermata</button></div></form></div> : null}
  </div>;
}
