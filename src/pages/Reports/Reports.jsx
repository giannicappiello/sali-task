import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  CalendarRange,
  Clock3,
  Download,
  FileText,
  Filter,
  Plus,
  RefreshCw,
  RotateCcw,
  Table2,
  Trash2,
  Users,
} from "lucide-react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { supabase } from "../../lib/supabaseClient";
import "./Reports.css";
import "./ReportsRitardi.css";

const DATA_SOURCES = [
  { value: "v4_progetti", label: "Progetti" },
  { value: "v4_fasi_progetto", label: "Fasi dei progetti" },
  { value: "agenda_reminder", label: "Reminder" },
  { value: "prodotti", label: "Prodotti" },
  { value: "documenti", label: "Documentazione" },
  { value: "utenti", label: "Utenti" },
  { value: "reparti", label: "Reparti" },
  { value: "task_commenti", label: "Commenti task" },
  { value: "v4_commenti", label: "Commenti fasi" },
  { value: "v4_audit_log", label: "Storico modifiche" },
  { value: "notifiche", label: "Notifiche" },
  { value: "chat_messaggi", label: "Messaggi chat" },
];

const AGGREGATIONS = [
  { value: "count", label: "Conteggio" },
  { value: "sum", label: "Somma" },
  { value: "avg", label: "Media" },
  { value: "min", label: "Minimo" },
  { value: "max", label: "Massimo" },
];

const OPERATORS = [
  { value: "contains", label: "contiene" },
  { value: "equals", label: "uguale a" },
  { value: "not_equals", label: "diverso da" },
  { value: "starts_with", label: "inizia con" },
  { value: "greater", label: "maggiore di" },
  { value: "less", label: "minore di" },
  { value: "empty", label: "è vuoto" },
  { value: "not_empty", label: "non è vuoto" },
];

const DATE_GROUPS = [
  { value: "exact", label: "Valore esatto" },
  { value: "day", label: "Giorno" },
  { value: "month", label: "Mese" },
  { value: "year", label: "Anno" },
];


const TECHNICAL_ID_FIELDS = new Set([
  "id",
  "auth_user_id",
  "entity_id",
]);

const LOOKUP_TABLES = {
  utenti: {
    table: "utenti",
    columns: "id,nome,cognome,email",
    label: (row) =>
      `${row.nome || ""} ${row.cognome || ""}`.trim() ||
      row.email ||
      row.id,
  },
  progetti: {
    table: "v4_progetti",
    columns: "id,titolo",
    label: (row) => row.titolo || row.id,
  },
  fasi: {
    table: "v4_fasi_progetto",
    columns: "id,titolo",
    label: (row) => row.titolo || row.id,
  },
  prodotti: {
    table: "prodotti",
    columns: "id,nome,codice",
    label: (row) =>
      row.nome
        ? `${row.nome}${row.codice ? ` · ${row.codice}` : ""}`
        : row.codice || row.id,
  },
  reparti: {
    table: "reparti",
    columns: "id,nome",
    label: (row) => row.nome || row.id,
  },
  ruoli: {
    table: "ruoli",
    columns: "id,nome",
    label: (row) => row.nome || row.id,
  },
  documenti: {
    table: "documenti",
    columns: "id,titolo,nome",
    label: (row) => row.titolo || row.nome || row.id,
  },
  reminder: {
    table: "agenda_reminder",
    columns: "id,titolo",
    label: (row) => row.titolo || row.id,
  },
  task: {
    table: "tasks",
    columns: "id,titolo,nome",
    label: (row) => row.titolo || row.nome || row.id,
  },
  conversazioni: {
    table: "chat_conversazioni",
    columns: "id,titolo,nome",
    label: (row) => row.titolo || row.nome || row.id,
  },
};

const FIELD_RELATIONS = {
  utente_id: ["utenti", "utente_nome"],
  user_id: ["utenti", "utente_nome"],
  creato_da: ["utenti", "creato_da_nome"],
  modificato_da: ["utenti", "modificato_da_nome"],
  completato_da: ["utenti", "completato_da_nome"],
  assegnato_a: ["utenti", "assegnato_a_nome"],
  mittente_id: ["utenti", "mittente_nome"],
  destinatario_id: ["utenti", "destinatario_nome"],
  autore_id: ["utenti", "autore_nome"],
  responsabile_id: ["utenti", "responsabile_nome"],

  progetto_id: ["progetti", "progetto_titolo"],
  project_id: ["progetti", "progetto_titolo"],

  fase_id: ["fasi", "fase_titolo"],
  task_id: ["task", "attivita_titolo"],
  bloccante_id: ["fasi", "fase_bloccante_titolo"],

  prodotto_id: ["prodotti", "prodotto_nome"],
  reparto_id: ["reparti", "reparto_nome"],
  ruolo_id: ["ruoli", "ruolo_nome"],
  documento_id: ["documenti", "documento_titolo"],
  reminder_id: ["reminder", "reminder_titolo"],
  conversazione_id: ["conversazioni", "conversazione_titolo"],
};

function isTechnicalIdField(field) {
  return TECHNICAL_ID_FIELDS.has(field) || field.endsWith("_id");
}

async function fetchLookup(definition) {
  const { data, error } = await supabase
    .from(definition.table)
    .select(definition.columns)
    .limit(20000);

  if (error) {
    console.warn(
      `Lookup non disponibile per ${definition.table}:`,
      error.message
    );
    return new Map();
  }

  return new Map(
    (data || []).map((row) => [row.id, definition.label(row)])
  );
}

async function loadLookups() {
  const entries = await Promise.all(
    Object.entries(LOOKUP_TABLES).map(async ([key, definition]) => [
      key,
      await fetchLookup(definition),
    ])
  );

  return Object.fromEntries(entries);
}

function resolveEntityTitle(row, lookups) {
  const entityType = String(row.entity_type || "").toLowerCase();
  const entityId = row.entity_id;

  if (!entityId) return "";

  if (entityType.includes("fase")) {
    return lookups.fasi?.get(entityId) || "";
  }

  if (entityType.includes("progetto")) {
    return lookups.progetti?.get(entityId) || "";
  }

  if (entityType.includes("reminder")) {
    return lookups.reminder?.get(entityId) || "";
  }

  if (entityType.includes("task") || entityType.includes("attiv")) {
    return lookups.task?.get(entityId) || "";
  }

  if (entityType.includes("document")) {
    return lookups.documenti?.get(entityId) || "";
  }

  if (entityType.includes("prodotto")) {
    return lookups.prodotti?.get(entityId) || "";
  }

  return "";
}

function enrichRowsWithLabels(data, lookups) {
  return (data || []).map((row) => {
    const enriched = { ...row };

    Object.entries(FIELD_RELATIONS).forEach(
      ([idField, [lookupKey, displayField]]) => {
        const idValue = row[idField];
        if (!idValue) return;

        enriched[displayField] =
          lookups[lookupKey]?.get(idValue) || "Riferimento non disponibile";
      }
    );

    if (row.entity_id) {
      const entityTitle = resolveEntityTitle(row, lookups);
      if (entityTitle) enriched.entita_titolo = entityTitle;
    }

    return enriched;
  });
}

function getBusinessFields(data) {
  return Array.from(
    data.reduce((set, row) => {
      Object.keys(row || {}).forEach((key) => {
        if (!isTechnicalIdField(key)) set.add(key);
      });
      return set;
    }, new Set())
  ).sort((a, b) => a.localeCompare(b, "it"));
}

function humanize(value) {
  const aliases = {
    utente_nome: "Utente",
    creato_da_nome: "Creato da",
    modificato_da_nome: "Modificato da",
    completato_da_nome: "Completato da",
    assegnato_a_nome: "Assegnato a",
    mittente_nome: "Mittente",
    destinatario_nome: "Destinatario",
    autore_nome: "Autore",
    responsabile_nome: "Responsabile",
    progetto_titolo: "Progetto",
    fase_titolo: "Fase / attività",
    attivita_titolo: "Attività",
    fase_bloccante_titolo: "Fase bloccante",
    prodotto_nome: "Prodotto",
    reparto_nome: "Reparto",
    ruolo_nome: "Ruolo",
    documento_titolo: "Documento",
    reminder_titolo: "Reminder",
    conversazione_titolo: "Conversazione",
    entita_titolo: "Elemento collegato",
  };

  if (aliases[value]) return aliases[value];

  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}


const COMPLETED_STATUS_VALUES = new Set([
  "completata",
  "completato",
  "completa",
  "chiusa",
  "chiuso",
  "evaso",
  "evasa",
  "done",
  "completed",
]);

function firstValue(row, candidates) {
  for (const field of candidates) {
    const value = row?.[field];
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return null;
}

function parseDateOnly(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function daysBetween(startValue, endValue) {
  const start = parseDateOnly(startValue);
  const end = parseDateOnly(endValue);
  if (!start || !end) return null;
  return Math.max(
    0,
    Math.round((end.getTime() - start.getTime()) / 86400000)
  );
}

function isCompletedPhase(row) {
  const completedAt = firstValue(row, [
    "completata_il",
    "completato_il",
    "data_completamento",
    "completed_at",
    "chiusa_il",
  ]);

  if (completedAt) return true;

  const status = String(
    firstValue(row, ["stato", "status"]) || ""
  ).toLowerCase();

  return COMPLETED_STATUS_VALUES.has(status);
}

function getCompletionDate(row) {
  return firstValue(row, [
    "completata_il",
    "completato_il",
    "data_completamento",
    "completed_at",
    "chiusa_il",
    "updated_at",
  ]);
}

function getDeadlineDate(row) {
  return firstValue(row, [
    "deadline",
    "data_scadenza",
    "scadenza",
    "due_date",
  ]);
}

function formatDateIt(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("it-IT");
}

function dateToInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeValue(value) {
  if (value === null || value === undefined || value === "") return "(Vuoto)";
  if (typeof value === "boolean") return value ? "Sì" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function isDateLike(value) {
  if (!value || typeof value !== "string") return false;
  return /^\d{4}-\d{2}-\d{2}/.test(value) && !Number.isNaN(Date.parse(value));
}

function groupValue(value, grouping) {
  if (!isDateLike(value) || grouping === "exact") return normalizeValue(value);

  const date = new Date(value);
  if (grouping === "year") return String(date.getFullYear());
  if (grouping === "month") {
    return date.toLocaleDateString("it-IT", { year: "numeric", month: "long" });
  }
  return date.toLocaleDateString("it-IT");
}

function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const normalized = value.replace(/\s/g, "").replace(",", ".");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function aggregateValues(values, aggregation) {
  if (aggregation === "count") return values.length;

  const numeric = values.map(toNumber).filter((value) => value !== null);
  if (numeric.length === 0) return 0;
  if (aggregation === "sum") return numeric.reduce((total, value) => total + value, 0);
  if (aggregation === "avg") {
    return numeric.reduce((total, value) => total + value, 0) / numeric.length;
  }
  if (aggregation === "min") return Math.min(...numeric);
  if (aggregation === "max") return Math.max(...numeric);
  return 0;
}

function formatMetric(value) {
  if (typeof value !== "number") return value;
  return new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 }).format(value);
}

function filterMatches(row, filter) {
  if (!filter.field) return true;

  const rawValue = row[filter.field];
  const current = rawValue === null || rawValue === undefined ? "" : String(rawValue);
  const expected = String(filter.value || "");
  const currentLower = current.toLowerCase();
  const expectedLower = expected.toLowerCase();

  if (filter.operator === "empty") return current === "";
  if (filter.operator === "not_empty") return current !== "";
  if (filter.operator === "equals") return currentLower === expectedLower;
  if (filter.operator === "not_equals") return currentLower !== expectedLower;
  if (filter.operator === "starts_with") return currentLower.startsWith(expectedLower);
  if (filter.operator === "greater") {
    const left = toNumber(rawValue);
    const right = toNumber(filter.value);
    return left !== null && right !== null && left > right;
  }
  if (filter.operator === "less") {
    const left = toNumber(rawValue);
    const right = toNumber(filter.value);
    return left !== null && right !== null && left < right;
  }
  return currentLower.includes(expectedLower);
}

async function fetchAllRows(table) {
  const pageSize = 1000;
  const maxRows = 20000;
  let from = 0;
  let allRows = [];

  while (from < maxRows) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .range(from, from + pageSize - 1);

    if (error) throw error;

    const page = data || [];
    allRows = [...allRows, ...page];
    if (page.length < pageSize) break;
    from += pageSize;
  }

  return allRows;
}

function Reports() {
  const [source, setSource] = useState("v4_progetti");
  const [rows, setRows] = useState([]);
  const [fields, setFields] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [rowFields, setRowFields] = useState([]);
  const [columnField, setColumnField] = useState("");
  const [valueField, setValueField] = useState("");
  const [aggregation, setAggregation] = useState("count");
  const [rowDateGroup, setRowDateGroup] = useState("exact");
  const [columnDateGroup, setColumnDateGroup] = useState("exact");
  const [filters, setFilters] = useState([]);
  const [view, setView] = useState("pivot");

  const [analysisMode, setAnalysisMode] = useState("pivot");
  const [delayRows, setDelayRows] = useState([]);
  const [delayLoading, setDelayLoading] = useState(false);
  const [delayError, setDelayError] = useState("");
  const [delayStartDate, setDelayStartDate] = useState(() => {
    const date = new Date();
    date.setMonth(date.getMonth() - 3);
    return dateToInputValue(date);
  });
  const [delayEndDate, setDelayEndDate] = useState(() =>
    dateToInputValue(new Date())
  );

  useEffect(() => {
    loadSource();
  }, [source]);

  useEffect(() => {
    if (analysisMode === "delays") {
      loadDelayAnalysis();
    }
  }, [analysisMode]);

  async function loadSource() {
    setLoading(true);
    setError("");

    try {
      const [data, lookups] = await Promise.all([
        fetchAllRows(source),
        loadLookups(),
      ]);

      const enrichedData = enrichRowsWithLabels(data, lookups);
      setRows(enrichedData);

      const discoveredFields = getBusinessFields(enrichedData);

      setFields(discoveredFields);
      setRowFields(discoveredFields.length ? [discoveredFields[0]] : []);
      setColumnField("");
      setValueField("");
      setAggregation("count");
      setFilters([]);
    } catch (loadError) {
      console.error("Errore caricamento analisi dati:", loadError);
      setRows([]);
      setFields([]);
      setError(loadError.message || "Impossibile caricare i dati selezionati.");
    } finally {
      setLoading(false);
    }
  }


  async function loadDelayAnalysis() {
    setDelayLoading(true);
    setDelayError("");

    try {
      const [phaseRows, lookups] = await Promise.all([
        fetchAllRows("v4_fasi_progetto"),
        loadLookups(),
      ]);

      const enrichedPhases = enrichRowsWithLabels(phaseRows, lookups);

      const analyzed = enrichedPhases
        .filter((phase) => isCompletedPhase(phase))
        .map((phase) => {
          const deadline = getDeadlineDate(phase);
          const completedAt = getCompletionDate(phase);
          const delayDays = daysBetween(deadline, completedAt);

          const completedById = firstValue(phase, [
            "completato_da",
            "modificato_da",
            "assegnato_a",
            "responsabile_id",
          ]);

          const departmentId = firstValue(phase, [
            "reparto_id",
            "department_id",
          ]);

          const projectId = firstValue(phase, [
            "progetto_id",
            "project_id",
          ]);

          return {
            id: phase.id,
            fase:
              firstValue(phase, ["titolo", "nome", "descrizione"]) ||
              phase.fase_titolo ||
              "Fase senza titolo",
            progetto:
              phase.progetto_titolo ||
              lookups.progetti?.get(projectId) ||
              "Progetto non disponibile",
            completata_da:
              phase.completato_da_nome ||
              phase.modificato_da_nome ||
              phase.assegnato_a_nome ||
              lookups.utenti?.get(completedById) ||
              "Utente non disponibile",
            reparto:
              phase.reparto_nome ||
              lookups.reparti?.get(departmentId) ||
              "Reparto non disponibile",
            deadline,
            completata_il: completedAt,
            giorni_ritardo: delayDays,
            in_ritardo:
              delayDays !== null && delayDays > 0,
            stato: firstValue(phase, ["stato", "status"]) || "Completata",
          };
        })
        .filter((row) => row.deadline && row.completata_il);

      setDelayRows(analyzed);
    } catch (loadError) {
      console.error("Errore analisi ritardi:", loadError);
      setDelayRows([]);
      setDelayError(
        loadError.message ||
          "Impossibile caricare l'analisi delle fasi completate."
      );
    } finally {
      setDelayLoading(false);
    }
  }

  function applyDelayPreset(preset) {
    const end = new Date();
    let start = new Date();

    if (preset === "30") {
      start.setDate(start.getDate() - 30);
    } else if (preset === "90") {
      start.setDate(start.getDate() - 90);
    } else if (preset === "year") {
      start = new Date(end.getFullYear(), 0, 1);
    } else {
      setDelayStartDate("");
      setDelayEndDate("");
      return;
    }

    setDelayStartDate(dateToInputValue(start));
    setDelayEndDate(dateToInputValue(end));
  }

  function toggleRowField(field) {
    setRowFields((current) =>
      current.includes(field)
        ? current.filter((item) => item !== field)
        : [...current, field]
    );
  }

  function addFilter() {
    setFilters((current) => [
      ...current,
      { id: crypto.randomUUID(), field: fields[0] || "", operator: "contains", value: "" },
    ]);
  }

  function updateFilter(id, field, value) {
    setFilters((current) =>
      current.map((filter) => (filter.id === id ? { ...filter, [field]: value } : filter))
    );
  }

  function removeFilter(id) {
    setFilters((current) => current.filter((filter) => filter.id !== id));
  }

  function resetConfiguration() {
    setRowFields(fields.length ? [fields[0]] : []);
    setColumnField("");
    setValueField("");
    setAggregation("count");
    setRowDateGroup("exact");
    setColumnDateGroup("exact");
    setFilters([]);
  }

  const filteredRows = useMemo(
    () => rows.filter((row) => filters.every((filter) => filterMatches(row, filter))),
    [rows, filters]
  );

  const pivot = useMemo(() => {
    if (rowFields.length === 0) {
      return { columns: [], rows: [], grandTotal: 0 };
    }

    const buckets = new Map();
    const columnSet = new Set();

    filteredRows.forEach((record) => {
      const rowValues = rowFields.map((field) =>
        groupValue(record[field], isDateLike(record[field]) ? rowDateGroup : "exact")
      );
      const rowKey = JSON.stringify(rowValues);
      const columnKey = columnField
        ? groupValue(
            record[columnField],
            isDateLike(record[columnField]) ? columnDateGroup : "exact"
          )
        : "Valore";

      columnSet.add(columnKey);

      if (!buckets.has(rowKey)) {
        buckets.set(rowKey, { rowValues, cells: new Map(), allValues: [] });
      }

      const bucket = buckets.get(rowKey);
      const metricValue = aggregation === "count" ? 1 : record[valueField];

      if (!bucket.cells.has(columnKey)) bucket.cells.set(columnKey, []);
      bucket.cells.get(columnKey).push(metricValue);
      bucket.allValues.push(metricValue);
    });

    const columns = Array.from(columnSet).sort((a, b) =>
      String(a).localeCompare(String(b), "it", { numeric: true })
    );

    const pivotRows = Array.from(buckets.values())
      .map((bucket) => {
        const cells = {};
        columns.forEach((column) => {
          cells[column] = aggregateValues(bucket.cells.get(column) || [], aggregation);
        });

        return {
          rowValues: bucket.rowValues,
          cells,
          total: aggregateValues(bucket.allValues, aggregation),
        };
      })
      .sort((a, b) =>
        a.rowValues.join(" ").localeCompare(b.rowValues.join(" "), "it", {
          numeric: true,
        })
      );

    const grandValues = filteredRows.map((record) =>
      aggregation === "count" ? 1 : record[valueField]
    );

    return {
      columns,
      rows: pivotRows,
      grandTotal: aggregateValues(grandValues, aggregation),
    };
  }, [filteredRows, rowFields, columnField, valueField, aggregation, rowDateGroup, columnDateGroup]);

  const numericFields = useMemo(
    () =>
      fields.filter((field) =>
        rows.some((row) => row[field] !== null && toNumber(row[field]) !== null)
      ),
    [fields, rows]
  );


  const filteredDelayRows = useMemo(() => {
    const start = delayStartDate ? parseDateOnly(delayStartDate) : null;
    const end = delayEndDate ? parseDateOnly(delayEndDate) : null;

    return delayRows.filter((row) => {
      const completed = parseDateOnly(row.completata_il);
      if (!completed) return false;
      if (start && completed < start) return false;
      if (end && completed > end) return false;
      return true;
    });
  }, [delayRows, delayStartDate, delayEndDate]);

  const delayStats = useMemo(() => {
    const completed = filteredDelayRows.length;
    const lateRows = filteredDelayRows.filter((row) => row.in_ritardo);
    const late = lateRows.length;
    const totalDelay = lateRows.reduce(
      (sum, row) => sum + (row.giorni_ritardo || 0),
      0
    );
    const averageDelay = late ? totalDelay / late : 0;
    const maxDelay = late
      ? Math.max(...lateRows.map((row) => row.giorni_ritardo || 0))
      : 0;
    const latePercentage = completed ? (late / completed) * 100 : 0;

    return {
      completed,
      late,
      onTime: completed - late,
      averageDelay,
      maxDelay,
      latePercentage,
    };
  }, [filteredDelayRows]);

  async function loadPdfLogo() {
    try {
      const response = await fetch("/logo.png");
      if (!response.ok) return null;

      const blob = await response.blob();
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (logoError) {
      console.warn("Logo PDF non disponibile:", logoError);
      return null;
    }
  }

  function formatPdfPeriod(startDate, endDate) {
    if (!startDate && !endDate) return "Tutto il periodo disponibile";
    return `${startDate ? formatDateIt(startDate) : "Inizio"} - ${
      endDate ? formatDateIt(endDate) : "Oggi"
    }`;
  }

  function addPdfPageNumber(doc) {
    const pageCount = doc.internal.getNumberOfPages();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    for (let page = 1; page <= pageCount; page += 1) {
      doc.setPage(page);
      doc.setFontSize(8);
      doc.setTextColor(107, 100, 92);
      doc.text(`Pagina ${page} di ${pageCount}`, pageWidth - 14, pageHeight - 8, {
        align: "right",
      });
    }
  }

  async function drawPdfHeader(doc, title, subtitleLines = []) {
    const logo = await loadPdfLogo();
    const pageWidth = doc.internal.pageSize.getWidth();

    if (logo) {
      doc.addImage(logo, "PNG", 14, 10, 25, 30);
    }

    doc.setTextColor(45, 43, 40);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.text(title, pageWidth - 14, 21, { align: "right" });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    subtitleLines.forEach((line, index) => {
      doc.text(line, pageWidth - 14, 29 + index * 6, { align: "right" });
    });

    const lineY = 44 + Math.max(0, subtitleLines.length - 1) * 4;
    doc.setDrawColor(150, 150, 150);
    doc.setLineWidth(0.5);
    doc.line(14, lineY, pageWidth - 14, lineY);

    return lineY;
  }

  async function exportDelayPdf() {
    if (!filteredDelayRows.length) {
      alert("Non ci sono dati da esportare nel periodo selezionato.");
      return;
    }

    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const period = formatPdfPeriod(delayStartDate, delayEndDate);
    const headerY = await drawPdfHeader(doc, "Report Ritardi Fasi", [
      `Periodo: ${period}`,
      `Fasi analizzate: ${delayStats.completed}`,
    ]);

    const summaryY = headerY + 8;
    const summaryItems = [
      ["Fasi completate", delayStats.completed],
      ["In ritardo", delayStats.late],
      ["Nei tempi", delayStats.onTime],
      ["% in ritardo", `${formatMetric(delayStats.latePercentage)}%`],
      ["Ritardo medio", `${formatMetric(delayStats.averageDelay)} gg`],
      ["Ritardo massimo", `${delayStats.maxDelay} gg`],
    ];

    const cardWidth = 42;
    summaryItems.forEach(([label, value], index) => {
      const x = 14 + index * 45;
      doc.setFillColor(247, 245, 242);
      doc.setDrawColor(216, 209, 203);
      doc.roundedRect(x, summaryY, cardWidth, 18, 2, 2, "FD");
      doc.setTextColor(107, 100, 92);
      doc.setFontSize(8);
      doc.text(String(label), x + 3, summaryY + 6);
      doc.setTextColor(45, 43, 40);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text(String(value), x + 3, summaryY + 14);
      doc.setFont("helvetica", "normal");
    });

    const sortedRows = filteredDelayRows
      .slice()
      .sort((a, b) => (b.giorni_ritardo || 0) - (a.giorni_ritardo || 0));

    autoTable(doc, {
      startY: summaryY + 24,
      head: [[
        "Fase / attività",
        "Progetto",
        "Completata da",
        "Reparto",
        "Deadline",
        "Completata il",
        "Esito",
        "Giorni ritardo",
      ]],
      body: sortedRows.map((row) => [
        row.fase,
        row.progetto,
        row.completata_da,
        row.reparto,
        formatDateIt(row.deadline),
        formatDateIt(row.completata_il),
        row.in_ritardo ? "In ritardo" : "Nei tempi",
        row.giorni_ritardo || 0,
      ]),
      theme: "grid",
      styles: {
        fontSize: 7.4,
        textColor: [45, 43, 40],
        lineColor: [216, 209, 203],
        lineWidth: 0.2,
        cellPadding: 2.2,
        valign: "middle",
        overflow: "linebreak",
      },
      headStyles: {
        fillColor: [45, 43, 40],
        textColor: [255, 255, 255],
        fontStyle: "bold",
      },
      alternateRowStyles: {
        fillColor: [247, 245, 242],
      },
      columnStyles: {
        0: { cellWidth: 46 },
        1: { cellWidth: 42 },
        2: { cellWidth: 34 },
        3: { cellWidth: 28 },
        4: { cellWidth: 23 },
        5: { cellWidth: 25 },
        6: { cellWidth: 24 },
        7: { cellWidth: 20, halign: "right" },
      },
      margin: { left: 14, right: 14, bottom: 14 },
    });

    addPdfPageNumber(doc);
    const suffix = delayStartDate || delayEndDate
      ? `${delayStartDate || "inizio"}_${delayEndDate || "oggi"}`
      : "tutto-periodo";
    doc.save(`report-ritardi-fasi-${suffix}.pdf`);
  }

  async function exportPivotPdf() {
    if (!filteredRows.length) {
      alert("Non ci sono dati da esportare.");
      return;
    }

    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const headerY = await drawPdfHeader(doc, "Report Analisi Dati", [
      `Archivio: ${sourceLabel}`,
      `Record analizzati: ${filteredRows.length.toLocaleString("it-IT")}`,
    ]);

    if (view === "raw") {
      const visibleFields = fields.slice(0, 12);
      autoTable(doc, {
        startY: headerY + 7,
        head: [visibleFields.map(humanize)],
        body: filteredRows.map((row) =>
          visibleFields.map((field) => normalizeValue(row[field]))
        ),
        theme: "grid",
        styles: {
          fontSize: 7,
          textColor: [45, 43, 40],
          lineColor: [216, 209, 203],
          lineWidth: 0.2,
          cellPadding: 2,
          overflow: "linebreak",
        },
        headStyles: {
          fillColor: [45, 43, 40],
          textColor: [255, 255, 255],
          fontStyle: "bold",
        },
        alternateRowStyles: { fillColor: [247, 245, 242] },
        margin: { left: 14, right: 14, bottom: 14 },
      });
    } else {
      if (!rowFields.length) {
        alert("Seleziona almeno un campo riga prima di esportare il PDF.");
        return;
      }

      const head = [
        ...rowFields.map(humanize),
        ...pivot.columns,
        "Totale",
      ];
      const body = pivot.rows.map((row) => [
        ...row.rowValues,
        ...pivot.columns.map((column) => formatMetric(row.cells[column])),
        formatMetric(row.total),
      ]);

      autoTable(doc, {
        startY: headerY + 7,
        head: [head],
        body,
        theme: "grid",
        styles: {
          fontSize: 7.2,
          textColor: [45, 43, 40],
          lineColor: [216, 209, 203],
          lineWidth: 0.2,
          cellPadding: 2.1,
          overflow: "linebreak",
        },
        headStyles: {
          fillColor: [45, 43, 40],
          textColor: [255, 255, 255],
          fontStyle: "bold",
        },
        alternateRowStyles: { fillColor: [247, 245, 242] },
        margin: { left: 14, right: 14, bottom: 14 },
      });
    }

    addPdfPageNumber(doc);
    doc.save(`report-analisi-${source}.pdf`);
  }

  function exportDelayExcel() {
    const exportRows = filteredDelayRows.map((row) => ({
      Fase: row.fase,
      Progetto: row.progetto,
      "Completata da": row.completata_da,
      Reparto: row.reparto,
      Deadline: formatDateIt(row.deadline),
      "Data completamento": formatDateIt(row.completata_il),
      "Completata in ritardo": row.in_ritardo ? "Sì" : "No",
      "Giorni di ritardo": row.giorni_ritardo || 0,
      Stato: row.stato,
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Ritardi fasi");
    XLSX.writeFile(workbook, "analisi-ritardi-fasi.xlsx");
  }

  function exportExcel() {
    if (view === "raw") {
      const worksheet = XLSX.utils.json_to_sheet(filteredRows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Dati");
      XLSX.writeFile(workbook, `analisi-${source}.xlsx`);
      return;
    }

    const exportRows = pivot.rows.map((row) => {
      const item = {};
      rowFields.forEach((field, index) => {
        item[humanize(field)] = row.rowValues[index];
      });
      pivot.columns.forEach((column) => {
        item[column] = row.cells[column];
      });
      item.Totale = row.total;
      return item;
    });

    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Pivot");
    XLSX.writeFile(workbook, `pivot-${source}.xlsx`);
  }

  const sourceLabel = DATA_SOURCES.find((item) => item.value === source)?.label || source;

  return (
    <div className="data-analysis-page">
      <div className="page-title-row">
        <div>
          <h1>Analisi dati</h1>
          <p>Pivot interattiva con selezione libera di righe, colonne, valori e filtri.</p>
        </div>

        <div className="analysis-title-actions">
          <button className="secondary-action" onClick={loadSource} disabled={loading}>
            <RefreshCw size={18} />
            Aggiorna dati
          </button>
          <button
            className="secondary-action"
            onClick={analysisMode === "delays" ? exportDelayPdf : exportPivotPdf}
            disabled={
              analysisMode === "delays"
                ? !filteredDelayRows.length
                : !filteredRows.length
            }
          >
            <FileText size={18} />
            Esporta PDF
          </button>
          <button
            className="primary-action"
            onClick={analysisMode === "delays" ? exportDelayExcel : exportExcel}
            disabled={
              analysisMode === "delays"
                ? !filteredDelayRows.length
                : !filteredRows.length
            }
          >
            <Download size={18} />
            Esporta Excel
          </button>
        </div>
      </div>

      <div className="analysis-view-toggle analysis-mode-toggle">
        <button
          className={analysisMode === "pivot" ? "active" : ""}
          onClick={() => setAnalysisMode("pivot")}
        >
          <BarChart3 size={17} />
          Pivot libera
        </button>
        <button
          className={analysisMode === "delays" ? "active" : ""}
          onClick={() => setAnalysisMode("delays")}
        >
          <Clock3 size={17} />
          Ritardi completamento fasi
        </button>
      </div>

      {analysisMode === "pivot" ? (
      <div className="analysis-layout">
        <aside className="analysis-config panel">
          <div className="analysis-section">
            <label className="analysis-label">Archivio da analizzare</label>
            <select value={source} onChange={(event) => setSource(event.target.value)}>
              {DATA_SOURCES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
            <small>{rows.length.toLocaleString("it-IT")} record caricati</small>
          </div>

          <div className="analysis-section">
            <div className="analysis-section-heading">
              <div>
                <strong>Campi riga</strong>
                <small>Puoi selezionarne più di uno</small>
              </div>
            </div>
            <div className="field-check-list">
              {fields.map((field) => (
                <label key={field}>
                  <input
                    type="checkbox"
                    checked={rowFields.includes(field)}
                    onChange={() => toggleRowField(field)}
                  />
                  <span>{humanize(field)}</span>
                </label>
              ))}
            </div>
            <label className="analysis-label compact">Raggruppamento date riga</label>
            <select value={rowDateGroup} onChange={(event) => setRowDateGroup(event.target.value)}>
              {DATE_GROUPS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </div>

          <div className="analysis-section">
            <label className="analysis-label">Campo colonna</label>
            <select value={columnField} onChange={(event) => setColumnField(event.target.value)}>
              <option value="">Nessuna colonna</option>
              {fields.map((field) => (
                <option key={field} value={field}>{humanize(field)}</option>
              ))}
            </select>
            <label className="analysis-label compact">Raggruppamento date colonna</label>
            <select value={columnDateGroup} onChange={(event) => setColumnDateGroup(event.target.value)}>
              {DATE_GROUPS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </div>

          <div className="analysis-section">
            <label className="analysis-label">Calcolo</label>
            <select value={aggregation} onChange={(event) => setAggregation(event.target.value)}>
              {AGGREGATIONS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>

            {aggregation !== "count" && (
              <>
                <label className="analysis-label compact">Campo numerico</label>
                <select value={valueField} onChange={(event) => setValueField(event.target.value)}>
                  <option value="">Seleziona campo</option>
                  {numericFields.map((field) => (
                    <option key={field} value={field}>{humanize(field)}</option>
                  ))}
                </select>
              </>
            )}
          </div>

          <div className="analysis-section">
            <div className="analysis-section-heading">
              <div>
                <strong>Filtri</strong>
                <small>Applica uno o più criteri</small>
              </div>
              <button type="button" onClick={addFilter} disabled={!fields.length}>
                <Plus size={16} />
              </button>
            </div>

            <div className="analysis-filters">
              {filters.length === 0 && <p>Nessun filtro applicato.</p>}
              {filters.map((filter) => (
                <div className="analysis-filter-row" key={filter.id}>
                  <select
                    value={filter.field}
                    onChange={(event) => updateFilter(filter.id, "field", event.target.value)}
                  >
                    {fields.map((field) => (
                      <option key={field} value={field}>{humanize(field)}</option>
                    ))}
                  </select>
                  <select
                    value={filter.operator}
                    onChange={(event) => updateFilter(filter.id, "operator", event.target.value)}
                  >
                    {OPERATORS.map((item) => (
                      <option key={item.value} value={item.value}>{item.label}</option>
                    ))}
                  </select>
                  {!['empty', 'not_empty'].includes(filter.operator) && (
                    <input
                      value={filter.value}
                      onChange={(event) => updateFilter(filter.id, "value", event.target.value)}
                      placeholder="Valore"
                    />
                  )}
                  <button type="button" onClick={() => removeFilter(filter.id)}>
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <button className="analysis-reset" onClick={resetConfiguration}>
            <RotateCcw size={17} />
            Reimposta pivot
          </button>
        </aside>

        <section className="analysis-result panel">
          <div className="analysis-result-header">
            <div>
              <h3>{sourceLabel}</h3>
              <p>
                {filteredRows.length.toLocaleString("it-IT")} record dopo i filtri · Totale pivot: {formatMetric(pivot.grandTotal)}
              </p>
            </div>

            <div className="analysis-view-toggle">
              <button className={view === "pivot" ? "active" : ""} onClick={() => setView("pivot")}>
                <BarChart3 size={17} /> Pivot
              </button>
              <button className={view === "raw" ? "active" : ""} onClick={() => setView("raw")}>
                <Table2 size={17} /> Dati
              </button>
            </div>
          </div>

          {loading && <div className="analysis-state">Caricamento dati...</div>}
          {!loading && error && <div className="analysis-state error">{error}</div>}
          {!loading && !error && fields.length === 0 && (
            <div className="analysis-state">L’archivio non contiene record o non è accessibile.</div>
          )}

          {!loading && !error && fields.length > 0 && view === "pivot" && (
            rowFields.length === 0 ? (
              <div className="analysis-state">Seleziona almeno un campo riga.</div>
            ) : aggregation !== "count" && !valueField ? (
              <div className="analysis-state">Seleziona il campo numerico da aggregare.</div>
            ) : (
              <div className="pivot-scroll">
                <table className="pivot-table">
                  <thead>
                    <tr>
                      {rowFields.map((field) => <th key={field}>{humanize(field)}</th>)}
                      {pivot.columns.map((column) => <th key={column}>{column}</th>)}
                      <th>Totale</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pivot.rows.map((row, rowIndex) => (
                      <tr key={`${row.rowValues.join("-")}-${rowIndex}`}>
                        {row.rowValues.map((value, index) => (
                          <td className="pivot-row-label" key={`${value}-${index}`}>{value}</td>
                        ))}
                        {pivot.columns.map((column) => (
                          <td className="pivot-value" key={column}>{formatMetric(row.cells[column])}</td>
                        ))}
                        <td className="pivot-total">{formatMetric(row.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}

          {!loading && !error && fields.length > 0 && view === "raw" && (
            <div className="pivot-scroll">
              <table className="pivot-table raw-table">
                <thead>
                  <tr>
                    {fields.map((field) => <th key={field}>{humanize(field)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.slice(0, 500).map((row, rowIndex) => (
                    <tr key={row.id || rowIndex}>
                      {fields.map((field) => <td key={field}>{normalizeValue(row[field])}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredRows.length > 500 && (
                <p className="analysis-limit-note">Anteprima limitata a 500 righe. L’esportazione Excel include tutti i record filtrati.</p>
              )}
            </div>
          )}
        </section>
      </div>
      ) : (
        <section className="analysis-result panel delay-analysis-panel">
          <div className="analysis-result-header">
            <div>
              <h3>Ritardi completamento fasi</h3>
              <p>
                Analisi delle fasi completate entro o dopo la deadline,
                filtrata per data effettiva di completamento.
              </p>
            </div>

            <button
              className="secondary-action"
              onClick={loadDelayAnalysis}
              disabled={delayLoading}
            >
              <RefreshCw size={18} />
              Aggiorna dati
            </button>
          </div>

          <div className="delay-date-controls">
            <div className="delay-date-field">
              <label>Dal</label>
              <input
                type="date"
                value={delayStartDate}
                onChange={(event) => setDelayStartDate(event.target.value)}
              />
            </div>

            <div className="delay-date-field">
              <label>Al</label>
              <input
                type="date"
                value={delayEndDate}
                onChange={(event) => setDelayEndDate(event.target.value)}
              />
            </div>

            <div className="delay-presets">
              <button type="button" onClick={() => applyDelayPreset("30")}>
                Ultimi 30 giorni
              </button>
              <button type="button" onClick={() => applyDelayPreset("90")}>
                Ultimi 90 giorni
              </button>
              <button type="button" onClick={() => applyDelayPreset("year")}>
                Anno corrente
              </button>
              <button type="button" onClick={() => applyDelayPreset("all")}>
                Tutto
              </button>
            </div>
          </div>

          {delayLoading && (
            <div className="analysis-state">Caricamento analisi ritardi...</div>
          )}

          {!delayLoading && delayError && (
            <div className="analysis-state error">{delayError}</div>
          )}

          {!delayLoading && !delayError && (
            <>
              <div className="delay-kpi-grid">
                <div className="delay-kpi-card">
                  <span>Fasi completate</span>
                  <strong>{delayStats.completed}</strong>
                </div>
                <div className="delay-kpi-card warning">
                  <span>Completate in ritardo</span>
                  <strong>{delayStats.late}</strong>
                </div>
                <div className="delay-kpi-card success">
                  <span>Completate nei tempi</span>
                  <strong>{delayStats.onTime}</strong>
                </div>
                <div className="delay-kpi-card">
                  <span>% completate in ritardo</span>
                  <strong>{formatMetric(delayStats.latePercentage)}%</strong>
                </div>
                <div className="delay-kpi-card">
                  <span>Ritardo medio</span>
                  <strong>{formatMetric(delayStats.averageDelay)} giorni</strong>
                </div>
                <div className="delay-kpi-card">
                  <span>Ritardo massimo</span>
                  <strong>{delayStats.maxDelay} giorni</strong>
                </div>
              </div>

              {filteredDelayRows.length === 0 ? (
                <div className="analysis-state">
                  Nessuna fase completata con deadline nell’arco temporale
                  selezionato.
                </div>
              ) : (
                <div className="pivot-scroll">
                  <table className="pivot-table raw-table">
                    <thead>
                      <tr>
                        <th>Fase / attività</th>
                        <th>Progetto</th>
                        <th>Completata da</th>
                        <th>Reparto</th>
                        <th>Deadline</th>
                        <th>Completata il</th>
                        <th>Esito</th>
                        <th>Giorni di ritardo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredDelayRows
                        .slice()
                        .sort(
                          (a, b) =>
                            (b.giorni_ritardo || 0) -
                            (a.giorni_ritardo || 0)
                        )
                        .map((row) => (
                          <tr key={row.id}>
                            <td className="pivot-row-label">{row.fase}</td>
                            <td>{row.progetto}</td>
                            <td>{row.completata_da}</td>
                            <td>{row.reparto}</td>
                            <td>{formatDateIt(row.deadline)}</td>
                            <td>{formatDateIt(row.completata_il)}</td>
                            <td>
                              <span
                                className={
                                  row.in_ritardo
                                    ? "delay-status late"
                                    : "delay-status on-time"
                                }
                              >
                                {row.in_ritardo
                                  ? "In ritardo"
                                  : "Nei tempi"}
                              </span>
                            </td>
                            <td className="pivot-value">
                              {row.giorni_ritardo || 0}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}

export default Reports;
