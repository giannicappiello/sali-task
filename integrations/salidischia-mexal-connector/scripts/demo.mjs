import { mkdir, writeFile } from 'node:fs/promises';
import { prepareOrder, documentPayload } from '../src/order.mjs';
import { exampleOrder, options, config } from '../test/fixtures.mjs';
const plan=prepareOrder(exampleOrder(),options);
const document=documentPayload(plan,'501.TEST',config);
await mkdir('output',{recursive:true});
await writeFile('output/demo-ordine-13729.json',JSON.stringify({mode:'demo-sintetica',plan,document},null,2));
console.log(JSON.stringify({mode:'demo-sintetica',products:plan.lines.length,shipping:plan.shippingCents/100,tax:plan.taxCents/100,total:plan.totalCents/100,causale:plan.causale,lineStatus:'E',path:'output/demo-ordine-13729.json'}));
