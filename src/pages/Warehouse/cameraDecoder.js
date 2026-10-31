import {createFrameDecoder} from "./barcodeFrame.js";

// @zxing/browser accepts the DecodeHintType map. TRY_HARDER is enum value 3
// in the installed ZXing API and scans more rows for difficult 1D labels.
export const ZXING_TRY_HARDER = new Map([[3, true]]);

export async function createCameraDecoder(reader, NativeDetector = globalThis.BarcodeDetector, createCanvas) {
  const fallback = createFrameDecoder(reader, createCanvas);
  let native;
  if (NativeDetector) {
    try {
      const formats = (await NativeDetector.getSupportedFormats()).filter(format=>format!=="unknown");
      if (formats.length) native = new NativeDetector({formats});
    } catch { /* ZXing remains available when native detection cannot start. */ }
  }
  return async source => {
    if (native) {
      try {
        const results = (await native.detect(source)).filter(result=>result.rawValue?.trim());
        const width=source.videoWidth || source.naturalWidth, height=source.videoHeight || source.naturalHeight;
        const distance=result=>{const box=result.boundingBox;return box ? (box.x+box.width/2-width/2)**2+(box.y+box.height/2-height/2)**2 : Infinity;};
        results.sort((a,b)=>distance(a)-distance(b));
        if (results.length) return results[0].rawValue;
      } catch { native=null; /* Unsupported hardware must not disable the fallback. */ }
    }
    return fallback(source);
  };
}
