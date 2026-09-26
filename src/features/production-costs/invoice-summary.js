export function invoiceReferences(invoices=[]){return [...new Set(invoices.map(x=>`${x.document?.sigla||'FT'} ${x.document?.serie}/${x.document?.numero}`))];}
export function groupedInvoices(invoices=[]){
 const groups=new Map();
 for(const x of invoices){const d=x.document||{},key=d.id||`${d.sigla}/${d.serie}/${d.numero}/${d.data_documento}`;
 if(!groups.has(key))groups.set(key,{id:key,document:d,lines:[],amount:null,invoiceQuantity:null});
 groups.get(key).lines.push(x);
 }
 return [...groups.values()].map(g=>({...g,amount:g.lines.some(x=>x.amount!=null)?g.lines.reduce((s,x)=>s+(x.amount??0),0):null,lineCount:g.lines.length}));
}
