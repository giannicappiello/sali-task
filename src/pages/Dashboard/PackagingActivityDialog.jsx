import { Modal } from '../../features/production-costs/common';
import { displayDate } from '../../lib/displayDate';
import ProductSpecificationViewButton from '../Documentation/ProductSpecificationViewButton';
import PackagingSheetActions from './PackagingSheetActions';
import PackagingOperationalActions from './PackagingOperationalActions';
import './dashboard-planning.css';

export default function PackagingActivityDialog({ activity, onClose, onStarted }) {
 return <div className="dashboard-activities-page" style={{display:'contents'}}><Modal title={activity.titolo} data-record-id={activity.productionOrderId || activity.id} data-order-number={activity.orderNumber} data-article-code={activity.articleCode} data-phase={activity.reparto} onClose={onClose}>
  <p><strong className="production-label packaging">{activity.reparto}</strong></p>
  <p>{activity.descrizione || 'Nessuna descrizione'}</p>
  {activity.actualStart && <p><strong>Avviata il {displayDate(activity.actualStart, true)}</strong></p>}
  <div className="pc-metrics"><div><span>Risorsa</span><strong>{activity.resource}</strong></div><div><span>Periodo</span><strong>{displayDate(activity.start,true)} – {displayDate(activity.end,true)}</strong></div><div><span>Stato</span><strong>{activity.stato}</strong></div></div>
  <div className="dashboard-production-actions"><ProductSpecificationViewButton key={activity.articleCode} articleCode={activity.articleCode} description={activity.descrizione}/><PackagingSheetActions productionOrderId={activity.productionOrderId} operationType={activity.operationType} batchNumber={activity.batchNumber}/><PackagingOperationalActions key={activity.id} productionOrderId={activity.productionOrderId} resourceCode={activity.resourceCode} orderNumber={activity.orderNumber} articleCode={activity.articleCode} operationType={activity.operationType} onStarted={onStarted}/></div>
 </Modal></div>;
}
