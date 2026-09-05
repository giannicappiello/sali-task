import { useEffect, useState } from "react";
import PhaseChecklistModal from "./PhaseChecklistModal";
import { supabase } from "../lib/supabaseClient";

export default function WorkspaceTaskDialog({ open, phase = null, crmType, initialCustomerKey = "", canManage = true, onClose, onSaved }) {
  const [data, setData] = useState({ projects: [], departments: [], products: [], phaseDepartments: [], phaseProducts: [], templates: [], templateDepartments: [], allPhases: [] });

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    const timer = window.setTimeout(async () => {
      const results = await Promise.all([
        supabase.from("v4_progetti").select("id,titolo,crm_customer_key").order("created_at", { ascending: false }).limit(2000),
        supabase.from("reparti").select("id,nome,attivo").eq("attivo", true).order("nome"),
        supabase.from("prodotti").select("id,nome,codice,brand,categoria").order("nome").limit(5000),
        supabase.from("v4_fase_reparti").select("id,fase_id,reparto_id,completato,completato_at,completato_da,reparti(id,nome)"),
        supabase.from("v4_fase_prodotti").select("id,fase_id,prodotto_id,prodotto_nome"),
        supabase.from("checklist_template").select("id,titolo,reparto_id,ordine,attivo,reparti(id,nome)").eq("attivo", true).order("ordine"),
        supabase.from("checklist_template_reparti").select("id,template_id,reparto_id"),
        supabase.from("v4_fasi_progetto").select("id,titolo,progetto_id,stato,completato_at,crm_customer_key,v4_progetti(titolo,crm_customer_key)").limit(5000),
      ]);
      if (!active) return;
      const error = results.find((result) => result.error)?.error;
      if (error) {
        window.alert(error.message);
        return;
      }
      setData({
        projects: results[0].data || [], departments: results[1].data || [], products: results[2].data || [],
        phaseDepartments: results[3].data || [], phaseProducts: results[4].data || [], templates: results[5].data || [],
        templateDepartments: results[6].data || [], allPhases: results[7].data || [],
      });
    }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [open]);

  return <PhaseChecklistModal
    open={open}
    phase={phase}
    projects={data.projects}
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
