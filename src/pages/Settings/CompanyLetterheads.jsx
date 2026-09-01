import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, Bot, FilePlus2, Link2, PenLine, Plus, RefreshCw, Search, ShieldCheck, Upload } from "lucide-react";
import { useNavigate } from "react-router-dom";
import WorkspaceScreenLayout from "../../components/WorkspaceScreenLayout";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabaseClient";
import "./company-letterheads.css";

const EMPTY_HEADING = { name: "", code: "", description: "", companyBrand: "", kind: "carta_intestata", language: "it", format: "DOCX", validFrom: "", validTo: "", isDefault: false, notes: "" };
const EMPTY_RULE = { documentTypeCode: "", letterheadId: "", scope: "global", brand: "", businessArea: "", language: "", priority: 0, validFrom: "", validTo: "" };
const EMPTY_SIGNATURE = { name: "", code: "", signerName: "", signerRole: "", description: "", validFrom: "", validTo: "", notes: "" };

async function sha256(file) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function hasExpectedMagic(file, kind) {
  const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (kind === "PDF") return String.fromCharCode(...bytes.slice(0, 4)) === "%PDF";
  if (kind === "DOCX") return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  if (kind === "PNG") return [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a].every((value, index) => bytes[index] === value);
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function cleanFileName(name) {
  return String(name || "template").normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 140);
}

function latestVersion(heading) {
  return Math.max(0, ...(heading.company_letterhead_versions || []).map((item) => Number(item.version || 0)));
}

export default function CompanyLetterheads() {
  const navigate = useNavigate();
  const { canUseModule, isAdminUser } = useAuth();
  const canManage = isAdminUser || canUseModule("impostazioni", "scrittura");
  const [headings, setHeadings] = useState([]);
  const [documentTypes, setDocumentTypes] = useState([]);
  const [rules, setRules] = useState([]);
  const [signatures, setSignatures] = useState([]);
  const [filters, setFilters] = useState({ search: "", status: "all", brand: "all", format: "all", language: "all", usage: "all" });
  const [selectedId, setSelectedId] = useState("");
  const [headingForm, setHeadingForm] = useState(null);
  const [ruleForm, setRuleForm] = useState(null);
  const [fileTarget, setFileTarget] = useState(null);
  const [signatureForm, setSignatureForm] = useState(null);
  const [signatureLinkForm, setSignatureLinkForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    const [headingResult, typeResult, ruleResult, signatureResult] = await Promise.all([
      supabase.from("company_letterheads").select("*,company_letterhead_versions(*),document_letterhead_rules(id,document_type_code,scope,brand,business_area,language,priority,active,valid_from,valid_to,updated_at),company_letterhead_signatures(id,placement,label,sort_order,active,company_signatures(id,name,code,signer_name,signer_role,status))").order("name"),
      supabase.from("document_type_registry").select("*").eq("active", true).order("system").order("name"),
      supabase.from("document_letterhead_rules").select("*,company_letterheads(name,code)").order("priority", { ascending: false }),
      supabase.from("company_signatures").select("*,company_signature_versions(*)").order("name"),
    ]);
    const loadError = headingResult.error || typeResult.error || ruleResult.error || signatureResult.error;
    if (loadError) setError(loadError.message); else { setHeadings(headingResult.data || []); setDocumentTypes(typeResult.data || []); setRules(ruleResult.data || []); setSignatures(signatureResult.data || []); }
    setLoading(false);
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  const visible = useMemo(() => headings.filter((item) => {
    const query = filters.search.trim().toLocaleLowerCase("it-IT");
    if (query && ![item.name,item.code,item.company_brand,item.description].some((value) => String(value || "").toLocaleLowerCase("it-IT").includes(query))) return false;
    if (filters.status !== "all" && item.status !== filters.status) return false;
    if (filters.brand !== "all" && item.company_brand !== filters.brand) return false;
    if (filters.format !== "all" && item.format !== filters.format) return false;
    if (filters.language !== "all" && item.language !== filters.language) return false;
    const used = (item.document_letterhead_rules || []).some((rule) => rule.active);
    return filters.usage === "all" || (filters.usage === "used" ? used : !used);
  }), [headings, filters]);
  const selected = headings.find((item) => item.id === selectedId) || null;
  const typeByCode = useMemo(() => new Map(documentTypes.map((item) => [item.code, item])), [documentTypes]);

  async function uploadVersion(headingId, format, file) {
    const expectedMime = format === "PDF" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (file.size <= 0 || file.size > 26_214_400) throw new Error("Il file deve avere dimensione compresa tra 1 byte e 25 MB.");
    if ((format === "PDF" && (extension !== "pdf" || file.type !== expectedMime)) || (format === "DOCX" && (extension !== "docx" || file.type !== expectedMime))) throw new Error(`È richiesto un file ${format} valido. DOCM non è consentito.`);
    if (!await hasExpectedMagic(file, format)) throw new Error(`Il contenuto del file non corrisponde al formato ${format}.`);
    const fingerprint = await sha256(file);
    const path = `${headingId}/${crypto.randomUUID()}/${cleanFileName(file.name)}`;
    const uploaded = await supabase.storage.from("company-letterheads").upload(path, file, { contentType: expectedMime, upsert: false });
    if (uploaded.error) throw uploaded.error;
    const stored = await supabase.rpc("company_letterhead_add_version", { p_letterhead_id: headingId, p_storage_path: path, p_original_filename: file.name, p_mime_type: expectedMime, p_size_bytes: file.size, p_sha256: fingerprint, p_preview_path: null, p_valid_from: null, p_valid_to: null });
    if (stored.error) { await supabase.storage.from("company-letterheads").remove([path]); throw stored.error; }
  }

  async function saveHeading(event) {
    event.preventDefault(); if (!canManage || busy) return;
    const file = event.currentTarget.elements.templateFile.files[0];
    if (!file) { setError("Il file originale è obbligatorio per la prima versione."); return; }
    setBusy(true); setError("");
    try {
      const result = await supabase.rpc("company_letterhead_create", { p_name: headingForm.name, p_code: headingForm.code, p_description: headingForm.description || null, p_company_brand: headingForm.companyBrand, p_kind: headingForm.kind, p_language: headingForm.language, p_format: headingForm.format, p_valid_from: headingForm.validFrom || null, p_valid_to: headingForm.validTo || null, p_is_default: headingForm.isDefault, p_notes: headingForm.notes || null });
      if (result.error) throw result.error;
      await uploadVersion(result.data, headingForm.format, file);
      setHeadingForm(null); await load(); setSelectedId(result.data);
    } catch (saveError) { setError(saveError.message); } finally { setBusy(false); }
  }

  async function addVersion(event) {
    event.preventDefault(); if (!fileTarget || busy) return;
    const file = event.currentTarget.elements.versionFile.files[0]; if (!file) return;
    setBusy(true); setError("");
    try { await uploadVersion(fileTarget.id, fileTarget.format, file); setFileTarget(null); await load(); } catch (saveError) { setError(saveError.message); } finally { setBusy(false); }
  }

  async function saveSignature(event) {
    event.preventDefault(); if (!canManage || busy) return;
    const file=event.currentTarget.elements.signatureFile.files[0]; if(!file){setError("Il file firma è obbligatorio.");return;}
    const extension=file.name.split(".").pop()?.toLowerCase(); const allowed={png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg"};
    if(!allowed[extension]||file.type!==allowed[extension]||file.size<=0||file.size>10_485_760){setError("Firma non valida: usa PNG o JPG fino a 10 MB.");return;}
    if(!await hasExpectedMagic(file,extension==="png"?"PNG":"JPEG")){setError("Il contenuto del file firma non corrisponde al formato dichiarato.");return;}
    setBusy(true);setError("");
    try{
      const created=await supabase.rpc("company_signature_create",{p_name:signatureForm.name,p_code:signatureForm.code,p_signer_name:signatureForm.signerName,p_signer_role:signatureForm.signerRole||null,p_description:signatureForm.description||null,p_valid_from:signatureForm.validFrom||null,p_valid_to:signatureForm.validTo||null,p_notes:signatureForm.notes||null}); if(created.error)throw created.error;
      const path=`${created.data}/${crypto.randomUUID()}/${cleanFileName(file.name)}`; const uploaded=await supabase.storage.from("company-signatures").upload(path,file,{contentType:file.type,upsert:false}); if(uploaded.error)throw uploaded.error;
      const version=await supabase.rpc("company_signature_add_version",{p_signature_id:created.data,p_storage_path:path,p_original_filename:file.name,p_mime_type:file.type,p_size_bytes:file.size,p_sha256:await sha256(file),p_valid_from:null,p_valid_to:null}); if(version.error){await supabase.storage.from("company-signatures").remove([path]);throw version.error;}
      setSignatureForm(null);await load();
    }catch(saveError){setError(saveError.message);}finally{setBusy(false);}
  }

  async function attachSignature(event){event.preventDefault();if(busy)return;setBusy(true);setError("");const result=await supabase.rpc("company_letterhead_attach_signature",{p_letterhead_id:signatureLinkForm.letterheadId,p_signature_id:signatureLinkForm.signatureId,p_placement:signatureLinkForm.placement,p_label:signatureLinkForm.label||null,p_sort_order:Number(signatureLinkForm.sortOrder||0),p_valid_from:null,p_valid_to:null});if(result.error)setError(result.error.message);else{setSignatureLinkForm(null);await load();}setBusy(false);}

  async function changeStatus(item, status) {
    const confirmed = window.workspaceConfirm ? await window.workspaceConfirm(`${status === "active" ? "Attivare" : status === "archived" ? "Archiviare" : "Disattivare"} ${item.name}?`, { title: "Stato intestazione", confirmLabel: "Conferma", variant: status === "disabled" ? "danger" : "primary" }) : window.confirm("Confermi?");
    if (!confirmed) return;
    setBusy(true); const result = await supabase.rpc("company_letterhead_set_status", { p_letterhead_id: item.id, p_status: status, p_is_default: status === "active" && item.is_default });
    if (result.error) setError(result.error.message); else await load(); setBusy(false);
  }

  async function saveRule(event) {
    event.preventDefault(); if (busy) return; setBusy(true); setError("");
    const result = await supabase.rpc("company_letterhead_upsert_rule", { p_rule_id: null, p_document_type_code: ruleForm.documentTypeCode, p_letterhead_id: ruleForm.letterheadId, p_scope: ruleForm.scope, p_brand: ruleForm.brand || null, p_business_area: ruleForm.businessArea || null, p_language: ruleForm.language || null, p_priority: Number(ruleForm.priority || 0), p_active: true, p_valid_from: ruleForm.validFrom || null, p_valid_to: ruleForm.validTo || null });
    if (result.error) setError(result.error.message); else { setRuleForm(null); await load(); } setBusy(false);
  }

  return <WorkspaceScreenLayout fallbackTitle="Intestazioni aziendali" fallbackDescription="Archivio ufficiale centralizzato dei modelli e delle regole deterministiche usate dai documenti Workspace e MES.">
    <div className="company-letterheads-page"><div className="letterhead-page-actions"><button className="secondary-action" type="button" onClick={() => navigate("/assistente-ai?prompt=Quali%20tipi%20documento%20non%20hanno%20una%20carta%20intestata%3F")}><Bot size={17}/> Configura con AI</button>{canManage && <button className="secondary-action" type="button" onClick={()=>setSignatureForm({...EMPTY_SIGNATURE})}><PenLine size={17}/> Nuova firma</button>}{canManage && <button className="primary-action" type="button" onClick={() => setHeadingForm({ ...EMPTY_HEADING })}><Plus size={17}/> Nuova intestazione</button>}</div>
    <section className="letterhead-kpis" aria-label="Riepilogo intestazioni"><button onClick={() => setFilters((v) => ({...v,status:"all"}))}><strong>{headings.length}</strong><span>Intestazioni</span></button><button onClick={() => setFilters((v) => ({...v,status:"active"}))}><strong>{headings.filter((h) => h.status === "active").length}</strong><span>Attive</span></button><button onClick={() => setFilters((v) => ({...v,usage:"unused"}))}><strong>{documentTypes.filter((t) => !rules.some((r) => r.active && r.document_type_code === t.code)).length}</strong><span>Tipi non associati</span></button><button onClick={() => setRuleForm({ ...EMPTY_RULE })}><strong>{rules.filter((r) => r.active).length}</strong><span>Regole attive</span></button><button onClick={()=>setSignatureForm({...EMPTY_SIGNATURE})}><strong>{signatures.length}</strong><span>Firme in libreria</span></button></section>
    <section className="letterhead-toolbar panel"><label className="letterhead-search"><Search size={17}/><input value={filters.search} onChange={(e) => setFilters({...filters,search:e.target.value})} placeholder="Cerca nome, codice, brand..."/></label>{[["status",["all","draft","active","disabled","archived"]],["brand",["all",...new Set(headings.map((h)=>h.company_brand))]],["format",["all","DOCX","PDF"]],["language",["all",...new Set(headings.map((h)=>h.language))]],["usage",["all","used","unused"]]].map(([key,values])=><select key={key} aria-label={`Filtro ${key}`} value={filters[key]} onChange={(e)=>setFilters({...filters,[key]:e.target.value})}>{values.map((value)=><option key={value} value={value}>{value}</option>)}</select>)}<button className="secondary-action" onClick={load}><RefreshCw size={16}/></button></section>
    {error && <div className="letterhead-error">{error}</div>}{loading ? <div className="panel letterhead-empty">Caricamento...</div> : <section className="panel letterhead-table-wrap"><table className="workspace-table"><thead><tr><th>Nome</th><th>Codice</th><th>Società/Brand</th><th>Formato</th><th>Versione</th><th>Stato</th><th>Usata da</th><th>Validità</th><th>Ultima modifica</th><th>Azioni</th></tr></thead><tbody>{visible.map((item)=><tr key={item.id}><td><button className="letterhead-name" onClick={()=>setSelectedId(item.id)}>{item.name}</button></td><td>{item.code}</td><td>{item.company_brand}</td><td>{item.format}</td><td>v{latestVersion(item)}</td><td><span className={`status-badge ${item.status}`}>{item.status}</span></td><td><button className="letterhead-usage" onClick={()=>setSelectedId(item.id)}>{(item.document_letterhead_rules||[]).filter((r)=>r.active).length} tipi documento</button></td><td>{item.valid_from||"—"} → {item.valid_to||"senza scadenza"}</td><td>{new Date(item.updated_at).toLocaleDateString("it-IT")}</td><td><div className="letterhead-row-actions"><button title="Nuova versione" disabled={!canManage||busy} onClick={()=>setFileTarget(item)}><Upload size={16}/></button><button title="Associa" disabled={!canManage||busy} onClick={()=>setRuleForm({...EMPTY_RULE,letterheadId:item.id})}><Link2 size={16}/></button><button title="Disattiva" disabled={!canManage||busy||item.status==="disabled"} onClick={()=>changeStatus(item,"disabled")}><ShieldCheck size={16}/></button><button title="Archivia" disabled={!canManage||busy||item.status==="archived"} onClick={()=>changeStatus(item,"archived")}><Archive size={16}/></button></div></td></tr>)}</tbody></table>{!visible.length&&<div className="letterhead-empty">Nessuna intestazione corrisponde ai filtri.</div>}</section>}
    {selected && <div className="letterhead-modal" role="dialog" aria-modal="true" aria-label={`Dettaglio ${selected.name}`}><div className="letterhead-dialog"><header><div><small>{selected.code}</small><h2>{selected.name}</h2><p>{selected.description||"Nessuna descrizione"}</p></div><button onClick={()=>setSelectedId("")} aria-label="Chiudi">×</button></header><div className="letterhead-detail-grid"><section><h3>Dati generali</h3><dl><dt>Brand</dt><dd>{selected.company_brand}</dd><dt>Lingua</dt><dd>{selected.language}</dd><dt>Formato</dt><dd>{selected.format}</dd><dt>Default</dt><dd>{selected.is_default?"Sì":"No"}</dd><dt>Note</dt><dd>{selected.notes||"—"}</dd></dl></section><section><h3>File e versioni</h3>{(selected.company_letterhead_versions||[]).toSorted((a,b)=>b.version-a.version).map((v)=><div className="letterhead-version" key={v.id}><strong>v{v.version} · {v.original_filename}</strong><small>{Math.ceil(v.size_bytes/1024)} KB · {v.sha256.slice(0,12)}… · {new Date(v.created_at).toLocaleString("it-IT")}</small></div>)}</section><section><h3>Associazioni</h3>{(selected.document_letterhead_rules||[]).map((r)=><div className="letterhead-version" key={r.id}><strong>{typeByCode.get(r.document_type_code)?.name||"Default aziendale"}</strong><small>{r.scope} · priorità {r.priority} · {r.active?"attiva":"disattivata"}</small></div>)}</section><section><h3>Firme</h3>{(selected.company_letterhead_signatures||[]).map((link)=><div className="letterhead-version" key={link.id}><strong>{link.company_signatures?.name}</strong><small>{link.company_signatures?.signer_name} · {link.placement}</small></div>)}{canManage&&<button className="secondary-action" onClick={()=>setSignatureLinkForm({letterheadId:selected.id,signatureId:"",placement:"signature_block",label:"",sortOrder:0})}><PenLine size={16}/> Inserisci firma</button>}</section><section><h3>Utilizzi e storico</h3><p>I documenti emessi mantengono versione, file, firme e regola risolta. L’audit è disponibile agli amministratori.</p></section></div></div></div>}
    {headingForm && <div className="letterhead-modal" role="dialog" aria-modal="true"><form className="letterhead-dialog letterhead-form" onSubmit={saveHeading}><header><h2>Nuova intestazione</h2><button type="button" onClick={()=>setHeadingForm(null)}>×</button></header>{[["name","Nome"],["code","Codice univoco"],["companyBrand","Società/Brand"],["description","Descrizione"],["notes","Note"]].map(([key,label])=><label key={key}><span>{label}</span><input required={["name","code","companyBrand"].includes(key)} value={headingForm[key]} onChange={(e)=>setHeadingForm({...headingForm,[key]:e.target.value})}/></label>)}<div className="letterhead-form-grid"><label><span>Formato</span><select value={headingForm.format} onChange={(e)=>setHeadingForm({...headingForm,format:e.target.value})}><option>DOCX</option><option>PDF</option></select></label><label><span>Lingua</span><input required value={headingForm.language} onChange={(e)=>setHeadingForm({...headingForm,language:e.target.value})}/></label><label><span>Valida da</span><input type="date" value={headingForm.validFrom} onChange={(e)=>setHeadingForm({...headingForm,validFrom:e.target.value})}/></label><label><span>Valida a</span><input type="date" value={headingForm.validTo} onChange={(e)=>setHeadingForm({...headingForm,validTo:e.target.value})}/></label></div><label><span>File originale {headingForm.format}</span><input name="templateFile" type="file" required accept={headingForm.format==="PDF"?"application/pdf,.pdf":"application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx"}/></label><label className="letterhead-checkbox"><input type="checkbox" checked={headingForm.isDefault} onChange={(e)=>setHeadingForm({...headingForm,isDefault:e.target.checked})}/> Predefinita</label><footer><button type="button" className="secondary-action" onClick={()=>setHeadingForm(null)}>Annulla</button><button className="primary-action" disabled={busy}>{busy?"Salvataggio...":"Crea intestazione"}</button></footer></form></div>}
    {fileTarget && <div className="letterhead-modal"><form className="letterhead-dialog letterhead-form" onSubmit={addVersion}><header><h2>Nuova versione · {fileTarget.name}</h2><button type="button" onClick={()=>setFileTarget(null)}>×</button></header><p>La versione precedente non sarà sovrascritta e resterà collegata ai documenti già emessi.</p><input name="versionFile" type="file" required accept={fileTarget.format==="PDF"?"application/pdf,.pdf":"application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx"}/><footer><button type="button" className="secondary-action" onClick={()=>setFileTarget(null)}>Annulla</button><button className="primary-action" disabled={busy}><FilePlus2 size={16}/> Carica nuova versione</button></footer></form></div>}
    {ruleForm && <div className="letterhead-modal"><form className="letterhead-dialog letterhead-form" onSubmit={saveRule}><header><h2>Nuova associazione</h2><button type="button" onClick={()=>setRuleForm(null)}>×</button></header><label><span>Tipo documento</span><select required value={ruleForm.documentTypeCode} onChange={(e)=>setRuleForm({...ruleForm,documentTypeCode:e.target.value})}><option value="">Seleziona</option>{documentTypes.map((t)=><option key={t.code} value={t.code}>{t.name} · {t.system}</option>)}</select></label><label><span>Intestazione</span><select required value={ruleForm.letterheadId} onChange={(e)=>setRuleForm({...ruleForm,letterheadId:e.target.value})}><option value="">Seleziona</option>{headings.filter((h)=>h.status!=="archived").map((h)=><option key={h.id} value={h.id}>{h.name}</option>)}</select></label><div className="letterhead-form-grid"><label><span>Ambito</span><select value={ruleForm.scope} onChange={(e)=>setRuleForm({...ruleForm,scope:e.target.value})}><option value="global">Globale</option><option value="brand">Brand</option><option value="business_area">Area aziendale</option><option value="specific">Specifica</option></select></label><label><span>Priorità</span><input type="number" min="-1000" max="1000" value={ruleForm.priority} onChange={(e)=>setRuleForm({...ruleForm,priority:e.target.value})}/></label><label><span>Brand</span><input value={ruleForm.brand} onChange={(e)=>setRuleForm({...ruleForm,brand:e.target.value})}/></label><label><span>Lingua</span><input value={ruleForm.language} onChange={(e)=>setRuleForm({...ruleForm,language:e.target.value})}/></label><label><span>Area aziendale</span><input value={ruleForm.businessArea} onChange={(e)=>setRuleForm({...ruleForm,businessArea:e.target.value})}/></label></div><footer><button type="button" className="secondary-action" onClick={()=>setRuleForm(null)}>Annulla</button><button className="primary-action" disabled={busy}>Salva associazione</button></footer></form></div>}
    {signatureForm&&<div className="letterhead-modal"><form className="letterhead-dialog letterhead-form" onSubmit={saveSignature}><header><h2>Nuova firma</h2><button type="button" onClick={()=>setSignatureForm(null)}>×</button></header>{[["name","Nome firma"],["code","Codice univoco"],["signerName","Firmatario"],["signerRole","Ruolo"],["description","Descrizione"],["notes","Note"]].map(([key,label])=><label key={key}><span>{label}</span><input required={["name","code","signerName"].includes(key)} value={signatureForm[key]} onChange={(e)=>setSignatureForm({...signatureForm,[key]:e.target.value})}/></label>)}<div className="letterhead-form-grid"><label><span>Valida da</span><input type="date" value={signatureForm.validFrom} onChange={(e)=>setSignatureForm({...signatureForm,validFrom:e.target.value})}/></label><label><span>Valida a</span><input type="date" value={signatureForm.validTo} onChange={(e)=>setSignatureForm({...signatureForm,validTo:e.target.value})}/></label></div><label><span>Immagine firma</span><input name="signatureFile" type="file" required accept="image/png,image/jpeg,.png,.jpg,.jpeg"/></label><small>PNG o JPG, massimo 10 MB. L’immagine viene incorporata nei documenti e resta privata e versionata.</small><footer><button type="button" className="secondary-action" onClick={()=>setSignatureForm(null)}>Annulla</button><button className="primary-action" disabled={busy}>Salva firma</button></footer></form></div>}
    {signatureLinkForm&&<div className="letterhead-modal"><form className="letterhead-dialog letterhead-form" onSubmit={attachSignature}><header><h2>Inserisci firma</h2><button type="button" onClick={()=>setSignatureLinkForm(null)}>×</button></header><label><span>Firma</span><select required value={signatureLinkForm.signatureId} onChange={(e)=>setSignatureLinkForm({...signatureLinkForm,signatureId:e.target.value})}><option value="">Seleziona</option>{signatures.filter((s)=>s.status!=="archived").map((s)=><option key={s.id} value={s.id}>{s.name} · {s.signer_name}</option>)}</select></label><label><span>Posizione</span><select value={signatureLinkForm.placement} onChange={(e)=>setSignatureLinkForm({...signatureLinkForm,placement:e.target.value})}><option value="signature_block">Blocco firma</option><option value="header">Testata</option><option value="footer">Piè di pagina</option></select></label><label><span>Etichetta</span><input value={signatureLinkForm.label} onChange={(e)=>setSignatureLinkForm({...signatureLinkForm,label:e.target.value})}/></label><footer><button type="button" className="secondary-action" onClick={()=>setSignatureLinkForm(null)}>Annulla</button><button className="primary-action" disabled={busy}>Inserisci firma</button></footer></form></div>}
    </div></WorkspaceScreenLayout>;
}
