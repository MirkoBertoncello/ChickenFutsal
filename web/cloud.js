'use strict';
// REST Supabase: nessuna credenziale privilegiata nel browser.
const config=window.CLUB_CONFIG||{},online=!!(config.supabaseUrl&&config.supabasePublishableKey);
let season=new Date().getFullYear(),session=null,busy=false,cloudReady=false;
const originalRender=render;
let tokenRefresh=null;
try{session=JSON.parse(sessionStorage.getItem('club-session')||'null')}catch{}
const apiBase=String(config.supabaseUrl||'').replace(/\/$/,'');
async function request(path,body,token=true){
 const headers={'apikey':config.supabasePublishableKey,'Content-Type':'application/json'};
 if(token&&session?.access_token)headers.Authorization='Bearer '+session.access_token;
 const res=await fetch(apiBase+path,{method:'POST',headers,body:JSON.stringify(body)});
 const data=await res.json().catch(()=>({message:'Risposta non valida dal servizio'}));
 if(!res.ok)throw Error(data.message||data.msg||data.error_description||data.error||'Richiesta non riuscita');
 return data;
}
function storeSession(s){session=s;if(s){sessionStorage.setItem('club-session',JSON.stringify(s));clearTimeout(tokenRefresh);tokenRefresh=setTimeout(()=>refreshToken(),Math.max(1000,(s.expires_in||3600)*1000-60000))}else{sessionStorage.removeItem('club-session');clearTimeout(tokenRefresh)}}
async function refreshToken(){if(!session?.refresh_token)return;try{storeSession(await request('/auth/v1/token?grant_type=refresh_token',{refresh_token:session.refresh_token},false))}catch{storeSession(null);loginView('Sessione scaduta. Accedi di nuovo.')}}
async function rpc(name,body={}){return request('/rest/v1/rpc/'+name,body)}
async function reload(){
 if(!online)return render();
 if(!session?.access_token)return loginView();
 if(session.expires_at&&session.expires_at*1000<Date.now()+60000)await refreshToken();
 if(!session)return;
 const data=await rpc('club_snapshot',{p_season:season});
 state={...data,votes:{},voteOpen:false};user=data.user;cloudReady=true;render();
}
function loginView(message=''){
 cloudReady=false;$('#nav').innerHTML='';$('.identity').innerHTML='<span class="badge">Accesso al gruppo</span>';
 $('#app').innerHTML=heading('Il nostro calcetto, insieme.','Accedi con l’email che l’admin ha associato al tuo giocatore.')+`<div class="card" style="max-width:480px"><h2>Entra nel ChickenFutsal</h2>${config.googleOAuthEnabled?'<p><button class="btn secondary" onclick="googleLogin()">Accedi con Google</button></p>':''}${message?`<div class="notice">${esc(message)}</div>`:''}${config.googleOAuthEnabled?'':`<form onsubmit="authenticate(event)"><div class="field"><label for="auth-email">Email</label><input id="auth-email" type="email" autocomplete="email" required></div><div class="field"><label for="auth-password">Password</label><input id="auth-password" type="password" autocomplete="current-password" minlength="8" required></div><div class="toolbar"><button class="btn" id="auth-button">Accedi</button><button type="button" class="btn secondary" onclick="authenticate(null,true)">Crea account</button></div><button type="button" class="link" onclick="resetPassword()">Password dimenticata?</button></form>`}<p class="muted">Usa l’account con l’email che l’admin ha associato al tuo giocatore. Un account da solo non dà accesso al gruppo.</p></div>`;
 $('footer').textContent='ChickenFutsal · Dati condivisi su Supabase · Accesso riservato ai membri';
}
function googleLogin(){location.assign(apiBase+'/auth/v1/authorize?provider=google&redirect_to='+encodeURIComponent(location.origin+'/'))}
async function authenticate(e,signup=false){
 e?.preventDefault();if(busy)return;
 const email=$('#auth-email').value.trim(),password=$('#auth-password').value;
 if(!$('#auth-email').checkValidity()||password.length<8){toast('Inserisci email valida e password di almeno 8 caratteri');return}
 busy=true;$('#auth-button').disabled=true;
 try{
  const data=await request(signup?'/auth/v1/signup':'/auth/v1/token?grant_type=password',{email,password,...(signup?{data:{}}:{})},false);
  if(data.access_token){storeSession(data);await reload()}else loginView('Controlla la tua email e conferma l’account, poi accedi.');
 }catch(err){loginView(err.message)}finally{busy=false;if($('#auth-button'))$('#auth-button').disabled=false}
}
async function resetPassword(){
 const email=$('#auth-email').value.trim();if(!$('#auth-email').checkValidity()){toast('Inserisci prima la tua email');return}
 try{await request('/auth/v1/recover',{email},false);toast('Se l’account esiste riceverai un’email per reimpostare la password')}catch(err){toast(err.message)}
}
async function signout(){
 if(session){try{await request('/auth/v1/logout',{})}catch{}}
 storeSession(null);state=structuredClone(seed);user=0;cloudReady=false;loginView();
}
function recoveryView(){
 $('#app').innerHTML=heading('Scegli una nuova password','Salva la nuova password per il tuo account.')+`<form class="card" style="max-width:480px" onsubmit="updatePassword(event)"><div class="field"><label for="recovery-password">Nuova password</label><input id="recovery-password" type="password" minlength="8" autocomplete="new-password" required></div><button class="btn">Salva password</button></form>`;
}
async function updatePassword(e){e.preventDefault();if(busy)return;busy=true;try{
 const r=await fetch(apiBase+'/auth/v1/user',{method:'PUT',headers:{apikey:config.supabasePublishableKey,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:JSON.stringify({password:$('#recovery-password').value})});
 const d=await r.json();if(!r.ok)throw Error(d.msg||d.message||'Password non aggiornata');await reload();toast('Password aggiornata')
 }catch(err){toast(err.message)}finally{busy=false}}
render=function(){
 if(online&&!cloudReady)return;
 originalRender();
 if(online){
  $('.identity').innerHTML=`<span class="badge">${esc(me().name)} · ${admin()?'Admin':'Giocatore'}</span><button class="link" onclick="signout()">Esci</button>`;
  $('footer').textContent='Dati condivisi su Supabase · Notifiche push disponibili dopo la configurazione';
  $('.top small').textContent=`Stagione ${season} · Il nostro gruppo`;
 }else $('footer').textContent='Modalità demo · Solo dati locali · Account e notifiche simulati';
 const years=[...new Set([season,...(state.seasons||[]),...state.matches.map(m=>+m.date.slice(0,4)),...(admin()?[new Date().getFullYear(),new Date().getFullYear()+1]:[])])].sort((a,b)=>b-a);
 $('#app').insertAdjacentHTML('afterbegin',`<div class="toolbar" style="margin-top:20px;margin-bottom:0"><select aria-label="Stagione" onchange="changeSeason(this.value)">${years.map(y=>`<option ${y===season?'selected':''}>${y}</option>`).join('')}</select><button class="btn small secondary" onclick="refreshView()">↻ Aggiorna</button><button class="btn small secondary" onclick="showNotifications()">♧ Avvisi ${state.notifications.filter(n=>!n.seen).length||''}</button>${online?'<button class="btn small secondary" onclick="enablePush()">Attiva notifiche</button>':'<span class="badge">Demo locale</span>'}</div>`);
 $('.sidebar-bottom').innerHTML=`IL NOSTRO CAMPIONATO<br><b style="color:white">Stagione ${season}</b><br><br>Il giovedì non si prendono impegni.`;
};
async function changeSeason(value){season=+value;try{await reload()}catch(e){toast(e.message)}}
async function refreshView(){try{await reload();toast(online?'Dati aggiornati dal server':'Demo aggiornata')}catch(e){toast(e.message)}}
async function action(name,data,success){
 if(busy)return false;busy=true;
 try{
  if(online)await rpc('club_action',{p_action:name,p_data:data});else demoAction(name,data);
  await reload();if(success)toast(success);return true;
 }catch(e){toast(e.message);return false}finally{busy=false}
}
save=function(){if(!online)localStorage.setItem('pollone-v1',JSON.stringify(state))};
function demoAction(name,d){
 const id=()=>{state.demoNextId=Math.max(Date.now(),(state.demoNextId||0)+1);return state.demoNextId};state.rounds??=[];state.demoBallots??={};
 switch(name){
 case 'ratings':p(d.id).ratings=d.ratings;break;
 case 'permission':p(d.id)[d.key]=d.value;break;
 case 'player':state.players.push({id:Math.max(...state.players.map(x=>x.id))+1,name:d.name,role:d.role,email:d.email,admin:false,seeAll:false,goals:0,own:0,apps:0,ratings:[60,60,60,60,60,60]});break;
 case 'invite':p(d.id).email=d.email;break;
 case 'match':{let m={...d,id:id(),done:false};state.matches.push(m);state.notifications.push({id:id(),text:`Convocazione: ${date(m.date)} alle ${m.time} · ${m.field}`,to:[...m.a,...m.b],seen:false,matchId:m.id});break}
 case 'result':{let m=state.matches.find(x=>x.id===d.id);for(const pid of [...m.a,...m.b]){let x=p(pid),prev=m.result?.[pid]||{goals:0,own:0,present:false},r=d.result[pid];x.goals+=r.goals-prev.goals;x.own+=r.own-prev.own;x.apps+=Number(r.present)-Number(prev.present)}m.result=d.result;m.done=true;break}
 case 'round_open':{let rs=state.rounds.filter(r=>r.award===d.award&&r.season===season),last=rs.at(-1);if(last&&(last.status!=='closed'||last.turn===4))throw Error('Non puoi aprire un altro turno');state.rounds.push({id:id(),season,award:d.award,turn:last?last.turn+1:1,candidates:last?d.candidates:state.players.map(x=>x.id),status:'open',count:0,results:[]});break}
 case 'round_close':state.rounds.find(r=>r.id===d.id).status='closed';break;
 case 'round_final':state.rounds.find(r=>r.id===d.id).status='final';break;
 case 'vote':{let r=state.rounds.find(r=>r.id===d.round),key=`${r.id}:${user}`;if(r.status!=='open'||!r.candidates.includes(d.candidate))throw Error('Candidato o turno non valido');if(state.demoBallots[key])throw Error('Hai già votato');state.demoBallots[key]=true;r.count++;let count=r.results.find(x=>x.id===d.candidate);if(count)count.count++;else r.results.push({id:d.candidate,count:1});break}
 case 'seen':state.notifications.find(n=>n.id===d.id).seen=true;break;
 }
 save();
}

const legacyAwards=awards;
awards=function(){return legacyAwards().replaceAll('Stagione 2026',`Stagione ${season}`)+['pollone','bidone'].map(a=>{const r=currentRounds(a).at(-1);return r?.status==='final'?`<div class="notice"><strong>${a==='pollone'?'Pollone':'Bidone'} d’oro:</strong> ${winners(r)}</div>`:''}).join('')};pages.awards=awards;
function currentRounds(award){return (state.rounds||[]).filter(r=>r.award===award&&(!r.season||r.season===season)).sort((a,b)=>a.turn-b.turn)}
function hasVoted(r){return online?r.voted:!!state.demoBallots?.[`${r.id}:${user}`]}
function aggregate(r){
 const sorted=r.results.slice().sort((a,b)=>b.count-a.count);return sorted.map(x=>`<div class="row spread leader"><span>${esc(p(x.id).name)}</span><b>${x.count} ${x.count===1?'voto':'voti'}</b></div>`).join('')||'<p class="muted">Nessun voto ricevuto.</p>';
}
votes=function(){
 return heading('Il tuo voto fa la differenza','Da 1 a 4 turni per premio. I voti ripartono da zero a ogni turno.')+`<div class="notice">🔒 Le scelte individuali sono nascoste agli admin dell’app. Puoi votare te stesso se sei ancora candidato. Gli eliminati continuano a votare.${online?'':' In questa demo la segretezza è simulata.'}</div><div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr))">${['pollone','bidone'].map(award=>{
 const rs=currentRounds(award),r=rs.at(-1),title=award==='pollone'?'Pollone d’oro':'Bidone d’oro';
 return `<section class="card"><div class="award-icon">${award==='pollone'?'🌟':'🪣'}</div><h2>${title}</h2><p class="muted">${award==='pollone'?'Il miglior giocatore dell’anno.':'Il bidone dell’anno.'}</p>${!r?`<div class="notice">Votazione non ancora aperta.</div>${admin()?`<button class="btn" onclick="openFirstRound('${award}')">Apri primo turno</button>`:''}`:`<span class="badge">Turno ${r.turn} / 4 · ${r.candidates.length} candidati · ${r.status==='open'?'Aperto':r.status==='final'?'Premio assegnato':'Chiuso'}</span><p class="muted">${r.count} schede ricevute</p>${r.status==='open'?(hasVoted(r)?'<div class="notice">✓ Hai già votato in questo turno.</div>':`<form onsubmit="castVote(event,${r.id})"><div class="field"><label for="vote-${r.id}">Scegli il tuo candidato</label><select id="vote-${r.id}" required><option value="">Scegli un giocatore</option>${r.candidates.map(id=>`<option value="${id}">${esc(p(id).name)}${id===user?' (tu)':''}</option>`).join('')}</select></div><button class="btn">Invia voto segreto</button></form>`)+`${admin()?`<p><button class="btn secondary" onclick="closeRound(${r.id})">Chiudi turno e mostra risultati</button></p>`:''}`:aggregate(r)+`${r.status==='final'?`<div class="notice">${winners(r)}</div>`:admin()?`<div class="toolbar" style="margin-top:20px">${r.turn<4?`<button class="btn" onclick="chooseCandidates(${r.id})">Apri turno ${r.turn+1}</button>`:''}<button class="btn secondary" ${!r.count?'disabled':''} onclick="finalRound(${r.id})">Concludi il premio</button></div>`:''}`}`}${rs.length>1?`<details style="margin-top:25px"><summary>Storico dei turni precedenti</summary>${rs.slice(0,-1).map(old=>`<h3 style="margin-top:20px">Turno ${old.turn}</h3>${aggregate(old)}`).join('')}</details>`:''}</section>`
 }).join('')}</div><div class="notice">I risultati dell’ultimo turno determinano il vincitore. In caso di parità mostriamo tutti i primi a pari merito: fino al terzo turno puoi aprire uno spareggio come turno successivo.</div>`;
};pages.votes=votes;
function winners(r){let max=Math.max(...r.results.map(x=>x.count));let ws=r.results.filter(x=>x.count===max).map(x=>esc(p(x.id).name));return ws.length>1?'Pari merito: '+ws.join(', '):'Vincitore: '+ws.join('')}
async function openFirstRound(award){await action('round_open',{award,season},'Primo turno aperto: tutti i giocatori sono candidati')}
async function castVote(e,id){e.preventDefault();let value=$('#vote-'+id).value;if(value==='')return;await action('vote',{round:id,candidate:+value},'Voto segreto registrato')}
async function closeRound(id){modal('Chiudi il turno?',`<p>I voti diventano definitivi e i risultati aggregati saranno visibili al gruppo. Non potrai riaprire questo turno.</p><button class="btn" onclick="confirmCloseRound(${id})">Conferma chiusura</button>`)}
async function confirmCloseRound(id){if(await action('round_close',{id},'Turno chiuso'))$('#modal').close()}
function chooseCandidates(id){let r=state.rounds.find(r=>r.id===id);modal('Candidati del prossimo turno',`<p class="muted">Scegli quanti e quali candidati mantenere. I risultati precedenti sono un suggerimento; ogni voto del nuovo turno partirà da zero.</p><form onsubmit="startNextRound(event,${id})"><div class="checklist">${r.candidates.slice().sort((a,b)=>(r.results.find(x=>x.id===b)?.count||0)-(r.results.find(x=>x.id===a)?.count||0)).map(pid=>`<label class="check"><input type="checkbox" name="candidate" value="${pid}">${esc(p(pid).name)} · ${r.results.find(x=>x.id===pid)?.count||0} voti</label>`).join('')}</div><button class="btn">Apri turno ${r.turn+1}</button></form>`)}
async function startNextRound(e,id){e.preventDefault();let r=state.rounds.find(r=>r.id===id),candidates=[...document.querySelectorAll('[name=candidate]:checked')].map(x=>+x.value);if(!candidates.length)return toast('Seleziona almeno un candidato');if(await action('round_open',{season,award:r.award,candidates},'Nuovo turno aperto · voti azzerati'))$('#modal').close()}
function finalRound(id){modal('Concludi questo premio?',`<p>Il risultato di questo turno sarà il risultato finale. Non potrai aprire altri turni per questo premio nella stagione ${season}.</p><button class="btn" onclick="confirmFinal(${id})">Conferma assegnazione</button>`)}
async function confirmFinal(id){if(await action('round_final',{id},'Premio concluso'))$('#modal').close()}
saveRatings=async function(e,id){e.preventDefault();if(await action('ratings',{id,ratings:labels.map((_,i)=>+$('#r'+i).value)},'Valutazioni aggiornate'))$('#modal').close()};
permission=async function(id,key,value){await action('permission',{id,key,value},'Permessi aggiornati')};
addPlayer=function(){if(!admin())return;modal('Un nuovo compagno di squadra',`<form onsubmit="savePlayer(event)"><div class="field"><label for="new-name">Nome e cognome</label><input id="new-name" maxlength="60" required></div><div class="field"><label for="new-role">Ruolo</label><select id="new-role"><option>Attaccante</option><option>Regista</option><option>Difensore</option><option>Portiere</option></select></div><div class="field"><label for="new-email">Email per l’accesso (facoltativa)</label><input id="new-email" type="email" autocomplete="off"></div><p class="muted">Il giocatore deve creare il proprio account con questa email. Non viene inviata un’email di invito automatica.</p><button class="btn">Aggiungi giocatore</button></form>`)};
savePlayer=async function(e){e.preventDefault();if(await action('player',{name:$('#new-name').value.trim(),role:$('#new-role').value,email:$('#new-email').value.trim()},'Giocatore aggiunto'))$('#modal').close()};
confirmMatch=async function(){if(!draft)return;const data={...draft,season};if(await action('match',data,online?'Partita salvata · avvisi creati per i 10 convocati':'Partita creata · notifiche simulate')){draft=null;$('#modal').close();go('matches')}};
saveResult=async function(e,id){e.preventDefault();let m=state.matches.find(x=>x.id===id),result={};for(const pid of [...m.a,...m.b]){let r={goals:+$('#g'+pid).value,own:+$('#o'+pid).value,present:$('#p'+pid).checked};if(!Number.isInteger(r.goals)||!Number.isInteger(r.own)||r.goals<0||r.own<0||r.goals>99||r.own>99)return toast('Inserisci numeri interi da 0 a 99');if(!r.present&&(r.goals||r.own))return toast('Un assente non può segnare');result[pid]=r}if(await action('result',{id,result},'Risultato salvato · statistiche ricalcolate'))$('#modal').close()};
const legacySettings=settings;
settings=function(){return legacySettings().replace('Notifiche simulate',online?'I tuoi avvisi':'Notifiche simulate')+ (admin()?`<div class="card" style="margin-top:20px"><h3>Accesso dei giocatori</h3><p class="muted">Associa l’email con cui ciascun amico creerà il proprio account. Nessuna email di invito viene inviata da questa schermata.</p>${state.players.map(x=>`<div class="row spread leader"><div><strong>${esc(x.name)}</strong><small class="muted">${esc(x.email||'Nessuna email associata')}</small></div><button class="btn small secondary" onclick="invitePlayer(${x.id})">Associa email</button></div>`).join('')}</div>`:'')};pages.settings=settings;
function invitePlayer(id){modal('Accesso · '+esc(p(id).name),`<form onsubmit="saveInvite(event,${id})"><div class="field"><label for="invite-email">Email del giocatore</label><input id="invite-email" type="email" value="${esc(p(id).email||'')}" required></div><button class="btn">Salva email</button></form>`)}
async function saveInvite(e,id){e.preventDefault();if(await action('invite',{id,email:$('#invite-email').value.trim()},'Email associata'))$('#modal').close()}
function showNotifications(){let ns=online?state.notifications:state.notifications.filter(n=>n.to.includes(user));modal('I tuoi avvisi',ns.map(n=>`<div class="leader"><p>${esc(n.text)}</p><div class="toolbar">${n.matchId?`<button class="btn small secondary" onclick="showMatch(${n.matchId})">Vedi partita</button>`:''}${!n.seen?`<button class="btn small secondary" onclick="markSeen(${n.id})">Segna come letto</button>`:'<span class="badge">Letto</span>'}</div></div>`).join('')||'<p class="muted">Nessun avviso per te.</p>')}
async function markSeen(id){if(await action('seen',{id}))showNotifications()}
async function enablePush(){
 if(!config.vapidPublicKey)return toast('Notifiche push non ancora configurate. Le convocazioni sono disponibili negli Avvisi.');
 if(!('serviceWorker' in navigator)||!('PushManager' in window))return toast('Dispositivo non compatibile. Su iPhone aggiungi prima il sito alla Home.');
 try{
  const permission=await Notification.requestPermission();if(permission!=='granted')return toast('Consenso alle notifiche non concesso');
  const reg=await navigator.serviceWorker.ready;
  const raw=atob(config.vapidPublicKey.replace(/-/g,'+').replace(/_/g,'/'));const key=Uint8Array.from(raw,c=>c.charCodeAt(0));
  const sub=await reg.pushManager.getSubscription()||await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
  await action('push_subscribe',{subscription:sub.toJSON()},'Notifiche attivate su questo dispositivo');
 }catch(e){toast(e.message)}
}
async function boot(){
 if('serviceWorker' in navigator&&location.protocol==='https:')navigator.serviceWorker.register('/sw.js').catch(()=>{});
 if(!online){state.rounds??=[];render();return}
 const authError=new URLSearchParams(location.search).get('error_description')||new URLSearchParams(location.hash.slice(1)).get('error_description');
 if(authError){history.replaceState(null,'',location.pathname);loginView(authError);return}
 const hash=new URLSearchParams(location.hash.slice(1));
 const token=hash.get('access_token'),refresh=hash.get('refresh_token'),type=hash.get('type');
 if(token&&refresh){storeSession({access_token:token,refresh_token:refresh,expires_in:+hash.get('expires_in')||3600});history.replaceState(null,'',location.pathname);if(type==='recovery'){recoveryView();return}}
 loginView(session?'Caricamento del gruppo…':'');
 try{if(session){storeSession(session);await reload()}}catch(e){loginView(e.message)}
}
boot();
