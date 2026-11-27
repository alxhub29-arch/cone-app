/* CŌNE autonome : remplace les services de claude.ai par des services locaux.
   Données : IndexedDB de l'appareil (rien n'est envoyé ailleurs).
   IA (scanner de plantes, lecture des tickets) : seulement si une clé Claude est saisie dans Réglages. */
(function(){
"use strict";
const DBN="cone-autonome",ST="kv",BL="blobs";
let idb=null;
function openIdb(){return new Promise((ok,ko)=>{const r=indexedDB.open(DBN,1);r.onupgradeneeded=()=>{const d=r.result;if(!d.objectStoreNames.contains(ST))d.createObjectStore(ST);if(!d.objectStoreNames.contains(BL))d.createObjectStore(BL)};r.onsuccess=()=>ok(r.result);r.onerror=()=>ko(r.error)})}
function tx(store,mode,fn){return new Promise((ok,ko)=>{const t=idb.transaction(store,mode);const s=t.objectStore(store);let res;const q=fn(s);if(q)q.onsuccess=()=>{res=q.result};t.oncomplete=()=>ok(res);t.onerror=()=>ko(t.error);t.onabort=()=>ko(t.error)})}
const kvGet=k=>tx(ST,"readonly",s=>s.get(k));
const kvSet=(k,v)=>tx(ST,"readwrite",s=>s.put(v,k));
const lsGet=k=>{try{return localStorage.getItem(k)}catch(e){return null}};
const lsSet=(k,v)=>{try{v==null?localStorage.removeItem(k):localStorage.setItem(k,v)}catch(e){}};

let mem={};const blobUrl=new Map();
let ready=null,sync=null;
async function init(){
  try{idb=await openIdb()}catch(e){idb=null}
  if(idb){try{mem=(await kvGet("mem"))||{}}catch(e){mem={}}}
  else{try{mem=JSON.parse(lsGet("cone-autonome")||"{}")}catch(e){mem={}}}
  if(idb){try{const keys=await tx(BL,"readonly",s=>s.getAllKeys());const vals=await tx(BL,"readonly",s=>s.getAll());(keys||[]).forEach((k,i)=>{if(vals[i])blobUrl.set(k,URL.createObjectURL(vals[i]))})}catch(e){}}
  try{if(navigator.storage&&navigator.storage.persist)navigator.storage.persist()}catch(e){}
}
let wT=null;
function persist(){clearTimeout(wT);wT=setTimeout(()=>{if(idb)kvSet("mem",mem).catch(e=>console.error("save",e));else lsSet("cone-autonome",JSON.stringify(mem))},150);lsSet("cone-dirty",String(Date.now()))}

/* ---- base de données (même interface que celle de claude.ai) ---- */
const colL={},docL={};
const clone=o=>o==null?o:JSON.parse(JSON.stringify(o));
function snapCol(path){const c=mem[path]||{};return{docs:Object.keys(c).map(id=>({id,data:()=>clone(c[id])}))}}
function snapDoc(path){const i=path.lastIndexOf("/");const col=path.slice(0,i),id=path.slice(i+1);const v=(mem[col]||{})[id];return{id,exists:v!==undefined,data:()=>clone(v)}}
function notify(col,id){(colL[col]||[]).forEach(cb=>{try{cb(snapCol(col))}catch(e){console.error(e)}});(docL[col+"/"+id]||[]).forEach(cb=>{try{cb(snapDoc(col+"/"+id))}catch(e){console.error(e)}})}
function docRef(col,id){return{
  async set(data){mem[col]=mem[col]||{};mem[col][id]=clone(data);persist();if(sync)sync.enqueue(col,id,clone(data),false);setTimeout(()=>notify(col,id));},
  async delete(){if(mem[col])delete mem[col][id];persist();if(sync)sync.enqueue(col,id,null,true);setTimeout(()=>notify(col,id));},
  async get(){return snapDoc(col+"/"+id)},
  onSnapshot(cb){const p=col+"/"+id;(docL[p]=docL[p]||[]).push(cb);setTimeout(()=>cb(snapDoc(p)));return()=>{docL[p]=docL[p].filter(x=>x!==cb)}}}}
const db={
  collection(col){return{doc:id=>docRef(col,id),onSnapshot(cb){(colL[col]=colL[col]||[]).push(cb);setTimeout(()=>cb(snapCol(col)));return()=>{colL[col]=colL[col].filter(x=>x!==cb)}}}},
  doc(path){const i=path.lastIndexOf("/");return docRef(path.slice(0,i),path.slice(i+1))}};

/* ---- photos ---- */
const rid=()=>{const a=new Uint8Array(16);crypto.getRandomValues(a);return Array.from(a,b=>b.toString(16).padStart(2,"0")).join("")};
const assets={
  async upload(blob){const id=rid();if(idb)await tx(BL,"readwrite",s=>s.put(blob,id));blobUrl.set(id,URL.createObjectURL(blob));if(sync)sync.enqueueBlob(id);return{id}},
  async delete(id){if(idb)await tx(BL,"readwrite",s=>s.delete(id));const u=blobUrl.get(id);if(u)URL.revokeObjectURL(u);blobUrl.delete(id);if(sync&&sync.role()==="patron")sync.delBlob(id)}};
const PIX="data:image/gif;base64,R0lGODlhAQABAAAAACw=";const enCours=new Set();
window.__bsrc=id=>{const u=blobUrl.get(id);if(u)return u;if(sync&&idb&&!enCours.has(id)){enCours.add(id);sync.getBlob(id).then(async b=>{await tx(BL,"readwrite",s=>s.put(b,id));const nu=URL.createObjectURL(b);blobUrl.set(id,nu);
  document.querySelectorAll('img[src="'+PIX+"#"+id+'"]').forEach(i=>{i.src=nu});document.querySelectorAll('a[href="'+PIX+"#"+id+'"]').forEach(a=>{a.href=nu})}).catch(()=>{}).finally(()=>setTimeout(()=>enCours.delete(id),30000))}
  return PIX+"#"+id};

/* ---- téléchargements (CSV, PDF) ---- */
const downloads={async save({filename,data}){
  const blob=data instanceof Blob?data:new Blob([data],{type:/\.csv$/i.test(filename)?"text/csv;charset=utf-8":"application/octet-stream"});
  return saveBlob(blob,filename)}};
async function saveBlob(blob,filename){
  try{const f=new File([blob],filename,{type:blob.type});if(navigator.canShare&&navigator.canShare({files:[f]})&&/iPhone|iPad|Android/i.test(navigator.userAgent)){await navigator.share({files:[f]});return}}catch(e){if(e&&e.name==="AbortError")return}
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),60000)}

/* ---- IA : Claude via la clé saisie dans Réglages (facultatif) ---- */
const KEY="cone-cle-claude",MODEL="claude-sonnet-5-5";
const cle=()=>lsGet(KEY)||"";
function b64(blob){return new Promise((ok,ko)=>{const r=new FileReader();r.onload=()=>ok(String(r.result).split(",")[1]);r.onerror=()=>ko(r.error);r.readAsDataURL(blob)})}
async function ask(prompt,opts){
  opts=opts||{};const content=[];
  for(const im of (opts.images||[])){content.push({type:"image",source:{type:"base64",media_type:im.type||"image/jpeg",data:await b64(im)}})}
  content.push({type:"text",text:prompt});
  let r;try{r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"content-type":"application/json","x-api-key":cle(),"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},body:JSON.stringify({model:MODEL,max_tokens:opts.maxTokens||4000,messages:[{role:"user",content}]})})}
  catch(e){const er=new Error("pas de réseau");er.code="network";throw er}
  if(!r.ok){const er=new Error("Claude "+r.status);er.code=r.status===401?"cle_invalide":r.status===429?"rate_limited":"erreur_"+r.status;throw er}
  const j=await r.json();return{text:(j.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("")}}
function sample(prompt,opts){return ask(prompt,opts)}
sample.json=async(prompt,opts)=>{const{text}=await ask(prompt+"\n\nRéponds uniquement avec le JSON, sans texte autour ni balises.",opts);const t=text.replace(/```(?:json)?/g,"");const a=t.indexOf("{"),b=t.lastIndexOf("}");const a2=t.indexOf("["),b2=t.lastIndexOf("]");
  try{if(a>=0&&b>a&&(a2<0||a<a2))return JSON.parse(t.slice(a,b+1));if(a2>=0&&b2>a2)return JSON.parse(t.slice(a2,b2+1));return JSON.parse(t)}catch(e){const er=new Error("réponse illisible");er.code="parse";throw er}};
sample.limits=async()=>({images:{maxCount:4,maxBytes:3500000}});

const user={async id(){return sync?sync.uid()||"moi":"moi"},async isOwner(){return sync?sync.role()==="patron":true}};

window.claude={async use(name){await ready;
  if(name==="db")return db;if(name==="assets")return idb?assets:null;if(name==="downloads")return downloads;if(name==="user")return user;
  if(name==="sample")return cle()?sample:null;return null}};

/* ---- sauvegarde / restauration ---- */
const nbDocs=()=>Object.entries(mem).filter(([k])=>k!=="config").reduce((s,[,v])=>s+Object.keys(v||{}).length,0);
async function exporter(){
  const blobs={};
  if(idb){const keys=await tx(BL,"readonly",s=>s.getAllKeys());for(const k of keys){const b=await tx(BL,"readonly",s=>s.get(k));if(b)blobs[k]="data:"+(b.type||"image/jpeg")+";base64,"+await b64(b)}}
  const out={app:"CONE",format:1,date:new Date().toISOString(),mem,blobs};
  const d=new Date();const nom="CONE-sauvegarde-"+d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")+".json";
  await saveBlob(new Blob([JSON.stringify(out)],{type:"application/json"}),nom);
  lsSet("cone-backup",String(Date.now()));
}
async function importer(file){
  let j;try{j=JSON.parse(await file.text())}catch(e){alertMsg("Ce fichier n'est pas une sauvegarde CŌNE.");return}
  if(!j||j.app!=="CONE"||!j.mem){alertMsg("Ce fichier n'est pas une sauvegarde CŌNE.");return}
  if(nbDocs()&&!confirm("Remplacer toutes les données de cet appareil par celles de la sauvegarde du "+new Date(j.date).toLocaleDateString("fr-BE")+" ?"))return;
  mem=j.mem;
  if(idb){await kvSet("mem",mem);await tx(BL,"readwrite",s=>s.clear());for(const[id,u]of Object.entries(j.blobs||{})){const b=await (await fetch(u)).blob();await tx(BL,"readwrite",s=>s.put(b,id))}}
  else lsSet("cone-autonome",JSON.stringify(mem));
  if(sync&&idb){const q={};Object.entries(mem).forEach(([col,docs])=>Object.keys(docs||{}).forEach(id=>{q[col+"\u0001"+id]={col,id,data:docs[id],deleted:false}}));await kvSet("queue",q);await kvSet("blobsUp",{})}
  lsSet("cone-backup",String(Date.now()));
  location.reload();
}
function alertMsg(t){const el=document.getElementById("toast");if(el){el.textContent=t;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),5000)}else alert(t)}

async function equipe(){const el=document.getElementById("sa-equipe");if(!el||!sync)return;
  try{const ms=(await sync.membres())||[];const autres=ms.filter(m=>m.role!=="patron");
    el.innerHTML=`<p class="small" style="margin-top:0">Vos ouvriers ouvrent <b>alxhub29-arch.github.io/cone-app</b>, touchent « Créer mon accès », puis vous les acceptez ici. Ils voient seulement leurs missions (sans prix) et envoient leurs rapports.</p>`+
    (autres.length?autres.map(m=>`<div class="row" style="padding:8px 0;border-top:1px solid var(--line)"><span style="flex:1;min-width:0"><b>${esc(m.nom||m.email)}</b><br><span class="small">${esc(m.email)} · ${m.role==="attente"?"⏳ en attente":"✅ ouvrier"}</span></span>${m.role==="attente"?`<button class="btn" type="button" data-sa="accepter" data-uid="${esc(m.user_id)}">Accepter</button>`:""}<button class="btn alt" type="button" data-sa="retirer" data-uid="${esc(m.user_id)}" data-nom="${esc(m.nom||m.email)}">Retirer</button></div>`).join(""):`<p class="small" style="margin:0">Aucun ouvrier pour l'instant.</p>`)}
  catch(e){el.innerHTML=`<p class="small" style="margin:0">Liste indisponible hors ligne.</p>`}}
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
window.__coneSA={
  banner(){
    if(!nbDocs())return`<div class="card" style="border:2px solid var(--lime)"><b>Bienvenue dans l'app CŌNE</b><p class="small" style="margin:4px 0 8px">Pour retrouver vos clients et chantiers, importez le fichier de sauvegarde « CONE-sauvegarde… .json ».</p><div class="btns"><label class="btn filebtn">📥 Importer mes données<input type="file" accept="application/json,.json" data-sa-import hidden></label></div></div>`;
    if(sync){const e=sync.etat(),n=sync.attente();if(e==="erreur"||e==="horsligne")return`<div class="card" style="background:var(--warn-bg)"><b>${e==="horsligne"?"📴 Hors ligne":"⚠️ Synchro en pause"}</b><p class="small" style="margin:4px 0 0">${n?n+" modification(s) gardée(s) sur ce téléphone, envoyée(s) dès que le réseau revient.":"Tout est enregistré sur ce téléphone."}</p></div>`;return""}
    const last=+lsGet("cone-backup")||0,dirty=+lsGet("cone-dirty")||0;
    if(dirty>last&&Date.now()-last>14*864e5)return`<div class="card" style="background:var(--warn-bg)"><b>💾 Pensez à sauvegarder</b><p class="small" style="margin:4px 0 8px">Vos données sont seulement sur cet appareil. Une copie de temps en temps (dans Fichiers ou iCloud) évite de tout perdre si le téléphone est perdu.</p><div class="btns"><button class="btn" type="button" data-sa="export">💾 Sauvegarder maintenant</button></div></div>`;
    return"";
  },
  card(){
    const last=+lsGet("cone-backup")||0;const k=cle();
    const compte=sync?`<h2>☁️ Mon compte</h2><div class="card"><p class="small" style="margin-top:0">Connecté : <b>${esc(sync.email()||"")}</b>. Vos données sont synchronisées entre vos appareils${sync.attente()?" ("+sync.attente()+" modification(s) en attente d'envoi)":" (tout est à jour)"}.</p><div class="btns"><button class="btn alt" type="button" data-sa="sync">🔄 Synchroniser maintenant</button><button class="btn alt" type="button" data-sa="logout">Se déconnecter</button></div></div>
    <h2>👷 Équipe</h2><div class="card" id="sa-equipe"><p class="small" style="margin:0">Chargement…</p></div>`:"";
    if(sync)setTimeout(equipe,0);
    const th=lsGet("cone-theme")||"light";
    const apparence=`<h2>🎨 Apparence</h2><div class="card"><div class="btns" style="margin-top:0">${[["light","☀️ Clair"],["dark","🌙 Sombre"],["auto","Comme le téléphone"]].map(([v,l])=>`<button class="btn${th===v?"":" alt"}" type="button" data-sa="theme" data-v="${v}">${l}</button>`).join("")}</div></div>`;
    return apparence+compte+`<h2>💾 Mes données</h2><div class="card"><p class="small" style="margin-top:0">${sync?"Copie de secours (facultative) de vos clients, chantiers et photos":"Vos clients, chantiers et photos sont enregistrés sur cet appareil uniquement"} (${nbDocs()} éléments, ${blobUrl.size} photos). ${last?"Dernière sauvegarde : "+new Date(last).toLocaleDateString("fr-BE")+".":"Aucune sauvegarde pour l'instant."}</p>
    <div class="btns"><button class="btn" type="button" data-sa="export">💾 Sauvegarder (fichier)</button><label class="btn alt filebtn">📥 Restaurer une sauvegarde<input type="file" accept="application/json,.json" data-sa-import hidden></label></div>
    <p class="small">Pour passer d'un appareil à l'autre : « Sauvegarder » ici, puis « Restaurer » sur l'autre appareil.</p></div>
    <h2>🌿 Scanner de plantes et lecture des tickets</h2><div class="card"><p class="small" style="margin-top:0">Ces fonctions utilisent l'IA Claude. Collez votre clé Claude (console.anthropic.com → API Keys). Elle reste sur cet appareil. Coût : environ 1 à 3 centimes par photo.</p>
    <label for="sa_cle">Clé Claude</label><input id="sa_cle" type="password" autocomplete="off" placeholder="sk-ant-…" value="${esc(k)}">
    <div class="btns"><button class="btn" type="button" data-sa="cle">Enregistrer la clé</button>${k?`<button class="btn alt" type="button" data-sa="nocle">Retirer la clé</button>`:""}</div>
    <p class="small">${k?"✅ IA activée.":"IA désactivée : tout le reste de l'app fonctionne normalement."}</p></div>`;
  }};
document.addEventListener("click",async e=>{const b=e.target.closest("[data-sa]");if(!b)return;e.preventDefault();e.stopPropagation();
  const a=b.dataset.sa;
  if(a==="export"){b.disabled=true;try{await exporter();alertMsg("Sauvegarde prête.")}catch(err){alertMsg("Sauvegarde impossible.")}b.disabled=false}
  if(a==="cle"){const v=(document.getElementById("sa_cle").value||"").trim();if(!/^sk-ant-/.test(v)){alertMsg("La clé commence par « sk-ant- ».");return}lsSet(KEY,v);location.reload()}
  if(a==="nocle"){lsSet(KEY,null);location.reload()}
  if(a==="theme"){const v=b.dataset.v;lsSet("cone-theme",v);if(v==="auto")document.documentElement.removeAttribute("data-theme");else document.documentElement.setAttribute("data-theme",v);document.querySelectorAll('[data-sa="theme"]').forEach(x=>x.classList.toggle("alt",x.dataset.v!==v))}
  if(a==="sync"&&sync){sync.now();alertMsg("Synchronisation lancée.")}
  if(a==="logout"&&sync)sync.deconnexion(true);
  if(a==="accepter"||a==="retirer"){b.disabled=true;try{if(a==="accepter")await sync.setRole(b.dataset.uid,"ouvrier");else{if(!confirm("Retirer l'accès de "+(b.dataset.nom||"cette personne")+" ?")){b.disabled=false;return}await sync.retirer(b.dataset.uid)}equipe()}catch(err){alertMsg("Action impossible.");b.disabled=false}}
},true);
document.addEventListener("change",e=>{const el=e.target;if(el&&el.matches&&el.matches("[data-sa-import]")&&el.files&&el.files[0]){e.stopPropagation();importer(el.files[0])}},true);

const K={kvGet,kvSet,mem:()=>mem,
  blobIds:()=>idb?tx(BL,"readonly",s=>s.getAllKeys()):Promise.resolve([]),blobGet:id=>tx(BL,"readonly",s=>s.get(id)),
  apply(col,id,data){const cur=(mem[col]||{})[id];if(data===undefined){if(cur===undefined)return false;delete mem[col][id]}else{if(JSON.stringify(cur)===JSON.stringify(data))return false;mem[col]=mem[col]||{};mem[col][id]=data}persist();return true},
  dropCol(col){delete mem[col];persist()},notifyCol(col){(colL[col]||[]).forEach(cb=>{try{cb(snapCol(col))}catch(e){}});Object.keys(docL).filter(p=>p.startsWith(col+"/")).forEach(p=>docL[p].forEach(cb=>{try{cb(snapDoc(p))}catch(e){}}))},
  async wipe(){mem={};if(idb){await kvSet("mem",{});await kvSet("queue",{});await kvSet("blobsUp",{});await kvSet("lastPull","");await tx(BL,"readwrite",s=>s.clear())}lsSet("cone-autonome",null)}};
ready=init().then(async()=>{if(idb&&window.__coneSyncInit){sync=window.__coneSyncInit(K);if(sync){sync.onEtat(()=>{});await sync.start()}}});
if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(()=>{}));
})();
