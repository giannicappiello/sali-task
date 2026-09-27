import { formatMoney } from './crmConfig';

export default function CrmOpenOrderBreakdown({ values = {} }) {
  return <span className="crm-open-order-breakdown">
    <span>Ordini PR in corso: {formatMoney(values.pr_order_total)}</span>
    <span>Stralci: {formatMoney(values.stralci_order_total)}</span>
    <span>Ordini PH: {formatMoney(values.ph_order_total)}</span>
    <span>Ordini PH prenotazioni: {formatMoney(values.ph_prenotazioni_total)}</span>
    <span>Ordini PR prenotazioni: {formatMoney(values.pr_prenotazioni_total)}</span>
  </span>;
}
