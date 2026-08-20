import WebSocket from 'ws';

const API_BASE=String(process.env.FALIX_API_BASE||'https://client.falixnodes.net/api/v2').replace(/\/$/,'');
const API_KEY=String(process.env.FALIX_API_KEY||'').trim();
const SERVER_ID=String(process.env.FALIX_SERVER_ID||'').trim();
const SERVER_NAME=String(process.env.FALIX_SERVER_NAME||'Motion Roleplay').trim();

let ws=null, authed=false, resolvedId='', reconnectTimer=null, status='offline';
let onLine=()=>{};

async function api(path,opt={}){
  if(!API_KEY)throw new Error('FALIX_API_KEY is not configured');
  const r=await fetch(API_BASE+path,{...opt,headers:{Authorization:`Bearer ${API_KEY}`,'Content-Type':'application/json',...(opt.headers||{})}});
  const t=await r.text(); let j={}; try{j=t?JSON.parse(t):{}}catch{j={raw:t}};
  if(!r.ok)throw new Error(`Falix API ${r.status}: ${j.message||j.error?.message||t||r.statusText}`);
  return j;
}

async function resolveId(){
  if(SERVER_ID)return SERVER_ID; if(resolvedId)return resolvedId;
  const j=await api('/servers?limit=100'); const arr=Array.isArray(j.data)?j.data:Array.isArray(j)?j:[];
  const want=SERVER_NAME.toLowerCase(); const hit=arr.find(x=>String(x.name??x.display_name??'').toLowerCase()===want)||(arr.length===1?arr[0]:null);
  if(!hit)throw new Error(`Falix server '${SERVER_NAME}' not found. Set FALIX_SERVER_ID if needed.`);
  resolvedId=String(hit.id??hit.server_id??hit.uuid??''); if(!resolvedId)throw new Error('Falix server object has no id');
  console.log(`[MYAI] Falix target: ${hit.name||SERVER_NAME} (${resolvedId})`); return resolvedId;
}

async function token(){
  const id=await resolveId(); const j=await api(`/servers/${encodeURIComponent(id)}/console/token`,{method:'POST',body:'{}'}); const d=j.data||j;
  if(!d.socket||!d.token)throw new Error('Falix console token response missing socket/token'); return d;
}

function schedule(ms=5000){ if(reconnectTimer)return; reconnectTimer=setTimeout(()=>{reconnectTimer=null;connect().catch(e=>{console.error('[MYAI] Falix reconnect:',e.message);schedule(Math.min(ms*2,30000));});},ms); }
async function refresh(){const d=await token();if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify({event:'auth',args:[d.token]}));}

export async function connect(lineHandler){
  onLine=lineHandler||onLine; if(!API_KEY)throw new Error('FALIX_API_KEY is required');
  const d=await token(); if(ws)try{ws.close()}catch{}; authed=false; status='connecting';
  ws=new WebSocket(d.socket,{headers:{'User-Agent':'MYAI-Voice-Bridge/0.6.2'}});
  ws.on('open',()=>ws.send(JSON.stringify({event:'auth',args:[d.token]})));
  ws.on('message',raw=>{let m;try{m=JSON.parse(String(raw))}catch{return}const ev=String(m.event||''),a=Array.isArray(m.args)?m.args:[];
    if(ev==='auth success'){authed=true;status='online';console.log('[MYAI] Falix console authenticated');ws.send(JSON.stringify({event:'send logs',args:[]}));ws.send(JSON.stringify({event:'send history',args:['','500']}));return;}
    if(ev==='console output'){if(a[0])onLine(String(a[0]));return;}
    if(ev==='history output'){try{const h=JSON.parse(String(a[0]||'{}'));for(const line of h.data||[])onLine(String(line));}catch{}return;}
    if(ev==='status'){status=String(a[0]||'unknown');return;}
    if(ev==='token expiring'||ev==='token expired'||ev==='jwt error'){authed=false;refresh().catch(()=>{});return;}
  });
  ws.on('close',()=>{authed=false;status='offline';schedule();}); ws.on('error',e=>console.error('[MYAI] Falix socket:',e.message)); return true;
}

export function sendCommand(cmd){
  const clean=String(cmd||'').replace(/^\//,''); if(!authed||ws?.readyState!==WebSocket.OPEN)return false;
  ws.send(JSON.stringify({event:'send command',args:[clean]})); return true;
}
export function connected(){return authed;}
export function falixStatus(){return status;}
