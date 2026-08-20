import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {connect as connectFalix,sendCommand,connected,falixStatus} from './lib/falix.mjs';
import {capabilities,think,transcribe} from './lib/ai.mjs';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const PORT=Number(process.env.PORT||8787), VERSION='0.6.2';
const REQUIRE_PAIR=String(process.env.MYAI_REQUIRE_PAIR??'true').toLowerCase()!=='false';
const SESSION_HOURS=Math.max(1,Math.min(720,Number(process.env.MYAI_SESSION_HOURS||168)));
const state={version:VERSION,npcs:[],players:[],globalSettings:{},phase:'',lastUpdate:0};
const pairCodes=new Map(),sessions=new Map(),waiting=new Map();
let lineBuf='';

const b64e=x=>Buffer.from(String(x),'utf8').toString('base64');
const b64d=x=>Buffer.from(String(x),'base64').toString('utf8');
function cmd(x){return sendCommand(String(x).replace(/^\//,''));}
function gameEvent(id,obj){return cmd(`scriptevent ${id} ${b64e(JSON.stringify(obj))}`);}
function safeJson64(x){try{return JSON.parse(b64d(x))}catch{return null}}

function parseLine(raw){
  const lines=String(raw).split(/\r?\n/); for(const line of lines){const s=line.trim();if(!s)continue;let m;
    if((m=s.match(/\[MYAI_STATE\]\s+([A-Za-z0-9+/=]+)/))){const x=safeJson64(m[1]);if(x)Object.assign(state,x,{lastUpdate:Date.now()});continue;}
    if((m=s.match(/\[MYAI_PAIR\]\s+([A-Za-z0-9+/=]+)/))){const q=safeJson64(m[1]);if(q?.kind==='pair'&&/^\d{6}$/.test(String(q.code||''))){pairCodes.set(String(q.code),{playerName:String(q.playerName||''),expires:Date.now()+Math.max(60,Math.min(600,Number(q.ttlSeconds||300)))*1000});console.log(`[MYAI] Pair code received for ${q.playerName}`);}continue;}
    if((m=s.match(/\[MYAI_BRIDGE\]\s+([A-Za-z0-9+/=]+)/))){const q=safeJson64(m[1]);if(q?.kind==='request')handleGameRequest(q).catch(e=>console.error('[MYAI] request:',e.message));continue;}
  }
}

function defaultDecision(msg){return {say:`AI provider error: ${String(msg||'unknown').slice(0,160)}`,intent:'NONE',args:{count:null,resource:null,tool:null,buildType:null},mood:'concerned',goal:'wait for AI connection',memory:null,memoryImportance:1,memoryCategory:'system',memoryTags:[],trustDelta:0,needsDelta:{hunger:0,energy:0,social:0,morale:0},__provider:'error',__model:''};}
async function handleGameRequest(q){
  let ans;try{ans=await think(String(q.text||''),q.snapshot||{});}catch(e){ans=defaultDecision(e.message)}
  const payload={requestId:q.requestId,playerName:q.snapshot?.player?.name||'',npcUid:q.snapshot?.npc?.uid||'',...ans};
  gameEvent('myai:bridge_response',payload);
  if(q.clientRequestId&&waiting.has(q.clientRequestId)){const w=waiting.get(q.clientRequestId);waiting.delete(q.clientRequestId);clearTimeout(w.timer);w.resolve({ans,q});}
}
function waitContext(id,ms=35000){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{waiting.delete(id);reject(new Error('Timed out waiting for MYAI game context. Make sure MYAI v0.6.1 VoiceFix or newer is installed.'));},ms);waiting.set(id,{resolve,reject,timer});});}
function compact(playerName,npcUid){const npc=state.npcs.find(n=>n.uid===npcUid)||state.npcs.find(n=>n.ownerName===playerName)||state.npcs[0]||null;const player=state.players.find(p=>p.name===playerName)||state.players[0]||null;return {version:state.version,player,npc,globalSettings:state.globalSettings||{},phase:state.phase||''};}

function auth(req){const h=String(req.headers.authorization||'');const tok=h.startsWith('Bearer ')?h.slice(7).trim():'';const s=sessions.get(tok);if(s&&s.expires>Date.now())return {token:tok,...s};if(!REQUIRE_PAIR)return {playerName:String(req.headers['x-player']||'')};return null;}
function headers(extra={}){return {'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Permissions-Policy':'microphone=(self)',...extra};}
function json(res,obj,status=200){const b=Buffer.from(JSON.stringify(obj));res.writeHead(status,headers({'Content-Type':'application/json; charset=utf-8','Content-Length':b.length}));res.end(b);}
async function body(req,limit=12*1024*1024){return await new Promise((resolve,reject)=>{const a=[];let n=0;req.on('data',c=>{n+=c.length;if(n>limit){reject(new Error('Request too large'));req.destroy();}else a.push(c)});req.on('end',()=>resolve(Buffer.concat(a)));req.on('error',reject)});}
async function jbody(req){const b=await body(req,128*1024);return JSON.parse(b.toString('utf8')||'{}');}
function requireAuth(req,res){const a=auth(req);if(a)return a;json(res,{error:'Not paired. Generate a code in Minecraft: MYAI Settings Tablet → Mobile Voice / Cloud.'},401);return null;}

async function runThroughGame(playerName,npcUid,text,eventId){
  if(!connected())throw new Error('Falix console is not connected yet.');
  if(!playerName)throw new Error('Pairing has no Minecraft player name. Generate a new pair code.');
  if(!npcUid)throw new Error('Choose an MYAI NPC first.');
  const clientRequestId='m-'+crypto.randomUUID(),wait=waitContext(clientRequestId);
  gameEvent(eventId,{clientRequestId,playerName,npcUid,text:String(text).trim()});
  return await wait;
}

const publicDir=path.join(__dirname,'public');
function staticFile(name,type){const f=path.join(publicDir,name);return fs.existsSync(f)?{buf:fs.readFileSync(f),type}:null;}
const page=staticFile('index.html','text/html; charset=utf-8'),manifest=staticFile('manifest.webmanifest','application/manifest+json'),icon=staticFile('icon.svg','image/svg+xml');

async function handler(req,res){
  try{const u=new URL(req.url,'http://localhost');
    if(req.method==='GET'&&u.pathname==='/'){res.writeHead(200,headers({'Content-Type':page.type}));res.end(page.buf);return;}
    if(req.method==='GET'&&u.pathname==='/manifest.webmanifest'&&manifest){res.writeHead(200,headers({'Content-Type':manifest.type}));res.end(manifest.buf);return;}
    if(req.method==='GET'&&u.pathname==='/icon.svg'&&icon){res.writeHead(200,headers({'Content-Type':icon.type,'Cache-Control':'public,max-age=86400'}));res.end(icon.buf);return;}
    if(req.method==='GET'&&u.pathname==='/api/config'){json(res,{version:VERSION,pairRequired:REQUIRE_PAIR,bdsConnected:connected(),falixStatus:falixStatus(),providers:capabilities()});return;}
    if(req.method==='POST'&&u.pathname==='/api/pair'){const d=await jbody(req),code=String(d.code||'').trim(),q=pairCodes.get(code);if(!q||q.expires<Date.now()){json(res,{error:'Pair code invalid/expired. Generate a new one inside Minecraft.'},401);return;}pairCodes.delete(code);const token=crypto.randomBytes(32).toString('base64url');sessions.set(token,{playerName:q.playerName,expires:Date.now()+SESSION_HOURS*3600000});json(res,{token,playerName:q.playerName,version:VERSION});return;}
    if(req.method==='GET'&&u.pathname==='/api/state'){const a=requireAuth(req,res);if(!a)return;const npcs=(state.npcs||[]).filter(n=>!n.ownerName||n.ownerName===a.playerName);json(res,{...state,npcs,players:(state.players||[]).filter(p=>!a.playerName||p.name===a.playerName),bdsConnected:connected(),falixStatus:falixStatus(),aiConfigured:capabilities().brain.some(x=>x.configured),providers:capabilities(),sessionPlayer:a.playerName});return;}
    if(req.method==='POST'&&u.pathname==='/api/text'){const a=requireAuth(req,res);if(!a)return;const d=await jbody(req),text=String(d.text||'').trim(),npcUid=String(d.npcUid||'');if(!text)throw new Error('Message is empty');const {ans}=await runThroughGame(a.playerName,npcUid,text,'myai:mobile_text');json(res,{reply:ans.say,mood:ans.mood,goal:ans.goal,intent:ans.intent,brainProvider:ans.__provider||'',brainModel:ans.__model||''});return;}
    if(req.method==='POST'&&u.pathname==='/api/voice'){const a=requireAuth(req,res);if(!a)return;const npcUid=String(req.headers['x-npc']||''),buf=await body(req),mime=String(req.headers['content-type']||'audio/webm');const text=(await transcribe(buf,mime,compact(a.playerName,npcUid))).trim();if(!text)throw new Error('No speech detected');const {ans}=await runThroughGame(a.playerName,npcUid,text,'myai:voice_text');json(res,{transcript:text,reply:ans.say,mood:ans.mood,goal:ans.goal,intent:ans.intent,brainProvider:ans.__provider||'',brainModel:ans.__model||'',ttsProvider:'browser'});return;}
    res.writeHead(404,headers());res.end('Not found');
  }catch(e){console.error('[MYAI]',e);json(res,{error:String(e.message||e)},500);}
}

connectFalix(parseLine).catch(e=>console.error('[MYAI] Falix initial connection:',e.message));
setInterval(()=>{if(connected()){cmd('scriptevent myai:bridge_ping 1');gameEvent('myai:bridge_caps',capabilities());}},5000);
setInterval(()=>{const now=Date.now();for(const [k,v] of pairCodes)if(v.expires<now)pairCodes.delete(k);for(const [k,v] of sessions)if(v.expires<now)sessions.delete(k);},60000);
http.createServer(handler).listen(PORT,'0.0.0.0',()=>console.log(`[MYAI ${VERSION}] Render Voice Bridge listening on :${PORT}`));
