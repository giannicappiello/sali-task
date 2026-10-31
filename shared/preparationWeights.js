import {assert} from './orderPreparation.js';

export function productWeightGrams(value) {
  const s=String(value??'').trim().replace(',','.');
  if(!/^\d+(?:\.\d{1,3})?$/.test(s))return null;
  const n=Number(s);
  return n>0 && n<=1000000 ? n : null;
}
export function tareWeightKg(value,label='Tara') {
  if(value==null || String(value).trim()==='')return null;
  const s=String(value).trim().replace(',','.');
  assert(/^\d+(?:\.\d{1,3})?$/.test(s) && Number(s)<=10000,`${label}: inserisci Kg validi con al massimo tre decimali.`);
  return Number(s);
}

// Calculate in integer milligrams; count product mass once, box tare once per box,
// pallet tare once per pallet. FIFO splits must never multiply packaging weights.
export function packingWeights(summary, lines, settings) {
  const boxTare=tareWeightKg(settings.box_tare_kg,'Peso cartone'),palletTare=tareWeightKg(settings.pallet_tare_kg,'Peso pallet');
  assert(boxTare!==null && palletTare!==null,'Configura il peso del cartone e del pallet in Configurazione Allestisci Ordini prima del riscontro.');
  const weights=new Map(lines.map(line=>[line.code,productWeightGrams(line.unitWeightGrams)]));
  const mg=kg=>Math.round(kg*1000000),kg=value=>value/1000000;
  const packages=summary.packages.map(pack=>{
    const net=pack.contents.reduce((sum,row)=>{
      const unit=weights.get(row.code);
      assert(unit,`Peso Totale in grammi mancante nel capitolato di ${row.code}.`);
      return sum+Math.round(unit*1000)*row.quantity;
    },0);
    assert(Number.isSafeInteger(net),'Peso del collo fuori limite.');
    return {...pack,netWeightKg:kg(net),tareWeightKg:boxTare,grossWeightKg:kg(net+mg(boxTare))};
  });
  const pallets=summary.pallets.map(pallet=>{
    const children=packages.filter(pack=>pack.palletId===pallet.id);
    const net=children.reduce((sum,pack)=>sum+mg(pack.netWeightKg),0);
    const gross=children.reduce((sum,pack)=>sum+mg(pack.grossWeightKg),mg(palletTare));
    return {...pallet,netWeightKg:kg(net),tareWeightKg:palletTare,grossWeightKg:kg(gross)};
  });
  const net=packages.reduce((sum,pack)=>sum+mg(pack.netWeightKg),0);
  const gross=packages.reduce((sum,pack)=>sum+mg(pack.grossWeightKg),0)+pallets.length*mg(palletTare);
  assert(Number.isSafeInteger(gross),'Peso della spedizione fuori limite.');
  return {...summary,packages,pallets,weightTotals:{netWeightKg:kg(net),grossWeightKg:kg(gross),boxTareKg:boxTare,palletTareKg:palletTare},productWeights:[...weights].map(([code,unitWeightGrams])=>({code,unitWeightGrams}))};
}
