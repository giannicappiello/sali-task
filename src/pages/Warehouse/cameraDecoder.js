export async function createCameraDecoder({signal,workerFactory=()=>new Worker(new URL("./barcode.worker.js",import.meta.url),{type:"module"}),createCanvas=()=>document.createElement("canvas")}={}){
  const worker=workerFactory(),canvas=createCanvas();
  let sequence=0,pending=null,disposed=false,initTimer;
  let resolveReady,rejectReady;
  const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
  const fail=message=>{const error=new Error(message);clearTimeout(initTimer);rejectReady(error);if(pending){pending.reject(error);clearTimeout(pending.timer);pending=null;}};
  worker.onmessage=({data})=>{
    if(disposed)return;
    if(data.type==="ready"){clearTimeout(initTimer);resolveReady();}
    else if(data.type==="fatal")fail(data.error);
    else if(data.type==="result" && pending?.id===data.id){const task=pending;pending=null;clearTimeout(task.timer);data.error?task.reject(new Error(data.error)):task.resolve(data.code);}
  };
  worker.onerror=()=>fail("Impossibile avviare il lettore. Premi Acquisisci per riprovare.");
  initTimer=setTimeout(()=>fail("Avvio del lettore non riuscito. Premi Acquisisci per riprovare."),15000);
  const dispose=()=>{if(disposed)return;disposed=true;fail("Lettore chiuso.");worker.terminate();signal?.removeEventListener("abort",dispose);};
  signal?.addEventListener("abort",dispose,{once:true});
  if(signal?.aborted)dispose();
  try{await ready;}catch(error){dispose();throw error;}
  const read=source=>{
    if(disposed)return Promise.reject(new Error("Lettore chiuso."));
    if(pending)return Promise.reject(new Error("Lettura già in corso."));
    if(source.readyState<2 || !source.videoWidth || !source.videoHeight)return Promise.resolve(null);
    if(canvas.width!==source.videoWidth)canvas.width=source.videoWidth;
    if(canvas.height!==source.videoHeight)canvas.height=source.videoHeight;
    const context=canvas.getContext("2d",{willReadFrequently:true});
    if(!context)return Promise.reject(new Error("Impossibile acquisire l’immagine."));
    context.drawImage(source,0,0);
    const image=context.getImageData(0,0,canvas.width,canvas.height),id=++sequence;
    return new Promise((resolve,reject)=>{
      pending={id,resolve,reject,timer:setTimeout(()=>{if(pending?.id===id){pending=null;reject(new Error("Il lettore non risponde. Chiudi la fotocamera e riaprila."));}},5000)};
      try{worker.postMessage({type:"decode",id,width:image.width,height:image.height,buffer:image.data.buffer},[image.data.buffer]);}
      catch(error){clearTimeout(pending.timer);pending=null;reject(error);}
    });
  };
  read.dispose=dispose;
  return read;
}
