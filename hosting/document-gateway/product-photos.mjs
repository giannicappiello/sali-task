import { readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
export async function productPhotos(root) {
 const base=await realpath(root),directory=await realpath(path.join(base,'FotoProdotti'));
 if(!directory.startsWith(base+path.sep))throw new Error('Cartella foto non valida.');
 const entries=await readdir(directory,{withFileTypes:true}),photos=new Map();
 for(const entry of entries){
  if(!entry.isFile()||!/^((?:IT|MKT)[A-Z0-9_-]+)\.(?:png|jpe?g|webp)$/i.test(entry.name))continue;
  const code=path.parse(entry.name).name.toUpperCase();
  // Variants such as IT0001_1 are independent codes, never a fallback for IT0001.
  const file=await realpath(path.join(directory,entry.name));if(!file.startsWith(directory+path.sep))continue;
  const size=(await stat(file)).size,previous=photos.get(code);
  if(!previous||previous.size<size)photos.set(code,{code,path:'FotoProdotti/'+entry.name,size});
 }
 return [...photos.values()];
}
