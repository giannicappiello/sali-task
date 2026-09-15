export async function octRefreshStatus(supabase, jobId = null) {
  const fields = "id,cycle_id,status,attempts,started_at,completed_at,created_at,updated_at,last_error,last_result,payload";
  let query = supabase.from("mexal_sync_jobs").select(fields).eq("sync_type", "oct_orders");
  query = jobId ? query.eq("id", jobId) : query.order("id", { ascending: false }).limit(1);
  const { data: job, error } = await query.maybeSingle();
  if (error) throw error;
  const { data: success, error: successError } = await supabase.from("mexal_sync_jobs")
    .select("completed_at").eq("sync_type", "oct_orders").eq("status", "completed")
    .order("completed_at", { ascending: false }).limit(1).maybeSingle();
  if (successError) throw successError;
  if (!job) return { status: "idle", lastSuccessAt: success?.completed_at || null };
  const { payload, ...safeJob } = job;
  return { ...safeJob, lane: payload?.lane || "scheduled", jobId: Number(job.id), lastSuccessAt: success?.completed_at || null };
}
