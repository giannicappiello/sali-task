import {createHash} from 'node:crypto';
export const importHash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function importTree(entries) {
 if(!entries.length||entries.length>20000)throw Error('Archivio vuoto o oltre 20000 frammenti.');
 const levels=[entries.map(importHash)];
 while(levels.at(-1).length>1){const a=levels.at(-1),b=[];for(let i=0;i<a.length;i+=2)b.push(importHash([a[i],a[i+1]??a[i]]));levels.push(b);}
 return {root:levels.at(-1)[0],proof:index=>{const proof=[];for(let l=0;l<levels.length-1;l++){const a=levels[l];proof.push({side:index%2?'left':'right',hash:a[index^1]??a[index]});index=Math.floor(index/2);}return proof;}};
}
export function verifyImportProof(entry,proof,root) {
 if(!Array.isArray(proof)||proof.length>15)return false;
 let hash=importHash(entry);
 for(const step of proof){if(!/^[a-f0-9]{64}$/.test(step?.hash)||!['left','right'].includes(step.side))return false;hash=importHash(step.side==='left'?[step.hash,hash]:[hash,step.hash]);}
 return hash===root;
}
