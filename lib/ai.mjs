const env = process.env;

const MODELS = {
  openai: env.MYAI_OPENAI_MODEL || 'gpt-5.6-terra',
  gemini: env.MYAI_GEMINI_MODEL || 'gemini-3.6-flash',
  anthropic: env.MYAI_ANTHROPIC_MODEL || 'claude-sonnet-5',
  openrouter: env.MYAI_OPENROUTER_MODEL || 'openrouter/auto',
  deepseek: env.MYAI_DEEPSEEK_MODEL || 'deepseek-v4-flash',
};

const KEYS = {
  openai: env.OPENAI_API_KEY || '',
  gemini: env.GEMINI_API_KEY || '',
  anthropic: env.ANTHROPIC_API_KEY || '',
  openrouter: env.OPENROUTER_API_KEY || '',
  deepseek: env.DEEPSEEK_API_KEY || '',
};

const INTENTS = new Set(['NONE','FOLLOW','STAY','ROAM','PROTECT','GUARD','PASSIVE','COME','HOME','REST','EAT','FLEE','GATHER_WOOD','GATHER_STONE','GATHER_ORE','FARM','BUILD_SHELTER','CRAFT_TOOL','STORE_ITEMS','SURVIVAL_PREP','CANCEL_TASK','TASK_STATUS']);
const RESOURCES = new Set(['wood','stone','crops','coal','iron','copper','gold','redstone','lapis','diamond','emerald']);
const TOOLS = new Set(['wooden_pickaxe','stone_pickaxe','wooden_axe','stone_axe']);

export function capabilities(){
  return {
    version:'0.6.2',
    brain:Object.keys(KEYS).map(id=>({id,label:{openai:'OpenAI / ChatGPT',gemini:'Google Gemini',anthropic:'Anthropic Claude',openrouter:'OpenRouter',deepseek:'DeepSeek'}[id],configured:!!KEYS[id],defaultModel:MODELS[id]})),
    stt:[{id:'openai',label:'OpenAI STT',configured:!!KEYS.openai,defaultModel:env.MYAI_OPENAI_TRANSCRIBE_MODEL||'gpt-4o-mini-transcribe'},{id:'gemini',label:'Gemini STT',configured:!!KEYS.gemini,defaultModel:env.MYAI_GEMINI_TRANSCRIBE_MODEL||MODELS.gemini}],
    tts:[{id:'browser',label:'iPhone Browser Voice',configured:true,defaultModel:'speechSynthesis'}]
  };
}

function configured(){ return Object.keys(KEYS).filter(k=>KEYS[k]); }
function selected(snapshot={}){
  const g=snapshot.globalSettings||{}, n=snapshot.npc?.settings||{};
  return {provider:(n.aiProvider&&n.aiProvider!=='inherit'?n.aiProvider:g.aiProvider)||'auto',model:(n.aiModel||g.aiModel||'').trim(),fallback:g.aiFallback!==false,stt:g.sttProvider||'auto'};
}
function candidates(snapshot){
  const s=selected(snapshot), available=configured(), order=['openai','gemini','anthropic','openrouter','deepseek'];
  if(s.provider==='auto') return order.filter(x=>available.includes(x));
  const out=[s.provider]; if(s.fallback) for(const x of order) if(x!==s.provider&&available.includes(x)) out.push(x);
  return [...new Set(out)].filter(x=>available.includes(x));
}

async function fetchJson(url,opt){
  const r=await fetch(url,opt); const t=await r.text();
  if(!r.ok) throw new Error(`${r.status}: ${t.slice(0,500)}`);
  try{return JSON.parse(t)}catch{throw new Error('Provider returned invalid JSON');}
}
function extractJson(text){
  let t=String(text||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  const a=t.indexOf('{'), b=t.lastIndexOf('}'); if(a>=0&&b>a)t=t.slice(a,b+1);
  return JSON.parse(t);
}

const decisionSchema={type:'object',additionalProperties:false,properties:{say:{type:'string'},intent:{type:'string'},args:{type:'object'},mood:{type:'string'},goal:{type:'string'},memory:{type:['string','null']},memoryImportance:{type:'integer'},memoryCategory:{type:'string'},memoryTags:{type:'array',items:{type:'string'}},trustDelta:{type:'integer'},needsDelta:{type:'object'}},required:['say','intent','args','mood','goal','memory','memoryImportance','memoryCategory','memoryTags','trustDelta','needsDelta']};

function prompt(text,s){
  const n=s.npc||{};
  return `You are ${n.name||'MYAI'}, an embodied Minecraft Bedrock companion. Personality: ${n.personality||'friendly, curious, grounded'}. Mood: ${n.mood||'calm'}. Trust: ${n.trust??50}/100. Needs: ${JSON.stringify(n.needs||{})}. Goal: ${n.goal||'explore'}. Speak naturally in the same language as the player. You may disagree or refuse based on personality, trust, needs and context. Never claim an action is complete unless the game can actually execute it.\n\nAvailable intents: NONE, FOLLOW, STAY, ROAM, PROTECT, GUARD, PASSIVE, COME, HOME, REST, EAT, FLEE, GATHER_WOOD, GATHER_STONE, GATHER_ORE, FARM, BUILD_SHELTER, CRAFT_TOOL, STORE_ITEMS, SURVIVAL_PREP, CANCEL_TASK, TASK_STATUS. GATHER_ORE resources: coal, iron, copper, gold, redstone, lapis, diamond, emerald. CRAFT_TOOL: wooden_pickaxe, stone_pickaxe, wooden_axe, stone_axe.\n\nReturn ONLY JSON with keys: say, intent, args:{count,resource,tool,buildType}, mood, goal, memory, memoryImportance, memoryCategory, memoryTags, trustDelta, needsDelta:{hunger,energy,social,morale}. Keep replies usually 1-4 sentences.\n\nWorld snapshot: ${JSON.stringify(s).slice(0,14000)}\n\nPlayer says: ${text}`;
}

async function callProvider(id,input,modelOverride=''){
  const key=KEYS[id], model=modelOverride||MODELS[id];
  if(id==='openai'){
    const j=await fetchJson('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model,store:false,input,text:{format:{type:'json_schema',name:'myai_decision',strict:true,schema:decisionSchema}}})});
    const out=j.output_text||(j.output||[]).flatMap(x=>x.content||[]).map(x=>x.text||'').join(''); return {value:extractJson(out),model:j.model||model};
  }
  if(id==='gemini'){
    const url=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
    const j=await fetchJson(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents:[{parts:[{text:input}]}],generationConfig:{responseMimeType:'application/json'}})});
    return {value:extractJson(j.candidates?.[0]?.content?.parts?.map(x=>x.text||'').join('')||''),model};
  }
  if(id==='anthropic'){
    const j=await fetchJson('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'x-api-key':key,'anthropic-version':'2023-06-01','Content-Type':'application/json'},body:JSON.stringify({model,max_tokens:1200,messages:[{role:'user',content:input+'\nReturn only JSON.'}]})});
    return {value:extractJson((j.content||[]).map(x=>x.text||'').join('')),model:j.model||model};
  }
  const base=id==='openrouter'?'https://openrouter.ai/api/v1':'https://api.deepseek.com/v1';
  const headers={Authorization:`Bearer ${key}`,'Content-Type':'application/json'}; if(id==='openrouter'){headers['X-Title']='MYAI Minecraft Bedrock';headers['HTTP-Referer']='https://github.com/drmacze/MYAI-Voice-Bridge';}
  const j=await fetchJson(base+'/chat/completions',{method:'POST',headers,body:JSON.stringify({model,messages:[{role:'system',content:'Return only valid JSON. No markdown.'},{role:'user',content:input}],temperature:0.5,response_format:{type:'json_object'}})});
  return {value:extractJson(j.choices?.[0]?.message?.content||''),model:j.model||model};
}

function normalize(o){
  o=o&&typeof o==='object'?o:{}; const args=o.args&&typeof o.args==='object'?o.args:{};
  const intent=INTENTS.has(String(o.intent||'').toUpperCase())?String(o.intent).toUpperCase():'NONE';
  const resource=RESOURCES.has(args.resource)?args.resource:null, tool=TOOLS.has(args.tool)?args.tool:null;
  return {say:String(o.say||'').slice(0,1200),intent,args:{count:Number.isInteger(args.count)?Math.max(1,Math.min(64,args.count)):null,resource,tool,buildType:args.buildType==='shelter'?'shelter':null},mood:String(o.mood||'calm').slice(0,32),goal:String(o.goal||'').slice(0,64),memory:o.memory?String(o.memory).slice(0,500):null,memoryImportance:Math.max(1,Math.min(5,Number(o.memoryImportance)||1)),memoryCategory:String(o.memoryCategory||'conversation').slice(0,40),memoryTags:Array.isArray(o.memoryTags)?o.memoryTags.slice(0,8).map(x=>String(x).slice(0,40)):[],trustDelta:Math.max(-2,Math.min(2,Number(o.trustDelta)||0)),needsDelta:{hunger:Number(o.needsDelta?.hunger)||0,energy:Number(o.needsDelta?.energy)||0,social:Number(o.needsDelta?.social)||0,morale:Number(o.needsDelta?.morale)||0}};
}

export async function think(text,snapshot={}){
  const s=selected(snapshot), list=candidates(snapshot); if(!list.length)throw new Error('No AI provider configured. Add OPENAI_API_KEY, GEMINI_API_KEY, ANTHROPIC_API_KEY, OPENROUTER_API_KEY or DEEPSEEK_API_KEY in Render.');
  let last; for(const id of list){try{const r=await callProvider(id,prompt(text,snapshot),id===s.provider?s.model:'');return {...normalize(r.value),__provider:id,__model:r.model};}catch(e){last=e;console.error(`[MYAI] ${id}:`,e.message);if(!s.fallback&&s.provider!=='auto')break;}}
  throw last||new Error('All AI providers failed');
}

export async function transcribe(buf,mime='audio/webm',snapshot={}){
  const s=selected(snapshot), order=s.stt==='gemini'?['gemini','openai']:s.stt==='openai'?['openai','gemini']:['openai','gemini']; let last;
  for(const id of order){try{
    if(id==='openai'&&KEYS.openai){const form=new FormData();form.append('file',new Blob([buf],{type:mime}),mime.includes('mp4')?'voice.m4a':'voice.webm');form.append('model',env.MYAI_OPENAI_TRANSCRIBE_MODEL||'gpt-4o-mini-transcribe');const r=await fetch('https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers:{Authorization:`Bearer ${KEYS.openai}`},body:form});if(!r.ok)throw new Error(`OpenAI STT ${r.status}`);return String((await r.json()).text||'').trim();}
    if(id==='gemini'&&KEYS.gemini){const model=env.MYAI_GEMINI_TRANSCRIBE_MODEL||MODELS.gemini;const j=await fetchJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(KEYS.gemini)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents:[{parts:[{text:'Transcribe this speech accurately. Return only the spoken words.'},{inlineData:{mimeType:mime.split(';')[0]||'audio/webm',data:buf.toString('base64')}}]}]})});return String(j.candidates?.[0]?.content?.parts?.map(x=>x.text||'').join('')||'').trim();}
  }catch(e){last=e;}}
  throw last||new Error('No STT provider configured. OpenAI or Gemini is required for microphone input.');
}
