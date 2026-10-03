import { productionStatus } from '../../lib/productionStatus.js';
import { Modal } from '../../features/production-costs/common';
import { displayDate } from '../../lib/displayDate.js';
import PreparationActions from './PreparationActions';
import BatchSheetActions from './BatchSheetActions';
import PackagingOperationalActions from './PackagingOperationalActions';
import ProductSpecificationViewButton from '../Documentation/ProductSpecificationViewButton';
import './dashboard-planning.css';

export default function BatchActivitiesDialog({ activities, onClose, onChanged }) {
  const first = activities[0];
  return <div className="dashboard-activities-page" style={{ display: 'contents' }}>
    <Modal title={first.titolo} data-record-id={first.productionOrderId} data-order-number={first.orderNumber}
      data-batch-number={first.batchNumber} data-article-code={first.articleCode} onClose={onClose}>
      {activities.map(activity => <section key={activity.id} data-phase={activity.reparto} aria-label={activity.reparto}>
        <p><strong className={`production-label ${activity.operationType === 'Production' ? 'preparation' : 'packaging'}`}>{activity.reparto}</strong></p>
        <p>{activity.descrizione || 'Nessuna descrizione'}</p>
        {activity.actualStart && <p><strong>Avviata il {displayDate(activity.actualStart, true)}</strong></p>}
        <div className="pc-metrics"><div><span>Risorsa</span><strong>{activity.resource}</strong></div>
          <div><span>Periodo</span><strong>{displayDate(activity.start, true)} – {displayDate(activity.end, true)}</strong></div>
          <div><span>Stato</span><strong>{productionStatus(activity.stato, activity.actualStart)}</strong></div></div>
        <div className="dashboard-production-actions">
          {activity.operationType === 'Production' ? <PreparationActions activity={activity} onStarted={onChanged}/> : <>
            <ProductSpecificationViewButton articleCode={activity.articleCode} description={activity.descrizione}/>
            <BatchSheetActions productionOrderId={activity.productionOrderId} kind="packaging"
              operationType={activity.operationType} batchNumber={activity.batchNumber}/>
            <PackagingOperationalActions {...activity} onStarted={onChanged}/>
          </>}
        </div>
      </section>)}
    </Modal>
  </div>;
}
