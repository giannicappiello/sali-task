import { findTechnicalCredentialPath } from '../mexal/full-help-download.js';

const extra=/^(?:access[_-]?token|refresh[_-]?token|client[_-]?secret|service[_-]?role[_-]?key|connection[_-]?string|session[_-]?sealed|private[_-]?key)$/i;
export function hasCredentials(value,seen=new WeakSet()) {
 if(findTechnicalCredentialPath(value))return true;
 if(!value||typeof value!=='object'||seen.has(value))return false;
 seen.add(value);
 return Object.entries(value).some(([key,child])=>extra.test(key)||hasCredentials(child,seen));
}
