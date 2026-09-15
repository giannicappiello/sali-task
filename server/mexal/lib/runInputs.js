// Only the catalog is frozen. Quantities, commitments and costs are always
// fetched live from Mexal when each article is processed.
export async function loadRunInputs({ supabase, run, load }) {
  if (run?.metadata?.inputs_version !== 1) return load();
  const { data, error } = await supabase.from("mexal_sync_run_inputs").select("inputs").eq("sync_run_id", run.id).maybeSingle();
  if (error) throw error;
  if (data) return data.inputs;
  // Never rebuild a missing snapshot after an offset has advanced: ordering
  // could change and cause omissions or duplicate work.
  if (Number(run.processed || 0) > 0) throw new Error("Catalogo della sincronizzazione non disponibile: ripresa sospesa per proteggere il checkpoint.");
  const inputs = await load();
  const { error: insertError } = await supabase.from("mexal_sync_run_inputs")
    .upsert({ sync_run_id: run.id, inputs }, { onConflict: "sync_run_id", ignoreDuplicates: true });
  if (insertError) throw insertError;
  const { data: saved, error: readError } = await supabase.from("mexal_sync_run_inputs").select("inputs").eq("sync_run_id", run.id).single();
  if (readError) throw readError;
  return saved.inputs;
}
