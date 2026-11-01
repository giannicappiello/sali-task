
import CrmRemoteProductBreakdown from './CrmRemoteProductBreakdown';


import CrmProductPurchaseDetails from './CrmProductPurchaseDetails';
export default function CrmProductDocumentLines({parameters={},code,rows,customer,mode}) {
 if(rows)return <CrmProductPurchaseDetails lines={rows} mode={mode} customer={customer}/>;
 return <CrmRemoteProductBreakdown parameters={parameters} code={code} mode={mode}/>;
}
