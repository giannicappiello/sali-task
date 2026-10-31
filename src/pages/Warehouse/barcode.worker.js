import {prepareZXingModule,readBarcodes} from "zxing-wasm/reader";
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";
import {decodeBarcodeImage} from "./barcodeWorkerCore.js";

const ready=prepareZXingModule({overrides:{locateFile:path=>path.endsWith(".wasm")?wasmUrl:path},fireImmediately:true});
ready.then(()=>self.postMessage({type:"ready"})).catch(()=>self.postMessage({type:"fatal",error:"Impossibile avviare il lettore. Premi Acquisisci per riprovare."}));
self.onmessage=async({data})=>{
  if(data.type!=="decode")return;
  try{
    await ready;
    const image=new ImageData(new Uint8ClampedArray(data.buffer),data.width,data.height);
    const code=await decodeBarcodeImage(image,readBarcodes);
    self.postMessage({type:"result",id:data.id,code});
  }catch{self.postMessage({type:"result",id:data.id,error:"Errore del lettore. Chiudi la fotocamera e riaprila."});}
};
