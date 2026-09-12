import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Search } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import InfoTooltip from "../../components/InfoTooltip";
import CrmCustomerLink from "./CrmCustomerLink";
import CrmPeriodFilter, { useCrmPeriod } from "./CrmPeriodFilter";
import { CrmPageHeader, CrmSectionNav } from "./CrmWorkspaceUI";
import { crmNavigation } from "./crmNavigation";
import { formatDate, formatMoney } from "./crmConfig";
import { filterCustomerWorklist, loadCustomerWorklist, worklistCategories } from "./crmWorklist";
import "./worklist.css";

export default function CrmB2BWorklist({ mode = "follow-up" }) {
  const period = useCrmPeriod();
  const [params, setParams] = useSearchParams();
  const [state, setState] = useState({ rows: [], loading: true, error: "" });
  const search = params.get("customerSearch") || "";
  const category = params.get("followupCategory") || "";
  const segment = params.get("segment") || "";
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setState({ rows: [], loading: true, error: "" });
      try {
        const rows = await loadCustomerWorklist(supabase, period.from, period.to, controller.signal);
        if (!controller.signal.aborted) setState({ rows, loading: false, error: "" });
      } catch (error) {
        if (!controller.signal.aborted) setState({ rows: [], loading: false, error: error.message || "Impossibile caricare i clienti." });
      }
    }, 150);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [period.from, period.to]);
  const visible = useMemo(() => filterCustomerWorklist(state.rows, { search, category, segment, mode }), [state.rows, search, category, segment, mode]);
  const update = (key, value) => setParams(current => {
    const next = new URLSearchParams(current);
    if (value) next.set(key, value); else next.delete(key);
    if (key === "followupCategory") next.delete("segment");
    return next;
  }, { replace: true });
  const title = mode === "reorders" ? "Riordini e progetti commerciali" : "Clienti da seguire";
  return <div className="crm-page">
    <CrmPageHeader eyebrow="CRM DIRECT · BtoB" title={title} description="Un solo elenco di priorità commerciali, sulla stessa anagrafica cliente e senza modificarne lo stato." actions={<CrmPeriodFilter period={period} compact />}>
      <CrmSectionNav items={crmNavigation("b2b")} period={period} label="Navigazione CRM B2B" />
    </CrmPageHeader>
    <div className="crm-filters">
      <label><Search size={16} /><input aria-label="Cerca cliente o codice" value={search} onChange={event => update("customerSearch", event.target.value)} placeholder="Cerca cliente o codice" /></label>
      <label>Categoria<select aria-label="Categoria di follow-up" value={category} onChange={event => update("followupCategory", event.target.value)}>
        <option value="">Tutte le categorie</option>{Object.entries(worklistCategories).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      {segment && <button type="button" className="secondary-action" onClick={() => update("segment", "")}>Rimuovi filtro segmento: {segment.replaceAll("_", " ")}</button>}
    </div>
    <p className="crm-worklist-note">Priorità valutate al {formatDate(period.to)} sullo storico disponibile fino a quella data. Ordinato nel periodo: {formatDate(period.from)} – {formatDate(period.to)}. Ordinamento per urgenza e data di contatto consigliata.</p>
    {state.error && <div className="crm-message error" role="alert">{state.error}</div>}
    {state.loading ? <div className="crm-loading" role="status">Caricamento clienti…</div> : !state.error && <>
      <div className="crm-worklist-count">{visible.length} clienti · una riga per cliente</div>
      <div className="crm-table-wrap"><table className="crm-table crm-worklist-table">
        <thead><tr><th>Cliente</th><th>Categoria / motivo</th><th>Ultimo ordine</th><th>Ordini storici</th><th>Ordinato nel periodo</th><th>Contatto consigliato<InfoTooltip label="Contatto consigliato" text="Per i clienti mai ordinanti: data finale della valutazione. Per gli altri: ultimo acquisto più frequenza media tra giornate distinte; senza storico sufficiente si usa la soglia configurata. È una proposta, non un'attività creata automaticamente." /></th></tr></thead>
        <tbody>{visible.map(row => <tr key={row.codice_cliente}>
          <td><CrmCustomerLink crmType="b2b" customerCode={row.codice_cliente} name={row.ragione_sociale} period={period}>{row.ragione_sociale}</CrmCustomerLink><small>{row.codice_cliente}</small></td>
          <td><strong>{worklistCategories[row.categoria] || "Acquisti regolari"}</strong><small>{row.motivo}</small><span className="status-badge">{row.classificazione.replaceAll("_", " ")}</span></td>
          <td>{formatDate(row.ultimo_ordine_il)}{row.giorni_da_ultimo_ordine != null && <small>{row.giorni_da_ultimo_ordine} giorni alla data finale</small>}</td>
          <td>{row.numero_ordini}<small>{formatMoney(row.valore_ordini)} · {row.giornate_acquisto} giornate</small></td>
          <td>{formatMoney(row.ordinato_periodo)}<small>{row.ordini_periodo} ordini nel periodo</small></td>
          <td>{formatDate(row.contatto_consigliato_il)}{Number(row.numero_ordini) > 0 && <small>{row.frequenza_usata_giorni} giorni · {row.frequenza_media_giorni == null ? "soglia configurata" : "frequenza media"}</small>}</td>
        </tr>)}</tbody>
      </table>{!visible.length && <div className="crm-empty">Nessun cliente corrisponde ai filtri e alle priorità selezionate.</div>}</div>
    </>}
  </div>;
}
