export const SHEET_EXPORT_DPI = 300;
// Canvas JPEGs default to a 96-dpi JFIF header. Store the actual print density.
export function jpegWithDpi(input, dpi = SHEET_EXPORT_DPI) {
  const bytes = new Uint8Array(input);
  if (bytes[0] !== 255 || bytes[1] !== 216) throw new Error('JPEG non valido.');
  if (!Number.isInteger(dpi) || dpi < 1 || dpi > 65535) throw new Error('Risoluzione JPEG non valida.');
  for (let offset = 2; offset + 4 <= bytes.length && bytes[offset] === 255;) {
    const marker = bytes[offset + 1];
    if (marker === 218 || marker === 217) break;
    const length = bytes[offset + 2] * 256 + bytes[offset + 3];
    if (length < 2 || offset + 2 + length > bytes.length) break;
    if (marker === 224 && length >= 16 && bytes[offset+4] === 74 && bytes[offset+5] === 70 && bytes[offset+6] === 73 && bytes[offset+7] === 70 && bytes[offset+8] === 0) {
      bytes[offset+11] = 1; bytes[offset+12] = dpi >> 8; bytes[offset+13] = dpi & 255; bytes[offset+14] = dpi >> 8; bytes[offset+15] = dpi & 255;
      return bytes;
    }
    offset += length + 2;
  }
  const header = new Uint8Array([255,224,0,16,74,70,73,70,0,1,1,1,dpi>>8,dpi&255,dpi>>8,dpi&255,0,0]);
  const output = new Uint8Array(bytes.length + header.length);output.set(bytes.subarray(0,2));output.set(header,2);output.set(bytes.subarray(2),20);return output;
}
