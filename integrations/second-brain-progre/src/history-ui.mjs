import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { parseHistory } from './history.mjs';
import { page } from './interactive.mjs';

export async function startHistoryImport(client, ttlMs = 1800000) {
  const owner=(await client.request({action:'catalog'})).identity.id;
  const secret=randomBytes(32).toString('hex'),nonce=randomBytes(16).toString('hex');
  let prepared=null,status='waiting',imported=0,error=null,cancelled=false;
  const run=async()=>{
    status='running';
    try {
      for(let i=0;i<prepared.entries.length;i+=20){
        if(cancelled){status='cancelled';return;}
        await client.request({action:'import_history',expectedUserId:owner,entries:prepared.entries.slice(i,i+20)});
        imported=Math.min(i+20,prepared.entries.length);
      }
      status='completed';prepared=null;
    }catch{status='failed';error='Importazione interrotta. Puoi reimportare lo stesso file: le fonti gia salvate non vengono duplicate.';}
  };
  const server=createServer(async(req,res)=>{
    const origin=`http://127.0.0.1:${server.address().port}`,url=new URL(req.url,origin);
    res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',`default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'`);
    if(req.headers.host!==`127.0.0.1:${server.address().port}`||url.pathname!==`/${secret}`){res.writeHead(404);res.end();return;}
    if(req.method==='GET'&&url.searchParams.has('status')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status,imported,total:prepared?.entries.length, error}));return;}
    if(req.method==='GET'){
      const html=`<p>Seleziona un’esportazione JSON di ChatGPT o un archivio JSONL di conversazioni. Verranno importati solo testi utente/assistente, nella tua memoria personale.</p><p>Le chiavi riconoscibili vengono oscurate. Controlla l’anteprima prima di importare. Le chat originali restano intatte.</p><input type="file" id="file" accept=".json,.jsonl"><button id="preview">Prepara anteprima</button><pre id="summary"></pre><details><summary>Contenuto da importare</summary><pre id="contents"></pre></details><button id="confirm" disabled>Confermo l’importazione nella mia memoria personale</button><p id="state"></p><script nonce="${nonce}">
const q=id=>document.getElementById(id),endpoint=location.pathname;
q('preview').onclick=async()=>{try{q('confirm').disabled=true;const f=q('file').files[0];if(!f)throw Error('Seleziona un file');if(f.size>25000000)throw Error('Massimo 25 MB');const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phase:'preview',filename:f.name,text:await f.text()})});const d=await r.json();if(!r.ok)throw Error(d.error);q('summary').textContent=JSON.stringify(d.summary,null,2);q('contents').textContent=d.preview;q('confirm').disabled=false;}catch(e){q('state').textContent=e.message;}};
q('confirm').onclick=async()=>{q('confirm').disabled=true;q('preview').disabled=true;const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phase:'confirm'})});if(!r.ok){q('state').textContent='Importazione non avviata';return;}const timer=setInterval(async()=>{const d=await(await fetch(endpoint+'?status=1')).json();q('state').textContent=d.status+' — frammenti importati: '+d.imported+(d.error?' — '+d.error:'');if(['completed','failed','expired'].includes(d.status))clearInterval(timer);},1500);};
</script>`;
      res.setHeader('Content-Type','text/html; charset=utf-8');res.end(page('Importa chat — Second Brain Progre',html,nonce));return;
    }
    if(req.method!=='POST'||req.headers.origin!==origin||!String(req.headers['content-type']).startsWith('application/json')){res.writeHead(403);res.end();return;}
    res.setHeader('Content-Type','application/json');
    try {
      let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>30000000)throw Error('Archivio troppo grande');}
      const body=JSON.parse(raw);
      if(body.phase==='preview'&&['waiting','preview'].includes(status)){
        prepared=parseHistory(body.text,body.filename);status='preview';
        // The browser can inspect the complete sanitized content before consenting.
        res.end(JSON.stringify({summary:prepared.summary,preview:prepared.entries.map(e=>e.title+'\n'+e.content).join('\n\n---\n\n')}));return;
      }
      if(body.phase==='confirm'&&status==='preview'&&prepared?.entries.length){status='running';res.writeHead(202);res.end(JSON.stringify({started:true}));void run();return;}
      throw Error('Importazione non pronta o gia avviata');
    }catch(failure){res.writeHead(400);res.end(JSON.stringify({error:failure.message}));}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const timer=setTimeout(()=>{if(status!=='running'){status=status==='completed'?'completed':'expired';server.close();}},ttlMs);timer.unref();
  return {url:`http://127.0.0.1:${server.address().port}/${secret}`,getStatus:()=>({type:'history-import',status,imported,error}),close:()=>{cancelled=true;clearTimeout(timer);server.close();}};
}
