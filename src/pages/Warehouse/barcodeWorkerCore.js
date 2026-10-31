export const barcodeReadOptions={tryHarder:true,tryRotate:true,tryInvert:true,tryDownscale:true,tryDenoise:true,maxNumberOfSymbols:8,returnErrors:false};

export function nearestBarcode(results,width,height){
  return results.filter(result=>result.isValid && result.text?.trim()).sort((a,b)=>{
    const distance=result=>{const p=result.position;if(!p)return Infinity;const points=Object.values(p).filter(v=>Number.isFinite(v?.x)&&Number.isFinite(v?.y));if(!points.length)return Infinity;const x=points.reduce((n,p)=>n+p.x,0)/points.length,y=points.reduce((n,p)=>n+p.y,0)/points.length;return(x-width/2)**2+(y-height/2)**2;};
    return distance(a)-distance(b);
  })[0]?.text || null;
}

// A detected value expires quickly and is invalidated by a missing frame.
// Preview decoding never modifies the order: only Acquisisci confirms a value.
export function createScanCandidate(maxAge=700){
  let value=null,at=0;
  return{update(code,now=Date.now()){value=code;at=now;},take(now=Date.now()){const result=value && now-at<=maxAge ? value : null;value=null;return result;},clear(){value=null;}};
}
