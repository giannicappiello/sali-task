import { useEffect, useState } from "react";
import PhaseChecklistModal from "./PhaseChecklistModal";
import { supabase } from "../lib/supabaseClient";
import { loadWorkspaceProducts, loadDirectWorkspaceProducts, projectsForCrmTask } from "../lib/workspaceCrmCatalog";

export default function WorkspaceTaskDialog({ open, phase = null, crmType, initialCustomerKey = "", canManage = true, onClose, onSaved }) {
  const [data, setData] = useState({ projects: [], departments: [], products: [], phaseDepartments: [], phaseProducts: [], templates: [], templateDepartments: [], allPhases: [] });
  const [loadedKey, setLoadedKey] = useState(null);
  const [loadError, setLoadError] = useState("");
  const requestKey = `${phase?.id || "new"}:${crmType || ""}:${initialCustomerKey}`;

  useEffect(() => {
    setLoadedKey(null);
    setLoadError("");
    if (!open) return undefined;
    let active = true;
    const timer = window.setTimeout(async () => {
      let projectsRequest = supabase.from("v4_progetti").select("id,titolo,crm_customer_key,crm_tipo");
      if (!phase && crmType) projectsRequest = projectsRequest.eq("crm_tipo", crmType);
      if (!phase && initialCustomerKey) projectsRequest = projectsRequest.eq("crm_customer_key", initialCustomerKey);
      const results = await Promise.all([
        projectsRequest.order("created_at", { ascending: false }).limit(2000),
        supabase.from("reparti").select("id,nome,attivo").eq("attivo", true).order("nome"),
        crmType === "b2b" || crmType === "brand_direct" ? loadDirectWorkspaceProducts(supabase) : loadWorkspaceProducts(supabase),
        phase?.id ? supabase.from("v4_fase_reparti").select("id,fase_id,reparto_id,completato,completato_at,completato_da,reparti(id,nome)").eq("fase_id", phase.id) : Promise.resolve({ data: [] }),
        phase?.id ? supabase.from("v4_fase_prodotti").select("id,fase_id,prodotto_id,prodotto_nome").eq("fase_id", phase.id) : Promise.resolve({ data: [] }),
        supabase.from("checklist_template").select("id,titolo,reparto_id,ordine,attivo,competenze_crm,reparti(id,nome)").eq("attivo", true).order("ordine"),
        supabase.from("checklist_template_reparti").select("id,template_id,reparto_id"),
        supabase.from("v4_fasi_progetto").select("id,titolo,progetto_id,stato,completato_at,crm_customer_key,v4_progetti(titolo,crm_customer_key)").limit(5000),
        phase?.id ? supabase.from("v4_fasi_progetto").select("*").eq("id", phase.id).single() : Promise.resolve({ data: null }),
      ]);
      if (!active) return;
      const error = results.find((result) => result.error)?.error;
      if (error) {
        setLoadError(error.message);
        return;
      }
      setData({
        projects: results[0].data || [], departments: [...new Map([
          ...(results[3].data || []).filter(row => row.reparti).map(row => [row.reparti.id, { ...row.reparti, attivo: false }]),
          ...(results[1].data || []).map(row => [row.id, row]),
        ]).values()], products: results[2].data || [],
        phaseDepartments: results[3].data || [], phaseProducts: results[4].data || [], templates: results[5].data || [],
        templateDepartments: results[6].data || [], allPhases: results[7].data || [],
        phase: results[8].data,
      });
      setLoadedKey(requestKey);
    }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [open, crmType, initialCustomerKey, phase, requestKey]);

  if (!open) return null;
  if (loadedKey !== requestKey) return <div className="modal-backdrop"><div className="modal-card" role="dialog" aria-label="Caricamento dettaglio attività"><p role={loadError ? "alert" : "status"}>{loadError || "Caricamento dettaglio attività…"}</p><button type="button" onClick={onClose}>Chiudi</button></div></div>;

  return <PhaseChecklistModal
    open={open}
    phase={data.phase}
    projects={projectsForCrmTask(data.projects, crmType, initialCustomerKey, phase)}
    departments={data.departments}
    products={data.products}
    phaseDepartments={data.phaseDepartments}
    phaseProducts={data.phaseProducts}
    templates={data.templates}
    templateDepartments={data.templateDepartments}
    allPhases={data.allPhases}
    crmType={crmType}
    initialCustomerKey={initialCustomerKey}
    canManage={canManage}
    onClose={onClose}
    onSaved={onSaved}
  />;
}
