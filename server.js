const http=require("http"),fs=require("fs"),path=require("path"),QRCode=require("qrcode"),notifier=require("node-notifier");
const {Client,LocalAuth}=require("whatsapp-web.js");
const ROOT=__dirname,PUBLIC=path.join(ROOT,"public"),DATA=path.join(ROOT,"data.json"),SECRETS=path.join(ROOT,"secrets.json"),PORT=3000;

let cfg=JSON.parse(fs.readFileSync(DATA,"utf8"));
let secrets=JSON.parse(fs.readFileSync(SECRETS,"utf8"));
let status="starting",qrData=null,chatsCache=[],pending=new Map();

function save(){fs.writeFileSync(DATA,JSON.stringify(cfg,null,2),"utf8")}
function saveSecrets(){fs.writeFileSync(SECRETS,JSON.stringify(secrets,null,2),"utf8")}
function addHist(x){cfg.history.unshift({at:new Date().toISOString(),...x});cfg.history=cfg.history.slice(0,250);save()}
function addAlert(x){
  cfg.alerts.unshift({id:"a-"+Date.now()+"-"+Math.random().toString(16).slice(2),at:new Date().toISOString(),resolved:false,...x});
  cfg.alerts=cfg.alerts.slice(0,100);save();
}
function sendJson(res,code,obj){const b=Buffer.from(JSON.stringify(obj));res.writeHead(code,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","Content-Length":b.length});res.end(b)}
function parseBody(req){return new Promise((ok,no)=>{let s="";req.on("data",c=>s+=c);req.on("end",()=>{try{ok(s?JSON.parse(s):{})}catch(e){no(e)}});req.on("error",no)})}
function cancel(chatId,why){const p=pending.get(chatId);if(!p)return;clearTimeout(p.timer);pending.delete(chatId);addHist({type:"cancelled",chatId,text:p.preview||"",note:why})}

function requiresHumanLocally(text){
  const t=String(text||"").toLowerCase().trim();
  const patterns=[
    /\b\d{1,2}[:.]\d{2}\b/,
    /\b\d{1,2}\s*uhr\b/,
    /\bwann\b/,
    /\btreffen\b/,
    /\bverabred/,
    /\btermin\b/,
    /\bzeit\s*(hast|haben|hätt|passt|finden)/,
    /\b(hast|hättest|habt)\s+du\s+(morgen|heute|übermorgen|am\s+\w+)?\s*zeit\b/,
    /\bkommst\s+du\b/,
    /\b(kannst|könntest)\s+du\s+um\b/,
    /\bsehen\s+wir\s+uns\b/,
    /\bwir\s+uns\s+(morgen|heute|übermorgen)\b/,
    /\b(abholen|vorbeikommen|vorbei kommen)\b.*\b(wann|uhr|heute|morgen|zeit)\b/,
    /\b(heute|morgen|übermorgen)\s+(abend|früh|mittag|nachmittag)\b.*\b(treffen|kommen|sehen|zeit)\b/
  ];
  return patterns.some(r=>r.test(t));
}

const SYSTEM_PROMPT=`Du bist ein Auto-Antwort-Assistent für einen privaten WhatsApp-Chat.
Deine Aufgabe ist, natürlich, kurz und passend auf normale eingehende Nachrichten zu antworten.

HARTE REGEL:
Sobald die Nachricht eine Uhrzeit, einen Termin, ein Treffen, eine Verabredung, eine konkrete zeitliche Zusage,
eine Frage nach Verfügbarkeit oder die Bitte enthält, einen Zeitpunkt festzulegen oder zu bestätigen,
musst du action="human_required" wählen. Du darfst dann KEINE Zusage, Absage, Uhrzeit, Terminentscheidung
oder Verfügbarkeitsaussage formulieren.

Weitere Regeln:
- Erfinde keine Fakten über den Nutzer.
- Keine verbindlichen Zusagen im Namen des Nutzers.
- Bei wichtigen Entscheidungen, Geld, Verträgen, Notfällen oder unklaren sensiblen Themen ebenfalls human_required.
- Bei normalen Smalltalk-, Status-, Dankes-, Alltags- oder einfachen Informationsnachrichten darfst du reply wählen.
- Antworte auf Deutsch, wenn die andere Person Deutsch schreibt.
- Halte Antworten WhatsApp-typisch und eher kurz.
- Verwende Emojis sparsam.
- Beziehe den jüngsten Chatverlauf ein, aber behaupte nichts, was daraus nicht hervorgeht.`;

async function classifyAndDraft(chat,msg){
  if(requiresHumanLocally(msg.body)){
    return {action:"human_required",reason:"Uhrzeit/Treffen/Termin lokal erkannt",reply:""};
  }
  if(!cfg.aiEnabled) return {action:"human_required",reason:"KI ist deaktiviert",reply:""};
  if(!secrets.openaiApiKey) return {action:"human_required",reason:"OpenAI API-Key fehlt",reply:""};

  let history=[];
  try{
    const msgs=await chat.fetchMessages({limit:Math.max(4,Math.min(20,Number(cfg.historyMessages||10)))});
    history=msgs.filter(m=>m.type==="chat"&&m.body).slice(-Math.max(4,Math.min(20,Number(cfg.historyMessages||10)))).map(m=>({
      speaker:m.fromMe?"ICH":"PERSON",
      text:m.body
    }));
  }catch{}

  const style=cfg.chatStyles[chat.id._serialized]||"Natürlich, freundlich und kurz.";
  const userPayload=[
    `Stil für diesen Chat: ${style}`,
    "Letzter Chatverlauf:",
    ...history.map(x=>`${x.speaker}: ${x.text}`),
    `NEUE NACHRICHT: ${msg.body}`
  ].join("\n");

  const schema={
    type:"object",
    additionalProperties:false,
    properties:{
      action:{type:"string",enum:["reply","human_required"]},
      reason:{type:"string"},
      reply:{type:"string"}
    },
    required:["action","reason","reply"]
  };

  const response=await fetch("https://api.openai.com/v1/responses",{
    method:"POST",
    headers:{
      "Authorization":"Bearer "+secrets.openaiApiKey,
      "Content-Type":"application/json"
    },
    body:JSON.stringify({
      model:cfg.aiModel||"gpt-5.6",
      input:[
        {role:"system",content:SYSTEM_PROMPT},
        {role:"user",content:userPayload}
      ],
      text:{
        format:{
          type:"json_schema",
          name:"whatsapp_reply_decision",
          strict:true,
          schema
        }
      }
    })
  });

  const raw=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(raw?.error?.message||("OpenAI API Fehler "+response.status));
  const parsed=JSON.parse(raw.output_text||"{}");
  if(parsed.action==="reply" && requiresHumanLocally(parsed.reply||"")){
    return {action:"human_required",reason:"Entwurf enthielt Zeit-/Treffen-Bezug",reply:""};
  }
  return parsed;
}

function notifyHuman(chatName,message,reason){
  if(cfg.humanMode!=="notify")return;
  notifier.notify({
    title:"WhatsApp: Mensch muss antworten",
    message:`${chatName}: ${message}`.slice(0,220),
    sound:true,
    wait:false
  });
}

const client=new Client({
  authStrategy:new LocalAuth({clientId:"auto-reply-v3-ai",dataPath:path.join(ROOT,".wwebjs_auth")}),
  puppeteer:{headless:true,args:["--no-sandbox","--disable-setuid-sandbox"]}
});

client.on("qr",async qr=>{status="qr";qrData=await QRCode.toDataURL(qr,{width:320,margin:2})});
client.on("authenticated",()=>{status="authenticated";qrData=null});
client.on("ready",async()=>{status="ready";qrData=null;await refreshChats()});
client.on("auth_failure",()=>status="auth_failure");
client.on("disconnected",()=>{status="disconnected";qrData=null;for(const p of pending.values())clearTimeout(p.timer);pending.clear()});

async function refreshChats(){
  if(status!=="ready")return chatsCache;
  const chats=await client.getChats();
  chatsCache=chats.filter(c=>!c.isGroup&&c.id?._serialized!=="status@broadcast").map(c=>({
    id:c.id._serialized,name:c.name||c.id.user||"Unbekannt",
    lastMessage:c.lastMessage?.body||"",timestamp:c.timestamp||0
  })).sort((a,b)=>b.timestamp-a.timestamp);
  return chatsCache;
}

client.on("message_create",async msg=>{
  if(!msg.fromMe)return;
  try{
    const chat=await msg.getChat(),id=chat.id._serialized;
    cancel(id,"du hast selbst geantwortet");
    for(const a of cfg.alerts)if(a.chatId===id&&!a.resolved)a.resolved=true;
    save();
    addHist({type:"manual_out",chatId:id,name:chat.name||chat.id.user,text:msg.body||""});
  }catch{}
});

client.on("message",async msg=>{
  try{
    if(!cfg.globalEnabled||msg.fromMe||msg.from==="status@broadcast"||msg.type!=="chat")return;
    const chat=await msg.getChat(); if(chat.isGroup)return;
    const id=chat.id._serialized;
    if(!Object.prototype.hasOwnProperty.call(cfg.enabledChats,id)||!cfg.enabledChats[id])return;

    addHist({type:"incoming",chatId:id,name:chat.name||chat.id.user,text:msg.body||""});
    cancel(id,"neuere Nachricht eingegangen");

    const timer=setTimeout(async()=>{
      pending.delete(id);
      try{
        const decision=await classifyAndDraft(chat,msg);
        if(decision.action==="human_required"){
          addAlert({chatId:id,name:chat.name||chat.id.user,message:msg.body||"",reason:decision.reason||"Mensch erforderlich"});
          notifyHuman(chat.name||chat.id.user,msg.body||"",decision.reason||"");
          addHist({type:"human_required",chatId:id,name:chat.name||chat.id.user,text:msg.body||"",note:decision.reason||""});
          return;
        }

        const reply=String(decision.reply||"").trim();
        if(!reply){
          addAlert({chatId:id,name:chat.name||chat.id.user,message:msg.body||"",reason:"KI lieferte keine sichere Antwort"});
          notifyHuman(chat.name||chat.id.user,msg.body||"","Keine sichere KI-Antwort");
          return;
        }

        await client.sendMessage(id,reply);
        addHist({type:"ai_out",chatId:id,name:chat.name||chat.id.user,text:reply,note:decision.reason||""});
      }catch(e){
        addAlert({chatId:id,name:chat.name||chat.id.user,message:msg.body||"",reason:"KI-Fehler: "+e.message});
        notifyHuman(chat.name||chat.id.user,msg.body||"","KI-Fehler");
        addHist({type:"error",chatId:id,name:chat.name||chat.id.user,text:e.message});
      }
    },Math.max(0,Number(cfg.delaySeconds||300))*1000);

    pending.set(id,{timer,preview:msg.body||""});
  }catch(e){}
});

client.initialize().catch(()=>status="error");

const server=http.createServer(async(req,res)=>{
  try{
    const u=new URL(req.url,"http://localhost");

    if(req.method==="GET"&&u.pathname==="/api/status")
      return sendJson(res,200,{status,qrData,globalEnabled:cfg.globalEnabled,pending:pending.size,aiConfigured:!!secrets.openaiApiKey});

    if(req.method==="GET"&&u.pathname==="/api/config"){
      return sendJson(res,200,{...cfg,apiKeyConfigured:!!secrets.openaiApiKey});
    }

    if(req.method==="GET"&&u.pathname==="/api/chats")return sendJson(res,200,await refreshChats());

    if(req.method==="POST"&&u.pathname==="/api/register"){
      const cs=await refreshChats();
      for(const c of cs){
        if(!(c.id in cfg.enabledChats))cfg.enabledChats[c.id]=false;
        if(!(c.id in cfg.chatStyles))cfg.chatStyles[c.id]="Natürlich, freundlich und kurz.";
      }
      save(); return sendJson(res,200,{ok:true,count:cs.length});
    }

    if(req.method==="PUT"&&u.pathname==="/api/config"){
      const b=await parseBody(req);
      cfg.globalEnabled=!!b.globalEnabled;
      cfg.delaySeconds=Math.max(0,Math.min(3600,Number(b.delaySeconds??300)));
      cfg.aiEnabled=b.aiEnabled!==false;
      cfg.aiModel=String(b.aiModel||"gpt-5.6");
      cfg.historyMessages=Math.max(4,Math.min(20,Number(b.historyMessages||10)));
      cfg.humanMode=b.humanMode==="wait"?"wait":"notify";
      cfg.enabledChats=b.enabledChats||cfg.enabledChats;
      cfg.chatStyles=b.chatStyles||cfg.chatStyles;
      save();
      return sendJson(res,200,{ok:true});
    }

    if(req.method==="PUT"&&u.pathname==="/api/api-key"){
      const b=await parseBody(req);
      if(typeof b.apiKey==="string" && b.apiKey.trim())secrets.openaiApiKey=b.apiKey.trim();
      if(b.clear===true)secrets.openaiApiKey="";
      saveSecrets();
      return sendJson(res,200,{ok:true,configured:!!secrets.openaiApiKey});
    }

    if(req.method==="POST"&&u.pathname==="/api/resolve-alert"){
      const b=await parseBody(req);
      const a=cfg.alerts.find(x=>x.id===b.id);
      if(a)a.resolved=true;
      save();return sendJson(res,200,{ok:true});
    }

    if(req.method==="POST"&&u.pathname==="/api/cancel-all"){
      for(const p of pending.values())clearTimeout(p.timer);pending.clear();return sendJson(res,200,{ok:true});
    }

    if(req.method==="POST"&&u.pathname==="/api/logout"){
      for(const p of pending.values())clearTimeout(p.timer);pending.clear();
      try{await client.logout()}catch{}
      status="logged_out";qrData=null;return sendJson(res,200,{ok:true});
    }

    let rel=u.pathname==="/"?"index.html":u.pathname.replace(/^\/+/,"");
    const file=path.join(PUBLIC,rel);
    if(!file.startsWith(PUBLIC)||!fs.existsSync(file)){res.writeHead(404);return res.end("Not found")}
    const ext=path.extname(file),types={".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"application/javascript; charset=utf-8"};
    res.writeHead(200,{"Content-Type":types[ext]||"application/octet-stream"});
    fs.createReadStream(file).pipe(res);
  }catch(e){sendJson(res,500,{error:e.message})}
});
server.listen(PORT,()=>console.log("WhatsApp Auto Reply v3 KI: http://localhost:"+PORT));
