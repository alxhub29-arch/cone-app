/* CŌNE : synchronisation en ligne (Supabase), sans bibliothèque externe.
   Branchée sur le shim : window.__coneSync(api) reçoit les fonctions internes du shim. */
window.__coneSyncInit=function(K){
"use strict";
const SB=window.CONE_SB;if(!SB||!SB.url||!SB.key)return null;
const URLB=SB.url.replace(/\/$/,"");
const lsGet=k=>{try{return localStorage.getItem(k)}catch(e){return null}};
const lsSet=(k,v)=>{try{v==null?localStorage.removeItem(k):localStorage.setItem(k,v)}catch(e){}};
let sess=null;try{sess=JSON.parse(lsGet("cone-session")||"null")}catch(e){}
let role=null,etat="";const subs=new Set();
const setEtat=t=>{etat=t;subs.forEach(f=>{try{f()}catch(e){}})};

async function authReq(path,body){const r=await fetch(URLB+"/auth/v1/"+path,{method:"POST",headers:{apikey:SB.key,"content-type":"application/json"},body:JSON.stringify(body)});const j=await r.json().catch(()=>({}));if(!r.ok){const e=new Error(j.msg||j.error_description||j.message||("Erreur "+r.status));e.status=r.status;e.code=j.error_code||j.code;throw e}return j}
function keep(j){sess={at:j.access_token,rt:j.refresh_token,exp:Date.now()+(j.expires_in||3600)*1000,uid:j.user&&j.user.id||sess&&sess.uid,email:j.user&&j.user.email||sess&&sess.email};lsSet("cone-session",JSON.stringify(sess))}
let refreshing=null;
async function token(){if(!sess)throw Object.assign(new Error("non connecté"),{status:401});
  if(Date.now()>sess.exp-60000){refreshing=refreshing||authReq("token?grant_type=refresh_token",{refresh_token:sess.rt}).then(keep).finally(()=>{refreshing=null});await refreshing}
  return sess.at}
async function api(path,opt){opt=opt||{};for(let i=0;i<2;i++){
  const h={apikey:SB.key,Authorization:"Bearer "+await token(),...(opt.headers||{})};
  const r=await fetch(URLB+path,{...opt,headers:h});
  if(r.status===401&&i===0&&sess){sess.exp=0;continue}
  if(!r.ok){const t=await r.text().catch(()=>"");const e=new Error(t||("Erreur "+r.status));e.status=r.status;throw e}
  return r}}
const jsonApi=async(path,opt)=>{const r=await api(path,opt);const t=await r.text();return t?JSON.parse(t):null};

/* ---------- file d'attente des envois ---------- */
let queue={},blobsUp={},lastPull="";
async function loadState(){queue=(await K.kvGet("queue"))||{};blobsUp=(await K.kvGet("blobsUp"))||{};lastPull=(await K.kvGet("lastPull"))||""}
const saveQ=()=>K.kvSet("queue",queue).catch(()=>{});
function enqueue(col,id,data,deleted){queue[col+"\u0001"+id]={col,id,data:deleted?null:data,deleted:!!deleted};saveQ();schedule(400)}
function enqueueBlob(id){delete blobsUp[id];K.kvSet("blobsUp",blobsUp).catch(()=>{});schedule(400)}
async function delBlob(id){try{await api("/storage/v1/object/photos/"+encodeURIComponent(id),{method:"DELETE"})}catch(e){}delete blobsUp[id];K.kvSet("blobsUp",blobsUp).catch(()=>{})}

let timer=null,running=false,again=false;
function schedule(ms){clearTimeout(timer);timer=setTimeout(cycle,ms)}
async function push(){
  const items=Object.entries(queue);if(!items.length)return;
  for(let i=0;i<items.length;i+=200){const part=items.slice(i,i+200);
    await api("/rest/v1/docs",{method:"POST",headers:{"content-type":"application/json",Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(part.map(([,o])=>({col:o.col,id:o.id,data:o.data,deleted:o.deleted})))});
    part.forEach(([k,o])=>{if(queue[k]===o)delete queue[k]})}
  await saveQ()}
async function pushBlobs(){
  if(role!=="patron"&&role!=="ouvrier")return;
  for(const id of await K.blobIds()){if(blobsUp[id])continue;const b=await K.blobGet(id);if(!b)continue;
    await api("/storage/v1/object/photos/"+encodeURIComponent(id),{method:"POST",headers:{"content-type":b.type||"image/jpeg","x-upsert":"true"},body:b});
    blobsUp[id]=1;await K.kvSet("blobsUp",blobsUp)}}
async function pull(){
  const since=lastPull?new Date(new Date(lastPull).getTime()-120000).toISOString():"";
  let off=0,max=lastPull;const changed=new Set();const first=!lastPull;const seen=new Set();
  for(;;){const rows=await jsonApi("/rest/v1/docs?select=col,id,data,deleted,updated_at"+(since?"&updated_at=gt."+encodeURIComponent(since):"")+"&order=updated_at.asc,col.asc,id.asc&limit=500&offset="+off);
    for(const r of rows){seen.add(r.col+"\u0001"+r.id);if(!max||r.updated_at>max)max=r.updated_at;
      if(queue[r.col+"\u0001"+r.id])continue;
      if(K.apply(r.col,r.id,r.deleted?undefined:r.data))changed.add(r.col)}
    if(rows.length<500)break;off+=500}
  if(first&&role==="patron"){/* 1re synchro de cet appareil : envoyer ce qui n'existe qu'ici */
    for(const[col,docs]of Object.entries(K.mem())){for(const id of Object.keys(docs||{})){if(!seen.has(col+"\u0001"+id))queue[col+"\u0001"+id]={col,id,data:docs[id],deleted:false}}}
    await saveQ()}
  if(first&&role==="ouvrier"){/* un ouvrier ne garde que l'équipe */
    for(const col of Object.keys(K.mem())){if(!/^equipe\//.test(col)){K.dropCol(col);changed.add(col)}}}
  if(max&&max!==lastPull){lastPull=max;await K.kvSet("lastPull",lastPull)}
  changed.forEach(c=>K.notifyCol(c))}
async function cycle(){
  if(!sess||!role||role==="attente")return;
  if(running){again=true;return}running=true;
  try{if(!navigator.onLine)throw new Error("hors ligne");setEtat("sync");await push();await pull();await push();await pushBlobs();setEtat(Object.keys(queue).length?"attente":"ok")}
  catch(e){console.warn("synchro",e);setEtat(navigator.onLine?"erreur":"horsligne")}
  running=false;if(again){again=false;schedule(500)}else schedule(document.hidden?120000:20000)}
document.addEventListener("visibilitychange",()=>{if(!document.hidden)schedule(200)});
window.addEventListener("online",()=>schedule(200));

async function getBlob(id){const r=await api("/storage/v1/object/authenticated/photos/"+encodeURIComponent(id));const b=await r.blob();blobsUp[id]=1;K.kvSet("blobsUp",blobsUp).catch(()=>{});return b}
async function fetchRole(){try{role=await jsonApi("/rest/v1/rpc/mon_role",{method:"POST",headers:{"content-type":"application/json"},body:"{}"})}catch(e){if(e.status===401){sess=null;lsSet("cone-session",null)}role=lsGet("cone-role")}lsSet("cone-role",role||"");return role}

/* ---------- écran de connexion ---------- */
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
function ecran(html){let o=document.getElementById("sb-ecran");if(!o){o=document.createElement("div");o.id="sb-ecran";o.style.cssText="position:fixed;inset:0;z-index:50;background:var(--bg);overflow:auto;padding:calc(24px + env(safe-area-inset-top,0px)) 16px 24px";document.body.appendChild(o)}o.innerHTML=`<div style="max-width:420px;margin:0 auto"><div style="display:flex;align-items:center;gap:12px;margin-bottom:20px"><img src="icons/icon-192.png" alt="" style="width:56px;height:56px;border-radius:14px"><div><b style="font-size:20px">CŌNE</b><div class="small">Application de chantier de CŌNES Colors</div></div></div>${html}</div>`;return o}
function fermer(){const o=document.getElementById("sb-ecran");if(o)o.remove()}
function login(msg){return new Promise(done=>{
  let mode="in";
  const draw=(m,err)=>{const o=ecran(`<h1 style="margin:0 0 4px">${mode==="in"?"Connexion":"Créer mon accès"}</h1><p class="small" style="margin:0 0 14px">${mode==="in"?"Connectez-vous pour retrouver vos chantiers sur tous vos appareils.":"Ouvriers : créez votre accès, Alexandre le valide ensuite."}</p>
    ${m?`<div class="card" style="background:var(--info-bg)">${m}</div>`:""}${err?`<div class="card" style="background:var(--bad-bg);color:var(--bad)">${esc(err)}</div>`:""}
    <form id="sb-f"><label for="sb-e">E-mail</label><input id="sb-e" type="email" autocomplete="username" required value="${esc(lsGet("cone-email")||"")}">
    ${mode==="up"?`<label for="sb-n">Prénom</label><input id="sb-n" autocomplete="given-name" required>`:""}
    <label for="sb-p">Mot de passe${mode==="up"?" (8 caractères minimum)":""}</label><input id="sb-p" type="password" autocomplete="${mode==="in"?"current-password":"new-password"}" minlength="${mode==="up"?8:1}" required>
    <div class="btns"><button class="btn" type="submit">${mode==="in"?"Se connecter":"Créer mon accès"}</button></div></form>
    <div class="btns"><button class="btn alt" type="button" id="sb-sw">${mode==="in"?"Pas encore d'accès ? Créer mon accès":"J'ai déjà un accès : me connecter"}</button>${mode==="in"?`<button class="btn alt" type="button" id="sb-mdp">Mot de passe oublié</button>`:""}</div>`);
    o.querySelector("#sb-sw").onclick=()=>{mode=mode==="in"?"up":"in";draw()};
    const f=o.querySelector("#sb-mdp");if(f)f.onclick=async()=>{const e=o.querySelector("#sb-e").value.trim();if(!e){draw("","Indiquez d'abord votre e-mail.");return}try{await authReq("recover",{email:e});draw("Un e-mail pour choisir un nouveau mot de passe vient d'être envoyé.")}catch(err){draw("",err.message)}};
    o.querySelector("#sb-f").onsubmit=async ev=>{ev.preventDefault();const e=o.querySelector("#sb-e").value.trim(),p=o.querySelector("#sb-p").value;lsSet("cone-email",e);
      const b=o.querySelector("button[type=submit]");b.disabled=true;b.textContent="Un instant…";
      try{if(mode==="up"){const n=(o.querySelector("#sb-n").value||"").trim();const j=await authReq("signup",{email:e,password:p,data:{nom:n}});if(n)lsSet("cone-ouvrier-nom",n);
          if(!j.access_token){mode="in";draw("Accès créé. Ouvrez l'e-mail reçu et touchez le lien de confirmation, puis revenez ici pour vous connecter.");return}keep(j)}
        else keep(await authReq("token?grant_type=password",{email:e,password:p}));
        done()}
      catch(err){draw("",/invalid login/i.test(err.message)?"E-mail ou mot de passe incorrect.":/not confirmed/i.test(err.message)?"Confirmez d'abord votre e-mail (lien reçu par e-mail).":/already registered/i.test(err.message)?"Cet e-mail a déjà un accès : connectez-vous.":err.message)}};
  };draw(msg)})}
async function attente(){for(;;){ecran(`<h1>Accès en attente</h1><p>Votre accès (${esc(sess&&sess.email||"")}) est créé. Alexandre doit encore le valider dans l'app (Réglages › Équipe).</p><div class="btns"><button class="btn" type="button" id="sb-re">Vérifier à nouveau</button><button class="btn alt" type="button" id="sb-out">Se déconnecter</button></div>`);
  await new Promise(ok=>{document.getElementById("sb-re").onclick=ok;document.getElementById("sb-out").onclick=()=>{deconnexion(true)}});
  if(await fetchRole()!=="attente")return}}

async function depuisLien(){/* retour d'un lien e-mail (confirmation ou mot de passe oublié) */
  const h=new URLSearchParams(location.hash.replace(/^#/,""));if(!h.get("access_token"))return;
  history.replaceState(null,"",location.pathname);
  try{const u=await (await fetch(URLB+"/auth/v1/user",{headers:{apikey:SB.key,Authorization:"Bearer "+h.get("access_token")}})).json();
    keep({access_token:h.get("access_token"),refresh_token:h.get("refresh_token"),expires_in:+h.get("expires_in")||3600,user:u})}catch(e){return}
  if(h.get("type")!=="recovery")return;
  await new Promise(done=>{const draw=err=>{const o=ecran(`<h1>Nouveau mot de passe</h1>${err?`<div class="card" style="background:var(--bad-bg);color:var(--bad)">${esc(err)}</div>`:""}<form id="sb-r"><label for="sb-np">Nouveau mot de passe (8 caractères minimum)</label><input id="sb-np" type="password" autocomplete="new-password" minlength="8" required><div class="btns"><button class="btn" type="submit">Enregistrer</button></div></form>`);
    o.querySelector("#sb-r").onsubmit=async ev=>{ev.preventDefault();try{await api("/auth/v1/user",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({password:o.querySelector("#sb-np").value})});done()}catch(e){draw("Impossible d'enregistrer ce mot de passe.")}}};draw()})}
async function start(){
  await loadState();await depuisLien();
  for(;;){
    if(!sess)await login();
    const r=await fetchRole();
    if(!sess)continue;
    if(r==="attente"){await attente()}
    if(role==="patron"||role==="ouvrier")break;
    if(!role){/* hors ligne au démarrage : on garde le dernier rôle connu */role=lsGet("cone-role");if(role)break;await login("Connexion impossible pour l'instant. Vérifiez le réseau.")}
  }
  fermer();
  if(!lastPull){ecran(`<p>Chargement de vos données…</p>`);try{await cycle()}catch(e){}fermer()}
  else schedule(100);
}
function deconnexion(vider){
  if(Object.keys(queue).length&&!confirm("Certaines modifications ne sont pas encore envoyées. Se déconnecter quand même ?"))return;
  const rt=sess&&sess.at;sess=null;lsSet("cone-session",null);lsSet("cone-role",null);
  if(rt)fetch(URLB+"/auth/v1/logout",{method:"POST",headers:{apikey:SB.key,Authorization:"Bearer "+rt}}).catch(()=>{});
  K.wipe().then(()=>location.reload())}

/* ---------- équipe (patron) ---------- */
async function membres(){return jsonApi("/rest/v1/membres?select=user_id,email,nom,role,cree&order=cree.asc")}
async function setRole(uid,r){await api("/rest/v1/membres?user_id=eq."+uid,{method:"PATCH",headers:{"content-type":"application/json",Prefer:"return=minimal"},body:JSON.stringify({role:r})})}
async function retirer(uid){await api("/rest/v1/membres?user_id=eq."+uid,{method:"DELETE"})}

return{start,enqueue,enqueueBlob,delBlob,getBlob,deconnexion,membres,setRole,retirer,
  role:()=>role,email:()=>sess&&sess.email,uid:()=>sess&&sess.uid,etat:()=>etat,attente:()=>Object.keys(queue).length,onEtat:f=>subs.add(f),now:()=>schedule(50)};
};
