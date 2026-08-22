import process from "node:process";
function text(value) { return String(value ?? "").trim(); }
function upper(value) { return text(value).toUpperCase(); }
function number(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function first(object, names) { for (const name of names) if (object?.[name] !== undefined) return object[name]; return null; }
function rowsOf(document) {
  for (const value of [document?.righe, document?.dati?.righe, document?.documento?.righe]) if (Array.isArray(value)) return value;
  return [];
}
function documentsOf(payload) {
  if (Array.isArray(payload)) return payload;
  for (const value of [payload?.data, payload?.dati, payload?.items, payload?.documenti]) if (Array.isArray(value)) return value;
  return [];
}

export function isOctDocument(document, { moduleCode }) {
  const expected = upper(moduleCode);
  if (!expected) throw new Error("MEXAL_OCT_MODULE_CODE deve essere configurato esplicitamente.");
  const sigla = upper(first(document, ["sigla", "sigla_documento"]));
  const module = upper(first(document, ["cod_modulo", "modulo"]));
  return sigla === "OC" && module === expected && !["M", "X", "I"].includes(module);
}

export function normalizeOct(document) {
  const sigla = upper(first(document, ["sigla", "sigla_documento"]));
  const codModulo = upper(first(document, ["cod_modulo", "modulo"]));
  const serie = number(first(document, ["serie"]));
  const numero = number(first(document, ["numero"]));
  if (!sigla || !Number.isInteger(serie) || !Number.isInteger(numero)) throw new Error("Identità documento OCT incompleta.");
  const key = `${sigla}+${serie}+${numero}`;
  return {
    key,
    header: {
      origine: "mexal_oct", mexal_sigla: sigla, mexal_cod_modulo: codModulo,
      mexal_serie: serie, mexal_numero: numero, mexal_anno: number(first(document, ["anno"])),
      mexal_chiave: key, mexal_cod_conto: text(first(document, ["cod_conto", "codice_cliente"])),
      codice_cliente: text(first(document, ["cod_conto", "codice_cliente"])),
      data_ordine: first(document, ["data_documento", "data"]),
      data_consegna: first(document, ["data_consegna", "data_scadenza"]),
      mexal_sincronizzato_il: new Date().toISOString(), stato_sincronizzazione: "importato_mexal",
    },
    lines: rowsOf(document).map((line, index) => {
      const code = text(first(line, ["codice_articolo", "cod_articolo", "codice", "articolo"]));
      return {
        mexal_posizione: number(first(line, ["id_riga", "posizione", "indice_riga", "riga"])) ?? index + 1,
        codice_articolo: code || null,
        descrizione: text(first(line, ["descr_articolo", "descr_riga", "descrizione"])),
        quantita: number(first(line, ["quantita", "qta"])) ?? 0,
        data_consegna: first(line, ["data_consegna", "data_scadenza"]),
        mexal_tipo_riga: text(first(line, ["tipo_riga", "tipo"])) || null,
        riga_descrittiva: !code,
      };
    }),
  };
}

export async function syncOctOrders({ mexal, supabase, env = process.env }) {
  if (String(env.MEXAL_OCT_IMPORT_ENABLED || "").toLowerCase() !== "true")
    return { enabled: false, imported: 0, skipped: 0 };
  const moduleCode = text(env.MEXAL_OCT_MODULE_CODE);
  const listPath = text(env.MEXAL_OCT_LIST_PATH);
  if (!moduleCode || !listPath) throw new Error("Configurazione importer OCT incompleta.");
  const summaries = documentsOf(await mexal.getJson(listPath));
  let imported = 0; let skipped = 0;
  for (const summary of summaries) {
    const sigla = upper(first(summary, ["sigla", "sigla_documento"]));
    const serie = number(summary.serie); const numero = number(summary.numero);
    if (sigla !== "OC" || !Number.isInteger(serie) || !Number.isInteger(numero)) { skipped++; continue; }
    const reference = [sigla, serie, numero].join("+");
    const detail = await mexal.getJson("/documenti/ordini-clienti/" + encodeURIComponent(reference));
    if (!isOctDocument(detail, { moduleCode })) { skipped++; continue; }
    const normalized = normalizeOct(detail);
    const { data: customer } = await supabase.from("ordini_clienti_cache").select("codice_cliente").eq("codice_cliente", normalized.header.mexal_cod_conto).maybeSingle();
    normalized.header.cliente_mexal_risolto = Boolean(customer);
    const { data: order, error } = await supabase.from("ordini_testate")
      .upsert(normalized.header, { onConflict: "mexal_sigla,mexal_serie,mexal_numero" }).select("id").single();
    if (error) throw error;
    const rows = normalized.lines.map((line) => ({ ...line, ordine_id: order.id }));
    if (rows.length) {
      const { error: lineError } = await supabase.from("ordini_righe").upsert(rows, { onConflict: "ordine_id,mexal_posizione" });
      if (lineError) throw lineError;
    }
    imported++;
  }
  return { enabled: true, imported, skipped };

}
export function createOctOrdersRunHandler({ createMexalClient, createSupabaseClient, env = process.env }) {
  if (typeof createMexalClient !== "function" || typeof createSupabaseClient !== "function")
    throw new TypeError("Dipendenze handler OCT non valide.");
  return async function octOrdersRunHandler(_req, res) {
    const enabled = String(env.MEXAL_OCT_IMPORT_ENABLED || "").toLowerCase() === "true";
    const result = await syncOctOrders({
      mexal: enabled ? createMexalClient() : null,
      supabase: enabled ? createSupabaseClient() : null,
      env,
    });
    return res.status(200).json(result);
  };
}
