import {formatDate,formatMoney} from './crmConfig.js';
import {formatPurchaseAmount} from './customerPurchaseModel.js';
const numeric=value=>value==null || value==='' || !Number.isFinite(Number(value)) ? null : Number(value);
const timestamp=value=>value && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
export const ACCOUNT_COLUMNS = [
  { value: (row) => `${row.nome} ${row.codice}`, sortValue: row => row.nome },
  { value: (row) => row.origine },
  { value: (row) => `${formatMoney(row.invoice_total)} ${row.invoice_count || 0} fatture`, sortValue: row => numeric(row.invoice_total) },
  { value: (row) => `${formatPurchaseAmount(row.order_total, row.currency)} ${row.order_count || 0} ordini`, sortValue: row => numeric(row.order_total) },
  { value: (row) => formatDate(row.ultimo_ordine_il || row.last_purchase), sortValue: row => timestamp(row.ultimo_ordine_il || row.last_purchase) },
  { value: (row) => row.average_gap_days == null ? "—" : `${Number(row.average_gap_days).toLocaleString("it-IT", { useGrouping: 'always',  maximumFractionDigits: 1 })} gg`, sortValue: row => numeric(row.average_gap_days) },
  { value: (row) => formatDate(row.expected_reorder_date), sortValue: row => timestamp(row.expected_reorder_date) },
  { value: (row) => row.agente_classificazione || "Senza agente" },
  { value: (row) => `${row.crm_active ? "Attivo" : "Non attivo"} ${row.crm_status_reason || ""}` },
  { value: (row) => row.source === "Workspace/Mexal" ? (row.attivo_mexal === false ? "Annullato" : "Attivo") : "Non presente" },
  { value: (row) => row.crm_active ? "Apri cliente Nuova attività Nuovo progetto Disattiva" : "Apri cliente Nuova attività Nuovo progetto Riattiva" },
];
export const ONLINE_ACCOUNT_COLUMNS=[...ACCOUNT_COLUMNS.slice(0,2),{value:row=>row.mailing?.label},...ACCOUNT_COLUMNS.slice(2)];
