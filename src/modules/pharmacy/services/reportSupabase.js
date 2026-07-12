import { supabase as primarySupabase } from "../../../lib/supabaseClient";

class RemoteQuery {
  constructor(table) {
    this.payload = { action: "query", table, operation: "select", columns: "*", filters: [], modifiers: {} };
  }
  select(columns = "*", options = {}) { this.payload.columns = columns; this.payload.selectOptions = options; return this; }
  insert(values) { this.payload.operation = "insert"; this.payload.values = values; return this; }
  update(values) { this.payload.operation = "update"; this.payload.values = values; return this; }
  delete() { this.payload.operation = "delete"; return this; }
  eq(column, value) { this.payload.filters.push({ type: "eq", column, value }); return this; }
  in(column, values) { this.payload.filters.push({ type: "in", column, value: values }); return this; }
  filter(column, operator, value) { this.payload.filters.push({ type: "filter", column, operator, value }); return this; }
  order(column, options = {}) { this.payload.modifiers.order = { column, ascending: options.ascending !== false }; return this; }
  range(from, to) { this.payload.modifiers.range = { from, to }; return this; }
  limit(value) { this.payload.modifiers.limit = value; return this; }
  single() { this.payload.modifiers.single = true; return this.execute(); }
  maybeSingle() { this.payload.modifiers.maybeSingle = true; return this.execute(); }
  then(resolve, reject) { return this.execute().then(resolve, reject); }
  async execute() {
    const invalidFilter = (this.payload.filters || []).find((filter) => {
      if (filter.type === "in") {
        return !Array.isArray(filter.value) || filter.value.some(isMissingValue);
      }

      return isMissingValue(filter.value);
    });

    if (invalidFilter) {
      return {
        data: null,
        error: {
          message: `Filtro non valido: ${invalidFilter.column} non ha un valore valido.`,
          details: invalidFilter,
        },
        count: null,
      };
    }

    const { data, error } = await primarySupabase.functions.invoke("report-giornate-api", { body: this.payload });
    if (error) return { data: null, error };
    if (data?.error) return { data: null, error: { message: data.error, details: data.details } };
    return { data: data?.data ?? null, error: null, count: data?.count ?? null };
  }
}

const storageBucket = (bucket) => ({
  async upload(path, file, options = {}) {
    const base64 = await fileToBase64(file);
    const { data, error } = await primarySupabase.functions.invoke("report-giornate-api", {
      body: { action: "storage-upload", bucket, path, base64, contentType: file.type || options.contentType || "application/octet-stream", upsert: options.upsert === true },
    });
    return data?.error ? { data: null, error: { message: data.error } } : { data: data?.data, error };
  },
  getPublicUrl(path) {
    const base = import.meta.env.VITE_GIORNATE_SUPABASE_URL || "";
    return { data: { publicUrl: `${base}/storage/v1/object/public/${bucket}/${path}` } };
  },
  async remove(paths) {
    const { data, error } = await primarySupabase.functions.invoke("report-giornate-api", { body: { action: "storage-remove", bucket, paths } });
    return data?.error ? { data: null, error: { message: data.error } } : { data: data?.data, error };
  },
});

function isMissingValue(value) {
  return value === undefined || value === null || value === "undefined" || value === "null";
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export const supabase = {
  from: (table) => new RemoteQuery(table),
  storage: { from: storageBucket },
  functions: {
    async invoke(name, options = {}) {
      const { data, error } = await primarySupabase.functions.invoke("report-giornate-api", {
        body: { action: "remote-function", functionName: name, payload: options.body || {} },
      });
      return data?.error ? { data: null, error: { message: data.error } } : { data: data?.data, error };
    },
  },
};
