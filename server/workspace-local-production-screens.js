const REGISTRATION = "local_production_catalog_v1";
export const LOCAL_PRODUCTION_SCREENS = [
  { codice: "workspace.production.rdp", nome: "RdP Workbench", percorso: "/produzione/rdp-workbench", descrizione: "Gestione OCT, richieste di produzione, analisi MES e decisioni operative.", icona: "clipboard-list", ordine: 10, metadati: { required_permissions: ["rdp.view"] } },
  { codice: "progremes.Ordini.Fabbisogni", nome: "Fabbisogni acquisto", percorso: "/produzione/fabbisogni-acquisto", descrizione: "Calcolo mensile, coperture, fornitori e creazione controllata dei PF Mexal.", icona: "shopping-cart", ordine: 20, metadati: { required_permissions: ["rdp.view"] } },
  { codice: "workspace.production.diagnostics", nome: "Centro Diagnostico", percorso: "/produzione/diagnostica", descrizione: "Stato globale, alert operativi e integrazioni.", icona: "triangle-alert", ordine: 30, metadati: { admin_only: true } },
];

// Called only for an authenticated administrator. The marker belongs to the
// screen, not its associations: deleting a module link never recreates it.
export async function ensureLocalProductionScreens(admin) {
  const { data: rows, error } = await admin.from("workspace_schermate")
    .select("codice,percorso,metadati").in("percorso", LOCAL_PRODUCTION_SCREENS.map(s => s.percorso));
  if (error) throw error;
  for (const definition of LOCAL_PRODUCTION_SCREENS) {
    let existing = (rows || []).find(s => s.percorso === definition.percorso);
    if (existing?.metadati?.[REGISTRATION]) continue;
    const code = existing?.codice || definition.codice;
    if (!existing) {
      const { error: insertError } = await admin.from("workspace_schermate").upsert({
        ...definition, provider: "workspace", area: "produzione", attiva: true,
        protetta: false, chiave_componente: definition.percorso.split("/").at(-1),
      }, { onConflict: "codice", ignoreDuplicates: true });
      if (insertError) throw insertError;
    }
    const { error: linkError } = await admin.from("workspace_moduli_schermate").upsert({
      modulo_codice: "progremes", schermata_codice: code, ordine: definition.ordine,
      visibile_menu: true, predefinita: false,
    }, { onConflict: "modulo_codice,schermata_codice", ignoreDuplicates: true });
    if (linkError) throw linkError;
    const { error: markerError } = await admin.from("workspace_schermate").update({
      metadati: { ...definition.metadati, ...existing?.metadati, [REGISTRATION]: true },
    }).eq("codice", code);
    if (markerError) throw markerError;
  }
}
