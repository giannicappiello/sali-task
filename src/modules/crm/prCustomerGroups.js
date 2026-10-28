export const MYPHARMA_CUSTOMER_CODE='501.00288';
export function prCustomerGroupMatches(code,group){
 return !group || group==='all' || (group==='mypharma'?code===MYPHARMA_CUSTOMER_CODE:group==='regular' && code!==MYPHARMA_CUSTOMER_CODE);
}
