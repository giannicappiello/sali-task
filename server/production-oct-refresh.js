import {octTargets,recoveredOctShare} from "../src/features/production-costs/oct-evidence.js";

export const octRecoverySignature=e=>JSON.stringify(octTargets(e));
export function needsOctRecovery(e,now=Date.now()) {
 const targets=octTargets(e).filter(t=>t.reference&&t.articleCode&&t.unit);
 if(!targets.length)return false;
 if(targets.every(t=>recoveredOctShare(e,t,[e]).value!==null))return false;
 const previous=e.octRecovery,age=now-Date.parse(previous?.recoveredAt);
 return !(previous?.targetSignature===octRecoverySignature(e)&&age>=0&&age<86400000);
}
