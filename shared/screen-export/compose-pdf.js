
// Leave space for Base64, JSON and the server-applied letterhead in both directions.
export const PDF_COMPOSITION_BATCH_BYTES=2*1024*1024;
export async function composePdfBatches(sourceBytes,compose,{signal,progress=()=>{},maxBytes=PDF_COMPOSITION_BATCH_BYTES}={}) {
 const {PDFDocument}=await import('pdf-lib');
 const source=await PDFDocument.load(sourceBytes);
 const merged=await PDFDocument.create();
 let complete=0;
 async function visit(indices) {
  signal?.throwIfAborted();
  const piece=await PDFDocument.create();
  const pages=await piece.copyPages(source,indices);pages.forEach(page=>piece.addPage(page));
  const bytes=await piece.save();
  async function split() {
   const middle=Math.ceil(indices.length/2);
   await visit(indices.slice(0,middle));await visit(indices.slice(middle));
  }
  if(bytes.length>maxBytes&&indices.length>1)return split();
  progress('Composizione PDF · pagine '+(indices[0]+1)+'–'+(indices.at(-1)+1)+' di '+source.getPageCount()+'…');
  let result;
  try {result=await compose(bytes,indices[0]);}
  catch(error) {
   if(error.status===413&&indices.length>1)return split();
   if(error.status===413)throw new Error('La singola pagina '+(indices[0]+1)+' supera il limite di composizione PDF.',{cause:error});
   throw error;
  }
  signal?.throwIfAborted();
  const composed=await PDFDocument.load(result);
  if(composed.getPageCount()!==indices.length)throw new Error('Il compositore ha restituito un numero di pagine PDF non valido.');
  const done=await merged.copyPages(composed,composed.getPageIndices());done.forEach(page=>merged.addPage(page));
  complete+=done.length;
 }
 await visit(source.getPageIndices());
 if(complete!==source.getPageCount())throw new Error('Esportazione PDF incompleta.');
 return merged.save();
}
