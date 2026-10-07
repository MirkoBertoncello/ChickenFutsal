'use strict';
// REST Supabase: nessuna credenziale privilegiata nel browser.
const config=window.CLUB_CONFIG||{},online=!!(config.supabaseUrl&&config.supabasePublishableKey);
let season=null,session=null,busy=false,cloudReady=false;
const originalRender=render;
let tokenRefresh=null;
let rememberDevice=false,pushActive=false,pushBusy=false;
try{rememberDevice=localStorage.getItem('club-remember')==='true';session=JSON.parse((rememberDevice?localStorage:sessionStorage).getItem('club-session')||'null')}catch{}
function chooseRemember(){rememberDevice=!!$('#auth-remember')?.checked;localStorage.setItem('club-remember',String(rememberDevice));localStorage.removeItem('club-session');sessionStorage.removeItem('club-session')}
const apiBase=String(config.supabaseUrl||'').replace(/\/$/,'');
async function request(path,body,token=true){
 const headers={'apikey':config.supabasePublishableKey,'Content-Type':'application/json'};
 if(token&&session?.access_token)headers.Authorization='Bearer '+session.access_token;
 const res=await fetch(apiBase+path,{method:'POST',headers,body:JSON.stringify(body)});
 const data=await res.json().catch(()=>({message:'Risposta non valida dal servizio'}));
 if(!res.ok)throw Error(data.message||data.msg||data.error_description||data.error||'Richiesta non riuscita');
 return data;
}
function storeSession(s){
 session=s;clearTimeout(tokenRefresh);
 if(s){s.expires_at??=Math.floor(Date.now()/1000)+(s.expires_in||3600);const storage=rememberDevice?localStorage:sessionStorage;storage.setItem('club-session',JSON.stringify(s));(rememberDevice?sessionStorage:localStorage).removeItem('club-session');tokenRefresh=setTimeout(()=>refreshToken(),Math.max(1000,s.expires_at*1000-Date.now()-60000))}
 else{localStorage.removeItem('club-session');sessionStorage.removeItem('club-session');pushActive=false}
}
async function refreshToken(){if(!session?.refresh_token)return;try{storeSession(await request('/auth/v1/token?grant_type=refresh_token',{refresh_token:session.refresh_token},false))}catch{storeSession(null);loginView('Sessione scaduta. Accedi di nuovo.')}}
async function rpc(name,body={}){return request('/rest/v1/rpc/'+name,body)}
async function reload(){
 if(!online){updateDemoSeason();return render()}
 if(!session?.access_token)return loginView();
 if(session.expires_at&&session.expires_at*1000<Date.now()+60000)await refreshToken();
 if(!session)return;
 const data=await rpc('club_snapshot',{p_season:season});
 if(data.players.find(p=>p.id===data.user)?.admin){try{data.adminHistory=await rpc('club_admin_history')}catch{}}
 try{const push=await rpc('club_push_config');if(push.publicKey)config.vapidPublicKey=push.publicKey}catch{}
 await syncPushState();
 season=data.season;state={...data,votes:{},voteOpen:false};user=data.user;cloudReady=true;render();
}
function loginView(message=''){
 cloudReady=false;$('#nav').innerHTML='';$('.identity').innerHTML='<span class="badge">Accesso al gruppo</span>';
 $('#app').innerHTML=heading('Il nostro calcetto, insieme.','Accedi con l’email che l’admin ha associato al tuo giocatore.')+`<div class="card" style="max-width:480px"><h2>Entra nel ChickenFutsal</h2><label class="check"><input id="auth-remember" type="checkbox" ${rememberDevice?'checked':''}>Ricordami su questo dispositivo</label>${config.googleOAuthEnabled?'<p><button class="btn secondary" onclick="googleLogin()">Accedi con Google</button></p>':''}${message?`<div class="notice">${esc(message)}</div>`:''}${config.googleOAuthEnabled?'':`<form onsubmit="authenticate(event)"><div class="field"><label for="auth-email">Email</label><input id="auth-email" type="email" autocomplete="email" required></div><div class="field"><label for="auth-password">Password</label><input id="auth-password" type="password" autocomplete="current-password" minlength="8" required></div><div class="toolbar"><button class="btn" id="auth-button">Accedi</button><button type="button" class="btn secondary" onclick="authenticate(null,true)">Crea account</button></div><button type="button" class="link" onclick="resetPassword()">Password dimenticata?</button></form>`}<p class="muted">Usa l’account con l’email che l’admin ha associato al tuo giocatore. Un account da solo non dà accesso al gruppo.</p></div>`;
 $('footer').textContent='ChickenFutsal · Dati condivisi su Supabase · Accesso riservato ai membri';
}
function googleLogin(){chooseRemember();location.assign(apiBase+'/auth/v1/authorize?provider=google&redirect_to='+encodeURIComponent(location.origin+'/'))}
async function authenticate(e,signup=false){
 e?.preventDefault();if(busy)return;
 const email=$('#auth-email').value.trim(),password=$('#auth-password').value;
 if(!$('#auth-email').checkValidity()||password.length<8){toast('Inserisci email valida e password di almeno 8 caratteri');return}
 chooseRemember();busy=true;$('#auth-button').disabled=true;
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
 const options=state.seasonOptions||[{id:season||2026,name:String(season||2026)}];
 $('.top small').textContent=`Stagione ${seasonName()} · Il nostro gruppo`;
 $('#app').insertAdjacentHTML('afterbegin',`<div class="toolbar" style="margin-top:20px;margin-bottom:0"><select aria-label="Stagione" onchange="changeSeason(this.value)">${options.map(y=>`<option value="${y.id}" ${y.id===season?'selected':''}>${esc(y.name)}${y.closed_at?' · chiusa':' · attiva'}</option>`).join('')}</select><button class="btn small secondary" onclick="refreshView()">↻ Aggiorna</button><button class="btn small secondary" onclick="showNotifications()">♧ Avvisi ${state.notifications.filter(n=>!n.seen).length||''}</button>${admin()?'<button class="btn small" onclick="startSeason()">Inizia nuova stagione</button>':''}${online?'<button id="push-toggle" class="btn small secondary" onclick="togglePush()">'+(pushActive?'Disattiva notifiche':'Attiva notifiche')+'</button>':'<span class="badge">Demo locale</span>'}</div>${state.seasonInfo?.closed_at?'<div class="notice">Stagione chiusa · storico in sola lettura.</div>':''}`);
 $('.sidebar-bottom').innerHTML=`IL NOSTRO CAMPIONATO<br><b style="color:white">Stagione ${seasonName()}</b><br><br>Il giovedì non si prendono impegni.`;
};
async function changeSeason(value){if(!online)storeDemoTotals();season=+value;try{await reload()}catch(e){toast(e.message)}}
async function refreshView(){try{await reload();toast(online?'Dati aggiornati dal server':'Demo aggiornata')}catch(e){toast(e.message)}}
async function action(name,data,success){
 if(busy)return false;busy=true;
 try{
  if(online){const result=await rpc('club_action',{p_action:name,p_data:data});if(name==='season_start')season=result.id;}else demoAction(name,data);
  await reload();if(success)toast(success);return true;
 }catch(e){toast(e.message);return false}finally{busy=false}
}
save=function(){if(!online)localStorage.setItem('pollone-v1',JSON.stringify(state))};
function demoAction(name,d){
 if(['round_open','round_close','round_final'].includes(name)&&!admin())throw Error('Operazione riservata agli admin');
 const id=()=>{state.demoNextId=Math.max(Date.now(),(state.demoNextId||0)+1);return state.demoNextId};state.rounds??=[];state.demoBallots??={};
 if(state.seasonInfo?.closed_at&&['match','match_edit','result','match_cancel','round_open','round_close','round_final','vote'].includes(name))throw Error('Stagione chiusa: lo storico è consultabile');
 switch(name){
 case 'season_start':{if(!admin())throw Error('Operazione riservata agli admin');if(state.demoAllMatches.some(m=>m.season===state.activeSeason&&!m.done&&!m.cancelled))throw Error('Registra o annulla prima le partite in programma');storeDemoTotals();const old=state.seasonOptions.find(s=>s.id===state.activeSeason);old.closed_at=new Date().toISOString();captureDemoAwards(old.id);for(const r of state.rounds)if(r.season===old.id&&r.status==='open')r.status='closed';season=Math.max(...state.seasonOptions.map(s=>s.id))+1;state.seasonOptions.push({id:season,name:d.name,started_on:d.started_on,closed_at:null});state.activeSeason=season;break}

 case 'reminder_settings':if(!admin())throw Error('Operazione riservata agli admin');state.reminderSettings={...d};break;
 case 'ratings':p(d.id).ratings=d.ratings;break;
 case 'permission':p(d.id)[d.key]=d.value;break;
 case 'player_edit':{if(!admin())throw Error('Operazione riservata agli admin');const x=state.players.find(p=>p.id===d.id);if(!x)throw Error('Giocatore inesistente');if(d.occasional&&x.admin)throw Error('Un admin non può diventare occasionale');if(d.occasional){delete x.email;x.seeAll=false;}Object.assign(x,{name:d.name.trim(),role:d.role,occasional:d.occasional});break}
 case 'player_active':{if(!admin())throw Error('Operazione riservata agli admin');const x=p(d.id);if(!d.active&&x.admin)throw Error('Rimuovi prima il ruolo admin');if(!d.active&&state.demoAllMatches.some(m=>!m.done&&!m.cancelled&&[...m.a,...m.b].includes(d.id)))throw Error('Rimuovi prima dalle partite in programma');x.active=d.active;break}
 case 'player_restore':{if(!admin())throw Error('Operazione riservata agli admin');const x=state.deletedPlayers?.find(p=>p.id===d.id);if(!x)throw Error('Giocatore non recuperabile');const restored={...x.profile,admin:false,seeAll:false};delete restored.email;state.players.push(restored);state.deletedPlayers=state.deletedPlayers.filter(p=>p.id!==d.id);break}
 case 'player_delete':{if(d.id===user)throw Error('Non puoi eliminare il tuo profilo admin');if(state.matches.some(m=>!m.cancelled&&!m.done&&[...m.a,...m.b].includes(d.id)))throw Error('Annulla prima le partite in programma');state.deletedPlayers??=[];state.deletedPlayers.push({profile:structuredClone(p(d.id)),id:d.id,name:p(d.id).name,role:p(d.id).role,deletedAt:new Date().toISOString(),deletedBy:me().name});state.players=state.players.filter(x=>x.id!==d.id);state.notifications=state.notifications.filter(n=>!n.to?.includes(d.id));for(const r of state.rounds){r.candidates=r.candidates.filter(x=>x!==d.id);r.results=r.results.filter(x=>x.id!==d.id);r.count=r.results.reduce((s,x)=>s+x.count,0)}break}
 case 'player':state.players.push({id:Math.max(...state.players.map(x=>x.id))+1,name:d.name,role:d.role,email:d.email,occasional:!!d.occasional,admin:false,seeAll:false,goals:0,own:0,apps:0,ratings:[60,60,60,60,60,60]});break;
 case 'invite':p(d.id).email=d.email;p(d.id).occasional=false;break;
 case 'match_edit':{if(!admin())throw Error('Operazione riservata agli admin');const m=state.matches.find(m=>m.id===d.id);if(!m||m.cancelled)throw Error('Partita non modificabile');const ids=[...d.a,...d.b];if(d.a.length!==5||d.b.length!==5||new Set(ids).size!==10||ids.some(id=>!state.players.some(p=>p.id===id)))throw Error('Servono 10 giocatori distinti');const old=[...m.a,...m.b];if(m.result){for(const pid of old){const x=p(pid),r=m.result[pid];x.goals-=r.goals;x.own-=r.own;x.apps-=Number(r.present)}m.result=Object.fromEntries(ids.map(id=>[id,m.result[id]||{goals:0,own:0,present:false}]));for(const pid of ids){const x=p(pid),r=m.result[pid];x.goals+=r.goals;x.own+=r.own;x.apps+=Number(r.present)}}Object.assign(m,{date:d.date,time:d.time,field:d.field,a:d.a,b:d.b});delete m.score;state.notifications.push({id:id(),text:`Partita aggiornata: ${date(m.date)} alle ${m.time} · ${m.field}`,to:ids,seen:false,matchId:m.id});const removed=old.filter(id=>!ids.includes(id));if(removed.length)state.notifications.push({id:id(),text:'Convocazione revocata: non sei più tra i partecipanti della partita',to:removed,seen:false,matchId:m.id});break}
 case 'match':{let m={...d,id:id(),done:false};state.matches.push(m);state.notifications.push({id:id(),text:`Convocazione: ${date(m.date)} alle ${m.time} · ${m.field}`,to:[...m.a,...m.b],seen:false,matchId:m.id});break}
 case 'result':{let m=state.matches.find(x=>x.id===d.id);if(m.cancelled)throw Error('Partita annullata');for(const pid of [...m.a,...m.b]){let x=p(pid),prev=m.result?.[pid]||{goals:0,own:0,present:false},r=d.result[pid];x.goals+=r.goals-prev.goals;x.own+=r.own-prev.own;x.apps+=Number(r.present)-Number(prev.present)}m.result=d.result;m.done=true;break}
 case 'match_cancel':{let m=state.matches.find(x=>x.id===d.id);if(!m)throw Error('Partita inesistente');if(m.cancelled)throw Error('Partita già annullata');if(m.result)for(const pid of [...m.a,...m.b]){const x=p(pid),r=m.result[pid];x.goals-=r.goals;x.own-=r.own;x.apps-=Number(r.present)}m.cancelled=true;m.cancellationReason=d.reason;state.notifications.push({id:id(),text:`Partita annullata: ${date(m.date)} alle ${m.time} · ${m.field}${d.reason?' · '+d.reason:''}`,to:[...m.a,...m.b],seen:false,matchId:m.id});break}
 case 'round_open':{let rs=state.rounds.filter(r=>r.award===d.award&&r.season===season),last=rs.at(-1);if(last&&(last.status!=='closed'||last.turn===4))throw Error('Non puoi aprire un altro turno');state.rounds.push({id:id(),season,award:d.award,turn:last?last.turn+1:1,candidates:last?d.candidates:state.players.map(x=>x.id),status:'open',count:0,results:[]});break}
 case 'round_close':state.rounds.find(r=>r.id===d.id).status='closed';break;
 case 'round_final':state.rounds.find(r=>r.id===d.id).status='final';break;
 case 'vote':{let r=state.rounds.find(r=>r.id===d.round),key=`${r.id}:${user}`;if(r.status!=='open'||!r.candidates.includes(d.candidate))throw Error('Candidato o turno non valido');if(state.demoBallots[key])throw Error('Hai già votato');state.demoBallots[key]=true;r.count++;let count=r.results.find(x=>x.id===d.candidate);if(count)count.count++;else r.results.push({id:d.candidate,count:1});break}
 case 'seen':state.notifications.find(n=>n.id===d.id).seen=true;break;
 }
 save();
}

const legacyAwards=awards;
awards=function(){return legacyAwards().replaceAll('Stagione 2026',`Stagione ${seasonName()}`)+['pollone','bidone'].map(a=>{const r=currentRounds(a).at(-1);return r?.status==='final'?`<div class="notice"><strong>${a==='pollone'?'Pollone':'Bidone'} d’oro:</strong> ${winners(r)}</div>`:''}).join('')};pages.awards=awards;
function currentRounds(award){return (state.rounds||[]).filter(r=>r.award===award&&(!r.season||r.season===season)).sort((a,b)=>a.turn-b.turn)}
function hasVoted(r){return online?r.voted:!!state.demoBallots?.[`${r.id}:${user}`]}
function aggregate(r){
 const sorted=r.results.slice().sort((a,b)=>b.count-a.count);return sorted.map(x=>`<div class="row spread leader"><span>${esc(p(x.id).name)}</span><b>${x.count} ${x.count===1?'voto':'voti'}</b></div>`).join('')||'<p class="muted">Nessun voto ricevuto.</p>';
}
votes=function(){
 return heading('Il tuo voto fa la differenza','Da 1 a 4 turni per premio. I voti ripartono da zero a ogni turno.')+`<div class="notice">🔒 Le scelte individuali sono nascoste agli admin dell’app. Puoi votare te stesso se sei ancora candidato. Gli eliminati continuano a votare.${online?'':' In questa demo la segretezza è simulata.'}</div><div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr))">${['pollone','bidone'].map(award=>{
 const rs=currentRounds(award),r=rs.at(-1),title=award==='pollone'?'Pollone d’oro':'Bidone d’oro';
 return `<section class="card"><div class="award-icon">${award==='pollone'?'🌟':'🪣'}</div><h2>${title}</h2><p class="muted">${award==='pollone'?'Il miglior giocatore della stagione.':'Il bidone della stagione.'}</p>${!r?`<div class="notice">Votazione non ancora attivata da un admin.</div>${admin()?`<button class="btn" onclick="openFirstRound('${award}')">Attiva votazione · primo turno</button>`:''}`:`<span class="badge">Turno ${r.turn} / 4 · ${r.candidates.length} candidati · ${r.status==='open'?'Aperto':r.status==='final'?'Premio assegnato':'Chiuso'}</span><p class="muted">${r.count} schede ricevute</p>${r.status==='open'?(hasVoted(r)?'<div class="notice">✓ Hai già votato in questo turno.</div>':`<form onsubmit="castVote(event,${r.id})"><div class="field"><label for="vote-${r.id}">Scegli il tuo candidato</label><select id="vote-${r.id}" required><option value="">Scegli un giocatore</option>${r.candidates.map(id=>`<option value="${id}">${esc(p(id).name)}${id===user?' (tu)':''}</option>`).join('')}</select></div><button class="btn">Invia voto segreto</button></form>`)+`${admin()?`<p><button class="btn secondary" onclick="closeRound(${r.id})">Chiudi turno e mostra risultati</button></p>`:''}`:aggregate(r)+`${r.status==='final'?`<div class="notice">${winners(r)}</div>`:admin()?`<div class="toolbar" style="margin-top:20px">${r.turn<4?`<button class="btn" onclick="chooseCandidates(${r.id})">Apri turno ${r.turn+1}</button>`:''}<button class="btn secondary" ${!r.count&&r.candidates.length?'disabled':''} onclick="finalRound(${r.id})">Concludi il premio</button></div>`:''}`}`}${rs.length>1?`<details style="margin-top:25px"><summary>Storico dei turni precedenti</summary>${rs.slice(0,-1).map(old=>`<h3 style="margin-top:20px">Turno ${old.turn}</h3>${aggregate(old)}`).join('')}</details>`:''}</section>`
 }).join('')}</div><div class="notice">I risultati dell’ultimo turno determinano il vincitore. In caso di parità mostriamo tutti i primi a pari merito: fino al terzo turno puoi aprire uno spareggio come turno successivo.</div>`;
};pages.votes=votes;
function winners(r){if(state.seasonInfo?.closed_at&&state.closedAwards?.[r.award]){const names=state.closedAwards[r.award].map(w=>esc(w.name));return names.length>1?'Pari merito: '+names.join(', '):names.length?'Vincitore: '+names[0]:'Premio non assegnato'}if(!r.results.length)return 'Nessun vincitore: non sono rimaste schede valide.';let max=Math.max(...r.results.map(x=>x.count));let ws=r.results.filter(x=>x.count===max).map(x=>esc(p(x.id).name));return ws.length>1?'Pari merito: '+ws.join(', '):'Vincitore: '+ws.join('')}
async function openFirstRound(award){if(!admin())return toast('Solo un admin può attivare le votazioni');await action('round_open',{award,season},'Primo turno aperto: tutti i giocatori sono candidati')}
async function castVote(e,id){e.preventDefault();let value=$('#vote-'+id).value;if(value==='')return;await action('vote',{round:id,candidate:+value},'Voto segreto registrato')}
async function closeRound(id){modal('Chiudi il turno?',`<p>I voti diventano definitivi e i risultati aggregati saranno visibili al gruppo. Non potrai riaprire questo turno.</p><button class="btn" onclick="confirmCloseRound(${id})">Conferma chiusura</button>`)}
async function confirmCloseRound(id){if(await action('round_close',{id},'Turno chiuso'))$('#modal').close()}
function chooseCandidates(id){let r=state.rounds.find(r=>r.id===id);modal('Candidati del prossimo turno',`<p class="muted">Scegli quanti e quali candidati mantenere. I risultati precedenti sono un suggerimento; ogni voto del nuovo turno partirà da zero.</p><form onsubmit="startNextRound(event,${id})"><div class="checklist">${r.candidates.slice().sort((a,b)=>(r.results.find(x=>x.id===b)?.count||0)-(r.results.find(x=>x.id===a)?.count||0)).map(pid=>`<label class="check"><input type="checkbox" name="candidate" value="${pid}">${esc(p(pid).name)} · ${r.results.find(x=>x.id===pid)?.count||0} voti</label>`).join('')}</div><button class="btn">Apri turno ${r.turn+1}</button></form>`)}
async function startNextRound(e,id){e.preventDefault();let r=state.rounds.find(r=>r.id===id),candidates=[...document.querySelectorAll('[name=candidate]:checked')].map(x=>+x.value);if(!candidates.length)return toast('Seleziona almeno un candidato');if(await action('round_open',{season,award:r.award,candidates},'Nuovo turno aperto · voti azzerati'))$('#modal').close()}
function finalRound(id){modal('Concludi questo premio?',`<p>Il risultato di questo turno sarà il risultato finale. Non potrai aprire altri turni per questo premio nella stagione ${seasonName()}.</p><button class="btn" onclick="confirmFinal(${id})">Conferma assegnazione</button>`)}
async function confirmFinal(id){if(await action('round_final',{id},'Premio concluso'))$('#modal').close()}
saveRatings=async function(e,id){e.preventDefault();if(await action('ratings',{id,ratings:labels.map((_,i)=>+$('#r'+i).value)},'Valutazioni aggiornate'))$('#modal').close()};
permission=async function(id,key,value){await action('permission',{id,key,value},'Permessi aggiornati')};
addPlayer=function(){if(!admin())return;modal('Un nuovo compagno di squadra',`<form onsubmit="savePlayer(event)"><div class="field"><label for="new-name">Nome e cognome</label><input id="new-name" maxlength="60" required></div><div class="field"><label for="new-role">Ruolo</label><select id="new-role"><option>Attaccante</option><option>Regista</option><option>Difensore</option><option>Portiere</option></select></div><div class="field"><label for="new-kind">Tipo di giocatore</label><select id="new-kind" onchange="choosePlayerKind()"><option value="member">Membro del gruppo</option><option value="guest">Occasionale, senza account</option></select></div><div class="field" id="new-email-field"><label for="new-email">Email per l’accesso (facoltativa)</label><input id="new-email" type="email" autocomplete="off"></div><p class="muted" id="new-kind-description">Puoi associare l’email ora o in seguito. Nessuna email di invito viene inviata automaticamente.</p><button class="btn">Aggiungi giocatore</button></form>`)};
savePlayer=async function(e){e.preventDefault();if(await action('player',{name:$('#new-name').value.trim(),role:$('#new-role').value,email:$('#new-kind').value==='guest'?'':$('#new-email').value.trim(),occasional:$('#new-kind').value==='guest'},'Giocatore aggiunto'))$('#modal').close()};
confirmMatch=async function(){if(!draft)return;const data={...draft,season};if(await action('match',data,online?'Partita salvata · avvisi creati per i 10 convocati':'Partita creata · notifiche simulate')){draft=null;$('#modal').close();go('matches')}};
saveResult=async function(e,id){e.preventDefault();let m=state.matches.find(x=>x.id===id),result={};for(const pid of [...m.a,...m.b]){let r={goals:+$('#g'+pid).value,own:+$('#o'+pid).value,present:$('#p'+pid).checked};if(!Number.isInteger(r.goals)||!Number.isInteger(r.own)||r.goals<0||r.own<0||r.goals>99||r.own>99)return toast('Inserisci numeri interi da 0 a 99');if(!r.present&&(r.goals||r.own))return toast('Un assente non può segnare');result[pid]=r}if(await action('result',{id,result},'Risultato salvato · statistiche ricalcolate'))$('#modal').close()};
const legacySettings=settings;
settings=function(){return (admin()?'<div class="card" style="margin-bottom:20px"><h3>Notifiche sul telefono</h3><p>Configura il servizio di invio su Supabase. Ogni partecipante dovrà poi premere Attiva notifiche sul proprio dispositivo.</p><a class="btn" href="/push-setup.html" target="_blank" rel="noopener">Configura notifiche push</a></div>':'')+legacySettings().replace('Notifiche simulate',online?'I tuoi avvisi':'Notifiche simulate')+ (admin()?`<div class="card" style="margin-top:20px"><h3>Accesso dei giocatori</h3><p class="muted">Associa l’email con cui ciascun amico creerà il proprio account. Nessuna email di invito viene inviata da questa schermata.</p>${sortedPlayers().map(x=>`<div class="row spread leader"><div><strong>${esc(x.name)}${x.active===false?' · Disattivato':''}</strong><small class="muted">${esc(x.email||(x.occasional?'Occasionale · senza account':'Nessuna email associata'))}</small></div><div><button class="btn small secondary" onclick="setPlayerActive(${x.id},${x.active===false})">${x.active===false?'Riattiva':'Disattiva'}</button> <button class="btn small secondary" onclick="invitePlayer(${x.id})">${x.occasional?'Abilita account':'Associa email'}</button></div></div>`).join('')}</div>`:'')};pages.settings=settings;
function choosePlayerKind(){const guest=$('#new-kind').value==='guest';$('#new-email-field').hidden=guest;$('#new-email').disabled=guest;if(guest)$('#new-email').value='';$('#new-kind-description').textContent=guest?'Partecipa alle partite e ha statistiche ed esagono. Non ha accesso al sito e non riceve notifiche.':'Puoi associare l’email ora o in seguito. Nessuna email di invito viene inviata automaticamente.'}
function invitePlayer(id){modal('Accesso · '+esc(p(id).name),`<form onsubmit="saveInvite(event,${id})"><div class="field"><label for="invite-email">Email del giocatore</label><input id="invite-email" type="email" value="${esc(p(id).email||'')}" required></div><button class="btn">Salva email</button></form>`)}
async function saveInvite(e,id){e.preventDefault();if(await action('invite',{id,email:$('#invite-email').value.trim()},'Email associata'))$('#modal').close()}
function showNotifications(){let ns=online?state.notifications:state.notifications.filter(n=>n.to.includes(user));modal('I tuoi avvisi',ns.map(n=>`<div class="leader"><p>${esc(n.text)}</p><div class="toolbar">${n.matchId?`<button class="btn small secondary" onclick="showMatch(${n.matchId})">Vedi partita</button>`:''}${!n.seen?`<button class="btn small secondary" onclick="markSeen(${n.id})">Segna come letto</button>`:'<span class="badge">Letto</span>'}</div></div>`).join('')||'<p class="muted">Nessun avviso per te.</p>')}
async function markSeen(id){if(await action('seen',{id}))showNotifications()}
async function deviceSubscription(){
 if(!('serviceWorker' in navigator)||!('PushManager' in window))return null;
 const reg=await navigator.serviceWorker.getRegistration('/');return reg?await reg.pushManager.getSubscription():null;
}
async function syncPushState(){
 pushActive=false;
 try{const sub=await deviceSubscription();if(sub&&Notification.permission==='granted'){const status=await rpc('club_device_push',{p_endpoint:sub.endpoint});pushActive=status.active===true}}catch{}
}
async function togglePush(){
 if(pushBusy)return;pushBusy=true;const button=$('#push-toggle');if(button)button.disabled=true;
 try{await syncPushState();if(pushActive)await disablePush();else await enablePush()}finally{pushBusy=false;if($('#push-toggle'))$('#push-toggle').disabled=false}
}
async function disablePush(){
 try{const sub=await deviceSubscription();if(sub){await rpc('club_device_push',{p_endpoint:sub.endpoint,p_disable:true});if(!await sub.unsubscribe())throw Error('Registrazione rimossa dal sito. Riprova per disattivarla anche nel browser.')}
 await syncPushState();render();toast('Notifiche disattivate su questo dispositivo');
 }catch(e){await syncPushState();render();toast(e.message)}
}
async function enablePush(){
 if(!online)return toast('Le notifiche push richiedono l’accesso al sito condiviso');
 if(!config.vapidPublicKey){try{const push=await rpc('club_push_config');config.vapidPublicKey=push.publicKey||''}catch{}}
 if(!config.vapidPublicKey)return toast('Configurazione push da completare: un admin trova la guida nelle Impostazioni.');
 if(!('serviceWorker' in navigator)||!('PushManager' in window))return toast('Dispositivo non compatibile. Su iPhone aggiungi prima il sito alla Home.');
 try{
  const permission=await Notification.requestPermission();if(permission!=='granted')return toast('Consenso alle notifiche non concesso');
  const registration=await navigator.serviceWorker.register('/sw.js');
  const reg=registration.active?registration:await navigator.serviceWorker.ready;
  const raw=atob(config.vapidPublicKey.replace(/-/g,'+').replace(/_/g,'/'));const key=Uint8Array.from(raw,c=>c.charCodeAt(0));
  const sub=await reg.pushManager.getSubscription()||await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
  if(await action('push_subscribe',{subscription:sub.toJSON()},'Notifiche attivate su questo dispositivo')){await syncPushState();render()}
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

function cancelMatch(id){
 if(!admin())return;const m=state.matches.find(x=>x.id===id);if(!m||m.cancelled)return;
 modal('Annulla la partita?',`<p>${date(m.date)} · ${m.time} · ${esc(m.field)}</p><div class="notice">La partita resterà nello storico come annullata. ${m.done?'Gol, autogol e presenze di questa partita saranno esclusi dalle statistiche. ':''}I convocati con un account riceveranno un avviso nel sito e una notifica push se attiva. Gli occasionali vanno avvisati direttamente.</div><form onsubmit="confirmCancellation(event,${id})"><div class="field"><label for="cancellation-reason">Motivo (facoltativo)</label><input id="cancellation-reason" maxlength="200" placeholder="Es. campo non disponibile"></div><div class="modal-actions"><button type="button" class="btn secondary" onclick="document.querySelector('#modal').close()">Torna indietro</button><button class="btn">Conferma annullamento</button></div></form>`);
}
async function confirmCancellation(e,id){e.preventDefault();if(await action('match_cancel',{id,reason:$('#cancellation-reason').value.trim()},'Partita annullata · statistiche aggiornate'))$('#modal').close()}

function deletePlayer(id){
 if(!admin()||id===user)return;let x=p(id);
 modal('Elimina giocatore dalla rosa',`<p>Stai eliminando <strong>${esc(x.name)}</strong>.</p><div class="notice">Il giocatore verrà rimosso dalla rosa e il profilo sarà conservato per il recupero in Gestione. Email associata, avvisi e voti espressi o ricevuti saranno rimossi. I risultati delle votazioni saranno aggiornati. I premi già salvati nell’albo d’oro conserveranno il nome del vincitore. Le partite passate conserveranno il tabellino con “Giocatore eliminato”, senza alterare i risultati o le statistiche degli altri. L’accesso al gruppo verrà revocato. Prima devi annullare le eventuali partite in programma in cui è convocato.</div><form onsubmit="confirmPlayerDeletion(event,${id})"><div class="field"><label for="delete-player-confirm">Scrivi ELIMINA per confermare</label><input id="delete-player-confirm" autocomplete="off" required pattern="ELIMINA"></div><div class="modal-actions"><button type="button" class="btn secondary" onclick="document.querySelector('#modal').close()">Torna indietro</button><button class="btn">Elimina definitivamente</button></div></form>`);
}
async function confirmPlayerDeletion(e,id){e.preventDefault();if($('#delete-player-confirm').value!=='ELIMINA')return;if(await action('player_delete',{id},'Giocatore eliminato · accesso revocato'))$('#modal').close()}

function seasonName(){return esc(state.seasonOptions?.find(s=>s.id===season)?.name||String(season||2026))}
function startSeason(){if(!admin())return;modal('Inizia nuova stagione',`<div class="notice">Chiuderai automaticamente la stagione attiva. Statistiche, partite e voti resteranno nello storico. I vincitori dei cinque premi verranno salvati definitivamente nell’albo d’oro; i premi a votazione non conclusi resteranno non assegnati. I turni aperti verranno chiusi senza assegnare automaticamente i premi. Registra o annulla prima le partite ancora in programma.</div><form onsubmit="confirmSeasonStart(event)"><div class="field"><label for="season-name">Nome della nuova stagione</label><input id="season-name" placeholder="Es. 2026/2027" maxlength="60" required></div><div class="field"><label for="season-date">Data d’inizio</label><input id="season-date" type="date" value="${new Date().toISOString().slice(0,10)}" required></div><button class="btn">Chiudi precedente e inizia nuova stagione</button></form>`)}
async function confirmSeasonStart(e){e.preventDefault();if(await action('season_start',{name:$('#season-name').value.trim(),started_on:$('#season-date').value,previous:state.activeSeason},'Nuova stagione iniziata'))$('#modal').close()}
function updateDemoSeason(){
 if(!state.seasonOptions){season=2026;state.activeSeason=season;state.seasonOptions=[{id:season,name:'2025/2026',started_on:'2026-01-01',closed_at:null}];for(const m of state.matches)m.season??=season;for(const r of state.rounds||[])r.season??=season;state.demoAllMatches=state.matches;state.demoBaseline=Object.fromEntries(state.players.map(p=>[p.id,{goals:p.goals,own:p.own,apps:p.apps}]))}
 for(const option of state.seasonOptions)if(option.id===2026&&option.name==='2026')option.name='2025/2026';
 season??=state.activeSeason;state.seasonInfo=state.seasonOptions.find(s=>s.id===season);
 // Keep the complete calendar while displaying one season.
 for(const m of state.matches)if(!state.demoAllMatches.some(x=>x.id===m.id))state.demoAllMatches.push(m);
 state.matches=state.demoAllMatches.filter(m=>m.season===season);
 for(const p of state.players){if(state.demoDisplayedSeason===season)continue;const base=state.demoSeasonTotals?.[season]?.[p.id]||(season===2026?state.demoBaseline[p.id]:null);p.goals=base?.goals||0;p.own=base?.own||0;p.apps=base?.apps||0;}
 updateDemoResults();
 for(const option of state.seasonOptions.filter(s=>s.closed_at))captureDemoAwards(option.id);
 state.closedAwards=state.demoArchives?.[season]?.awards||{};
 state.hallOfFame=Object.values(state.demoArchives||{}).sort((a,b)=>b.season-a.season);
 state.demoDisplayedSeason=season;save();
}
if(!online){updateDemoSeason();render()}

function storeDemoTotals(){state.demoSeasonTotals??={};state.demoSeasonTotals[season]=Object.fromEntries(state.players.map(p=>[p.id,{goals:p.goals,own:p.own,apps:p.apps}]))}

function editMatch(id){if(!admin()||state.seasonInfo?.closed_at)return;const m=state.matches.find(m=>m.id===id);if(!m||m.cancelled)return;modal('Modifica partita',`<form onsubmit="saveMatchDetails(event,${id})"><div class="form-grid"><div class="field"><label for="edit-match-date">Data</label><input id="edit-match-date" type="date" value="${m.date}" required></div><div class="field"><label for="edit-match-time">Ora</label><input id="edit-match-time" type="time" value="${m.time}" required></div></div><div class="field"><label for="edit-match-field">Campo</label><input id="edit-match-field" maxlength="100" value="${esc(m.field)}" required></div><div class="teams">${['a','b'].map((team,i)=>`<div class="team ${i?'b':''}"><h3>${i?'BIANCHI':'NERI'}</h3>${m[team].map((pid,slot)=>`<div class="field"><label for="edit-${team}${slot}">Giocatore ${slot+1}</label><select id="edit-${team}${slot}" required>${!state.players.some(p=>p.id===pid)?'<option value="">Sostituisci giocatore eliminato</option>':''}${state.players.filter(p=>m.done||p.active!==false).map(p=>`<option value="${p.id}" ${pid===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select></div>`).join('')}</div>`).join('')}</div><div class="notice">Seleziona 10 giocatori distinti. Le modifiche saranno comunicate ai convocati con un account, compresi quelli rimossi.${m.done?' Il tabellino dei giocatori mantenuti verrà conservato. Quelli rimossi non contribuiranno più alle statistiche; i nuovi saranno inizialmente segnati assenti con zero gol. Dopo il salvataggio correggi il risultato se necessario.':''}</div><button class="btn">Salva modifiche</button></form>`)}
async function saveMatchDetails(e,id){e.preventDefault();const a=Array.from({length:5},(_,i)=>+$('#edit-a'+i).value),b=Array.from({length:5},(_,i)=>+$('#edit-b'+i).value);if(new Set([...a,...b]).size!==10)return toast('Seleziona 10 giocatori distinti');if(await action('match_edit',{id,date:$('#edit-match-date').value,time:$('#edit-match-time').value,field:$('#edit-match-field').value.trim(),a,b},'Partita aggiornata · avvisi creati'))showMatch(id)}

// Compare all 126 distinct five-versus-five splits. Goalkeeper distribution takes priority.
function balanceTeams(ids){
 if(ids.length!==10||new Set(ids).size!==10)throw Error('Servono 10 giocatori distinti');
 const sorted=ids.slice().sort((a,b)=>a-b),roles=['Attaccante','Regista','Difensore'];let best;
 const evaluate=a=>{const b=sorted.filter(id=>!a.includes(id)),count=(team,role)=>team.filter(id=>p(id).role===role).length;
  const keeperGap=Math.abs(count(a,'Portiere')-count(b,'Portiere'));
  const levelGap=Math.abs(a.reduce((s,id)=>s+overall(p(id)),0)-b.reduce((s,id)=>s+overall(p(id)),0));
  const roleGap=roles.reduce((s,role)=>s+Math.abs(count(a,role)-count(b,role)),0);
  const cost=[keeperGap,levelGap+8*roleGap,levelGap];
  if(!best||cost.some((v,i)=>v<best.cost[i]&&cost.slice(0,i).every((x,j)=>x===best.cost[j])))best={a:a.slice(),b,cost};
 };
 const choose=(start,a)=>{if(a.length===5)return evaluate(a);for(let i=start;i<=sorted.length-(5-a.length);i++){a.push(sorted[i]);choose(i+1,a);a.pop()}};
 choose(1,[sorted[0]]);return {a:best.a,b:best.b};
}
function manualTeamEditor(){if(!admin())return;modal('Assegna le squadre',`<p>Scegli cinque NERI e cinque BIANCHI.</p><form onsubmit="applyManualTeams(event)">${draft.ids.map(id=>`<div class="field"><label for="manual-team-${id}">${esc(p(id).name)} · ${esc(p(id).role)} · ${overall(p(id))} OVR</label><select id="manual-team-${id}" required><option value="">Scegli squadra</option><option value="a">NERI</option><option value="b">BIANCHI</option></select></div>`).join('')}<button class="btn">Anteprima formazioni →</button></form>`)}
function applyManualTeams(e){e.preventDefault();if(!admin())return;const a=draft.ids.filter(id=>$('#manual-team-'+id).value==='a'),b=draft.ids.filter(id=>$('#manual-team-'+id).value==='b');if(a.length!==5||b.length!==5)return toast('Assegna cinque giocatori ai NERI e cinque ai BIANCHI');Object.assign(draft,{a,b});teamEditor()}
function extraStats(x){return `<div class="metrics" style="grid-template-columns:repeat(3,1fr)">${[['VITTORIE',x.wins||0],['PAREGGI',x.draws||0],['SCONFITTE',x.losses||0],['% VITTORIE',x.apps?Number(x.winRate||0).toFixed(1)+'%':'—'],['GOL / PRESENZA',x.apps?(x.goals/x.apps).toFixed(2):'—']].map(([label,value])=>`<div class="metric"><small>${label}</small><strong>${value}</strong></div>`).join('')}</div>`}
const prizeLabels=[['goals','👟','Scarpa d’oro'],['pollone','🌟','Pollone d’oro'],['bidone','🪣','Bidone d’oro'],['own','🏆','Coppa Jumbo'],['apps','🏅','4 Pollari']];
function frozenAwardCards(awards){return `<div class="grid">${prizeLabels.map(([key,icon,title])=>{const winners=awards?.[key]||[];return `<article class="card"><div class="award-icon">${icon}</div><h2>${title}</h2><p><strong>${winners.map(w=>esc(w.name)).join(' · ')||'Non assegnato'}</strong></p>${winners.length>1?'<span class="badge">Pari merito</span>':''}</article>`}).join('')}</div>`}
function hallOfFame(){const history=state.hallOfFame||[];return heading('Albo d’oro','I vincitori di tutte le stagioni chiuse, visibili a tutto il gruppo.')+(history.length?history.map(s=>`<section style="margin-bottom:30px"><h2 style="margin-bottom:18px">Stagione ${esc(s.name)}</h2>${frozenAwardCards(s.awards)}</section>`).join(''):'<div class="card empty">Nessuna stagione chiusa. I vincitori verranno salvati alla chiusura della prima stagione.</div>')}
pages.hall=hallOfFame;navigation.splice(navigation.findIndex(n=>n[0]==='votes'),0,['hall','🏆','Albo d’oro']);
const currentAwardsPage=awards;
awards=function(){if(state.seasonInfo?.closed_at&&state.closedAwards)return heading('La bacheca dei premi',`Stagione ${seasonName()} · Vincitori salvati alla chiusura.`)+frozenAwardCards(state.closedAwards)+`<p><button class="btn secondary" onclick="go('hall')">Apri l’albo d’oro →</button></p>`;return currentAwardsPage()+`<p><button class="btn secondary" onclick="go('hall')">Apri l’albo d’oro →</button></p>`};pages.awards=awards;

if(!online)render();

function updateDemoResults(){
 for(const x of state.players){x.wins=0;x.draws=0;x.losses=0;
  for(const m of state.matches){const r=m.result?.[x.id];if(m.cancelled||!m.done||!r?.present)continue;const [a,b]=resultScore(m),ours=m.a.includes(x.id)?a:b,theirs=m.a.includes(x.id)?b:a;x[ours===theirs?'draws':ours>theirs?'wins':'losses']++}
  x.winRate=x.apps?100*x.wins/x.apps:0;x.goalAverage=x.apps?x.goals/x.apps:0;
 }
}
function captureDemoAwards(sid){
 state.demoArchives??={};if(state.demoArchives[sid])return;
 const option=state.seasonOptions.find(s=>s.id===sid),totals=state.demoSeasonTotals?.[sid]||(sid===2026?state.demoBaseline:{}),awards={};
 for(const key of ['goals','own','apps']){const max=Math.max(0,...state.players.map(p=>totals?.[p.id]?.[key]||0));awards[key]=max?state.players.filter(p=>totals?.[p.id]?.[key]===max).map(p=>({id:p.id,name:p.name})):[]}
 for(const key of ['pollone','bidone']){const r=state.rounds?.filter(r=>r.season===sid&&r.award===key).sort((a,b)=>a.turn-b.turn).at(-1),max=r?.status==='final'?Math.max(0,...r.results.map(r=>r.count)):0;awards[key]=max?r.results.filter(r=>r.count===max).map(r=>({id:r.id,name:p(r.id).name})):[]}
 state.demoArchives[sid]={season:sid,name:option.name,closedAt:option.closed_at,awards};
}

const reminderDefaults={participant_enabled:true,first_enabled:true,first_hours:8,second_enabled:true,second_hours:1,result_enabled:true,match_duration_minutes:60,result_delay_hours:1,result_repeat_enabled:false,result_repeat_hours:24,result_max_reminders:3};
function reminderSettingsForm(){const r={...reminderDefaults,...state.reminderSettings};const check=(key,label)=>`<label class="check"><input type="checkbox" id="reminder-${key}" ${r[key]?'checked':''}>${label}</label>`;const number=(key,label,min,max,step=1)=>`<div class="field"><label for="reminder-${key}">${label}</label><input id="reminder-${key}" type="number" min="${min}" max="${max}" step="${step}" required value="${r[key]}"></div>`;return `<section class="card" style="margin-top:20px"><h3>Promemoria automatici</h3><p class="muted">Gli orari delle partite sono interpretati nel fuso italiano, anche durante l’ora legale. Gli occasionali senza account vanno avvisati direttamente.</p><form onsubmit="saveReminderSettings(event)">${check('participant_enabled','Attiva promemoria ai convocati')}<div class="form-grid" style="margin-top:16px"><div>${check('first_enabled','Primo promemoria')}${number('first_hours','Ore prima della partita',0.25,168,0.25)}</div><div>${check('second_enabled','Secondo promemoria')}${number('second_hours','Ore prima della partita',0.25,168,0.25)}</div></div><p class="muted">Se entrambi sono attivi, il primo deve precedere il secondo. Un promemoria il cui orario è già passato quando crei o sposti la partita viene saltato.</p><hr style="border:0;border-top:1px solid var(--line);margin:20px 0">${check('result_enabled','Avvisa gli admin se manca il risultato')}<div class="form-grid" style="margin-top:16px">${number('match_duration_minutes','Durata prevista della partita (minuti)',15,240)}${number('result_delay_hours','Ore dopo la fine prevista prima del promemoria',0,168,0.25)}</div>${check('result_repeat_enabled','Ripeti il promemoria finché manca il risultato')}<div class="form-grid" style="margin-top:16px">${number('result_repeat_hours','Intervallo tra i promemoria ripetuti (ore)',1,168)}${number('result_max_reminders','Numero massimo di promemoria agli admin',1,20)}</div><div class="notice">La durata serve solo a calcolare il promemoria, non cambia l’evento nel calendario. Con i valori iniziali, gli admin vengono avvisati due ore dopo l’inizio e una sola volta. I promemoria si fermano quando registri il risultato, annulli la partita o chiudi la stagione. L’invio automatico richiede il servizio push configurato e può arrivare con circa cinque minuti di ritardo.</div><button class="btn">Salva promemoria</button></form></section>`}
async function saveReminderSettings(e){e.preventDefault();if(!admin())return;const data={};for(const [key,value]of Object.entries(reminderDefaults))data[key]=typeof value==='boolean'?$('#reminder-'+key).checked:Number($('#reminder-'+key).value);if(data.participant_enabled&&data.first_enabled&&data.second_enabled&&data.first_hours<=data.second_hours)return toast('Il primo promemoria deve avere un anticipo maggiore del secondo');const bounds={first_hours:[0.25,168],second_hours:[0.25,168],match_duration_minutes:[15,240],result_delay_hours:[0,168],result_repeat_hours:[1,168],result_max_reminders:[1,20]};if(Object.entries(bounds).some(([key,[min,max]])=>!Number.isFinite(data[key])||data[key]<min||data[key]>max)||!Number.isInteger(data.match_duration_minutes)||!Number.isInteger(data.result_max_reminders))return toast('Controlla gli intervalli dei promemoria');await action('reminder_settings',data,'Impostazioni promemoria salvate')}
const settingsWithAccess=settings;settings=function(){return settingsWithAccess()+(admin()?reminderSettingsForm():'')};pages.settings=settings;
if(!online){state.reminderSettings??={...reminderDefaults};render()}

function editPlayer(id){if(!admin())return;const x=p(id);modal('Modifica giocatore',`<form onsubmit="savePlayerDetails(event,${id})"><div class="field"><label for="edit-player-name">Nome e cognome</label><input id="edit-player-name" maxlength="60" required value="${esc(x.name)}"></div><div class="field"><label for="edit-player-role">Ruolo</label><select id="edit-player-role">${['Attaccante','Regista','Difensore','Portiere'].map(role=>`<option ${role===x.role?'selected':''}>${role}</option>`).join('')}</select></div><div class="field"><label for="edit-player-kind">Tipo di giocatore</label><select id="edit-player-kind" onchange="playerKindChanged(${id})"><option value="member" ${!x.occasional?'selected':''}>Membro del gruppo</option><option value="guest" ${x.occasional?'selected':''} ${x.admin?'disabled':''}>Occasionale, senza account</option></select></div><div class="notice" id="edit-player-kind-info">${x.admin?'Un admin deve restare membro del gruppo. ':''}Statistiche, valutazioni e partecipazioni alle partite vengono conservate. I nomi dei vincitori già salvati nell’albo d’oro restano quelli archiviati.</div><label class="check" id="edit-player-revoke" hidden><input id="edit-player-revoke-confirm" type="checkbox">Confermo la revoca dell’accesso al gruppo e delle notifiche su questo account.</label><div class="modal-actions"><button class="btn">Salva giocatore</button></div></form>`)}
function playerKindChanged(id){const x=p(id),guest=$('#edit-player-kind').value==='guest',revoke=guest&&!x.occasional&&!!x.email;$('#edit-player-revoke').hidden=!revoke;$('#edit-player-revoke-confirm').required=revoke;$('#edit-player-kind-info').textContent=guest?'Diventerà occasionale: l’email e i permessi di accesso verranno rimossi e le notifiche push disattivate. Statistiche, valutazioni, partite e voti già espressi resteranno conservati.':x.occasional?'Diventerà membro del gruppo. Per consentirgli di accedere, associa poi la sua email da Gestione. Tutte le statistiche vengono conservate.':'Il giocatore rimane membro del gruppo. Email e permessi vengono mantenuti, insieme a statistiche, valutazioni e partite.'}
async function savePlayerDetails(e,id){e.preventDefault();if(!admin())return;const x=p(id),occasional=$('#edit-player-kind').value==='guest';if(occasional&&x.admin)return toast('Rimuovi prima il ruolo admin da Gestione');if(occasional&&!x.occasional&&x.email&&!$('#edit-player-revoke-confirm').checked)return toast('Conferma la revoca dell’accesso al gruppo');const name=$('#edit-player-name').value.trim();if(!name||name.length>60)return toast('Inserisci un nome da 1 a 60 caratteri');if(await action('player_edit',{id,name,role:$('#edit-player-role').value,occasional},'Giocatore aggiornato'))profile(id)}

const historyLabels={match:'Partita creata',match_edit:'Partita modificata',match_cancel:'Partita annullata',result:'Tabellino aggiornato',ratings:'Valutazioni aggiornate',player:'Giocatore aggiunto',player_edit:'Giocatore modificato',player_active:'Stato giocatore aggiornato',player_delete:'Giocatore eliminato',player_restore:'Giocatore recuperato',permission:'Permessi aggiornati',invite:'Email associata',season_start:'Nuova stagione',round_open:'Turno aperto',round_close:'Turno chiuso',round_final:'Premio assegnato',reminder_settings:'Promemoria aggiornati'};
function adminHistoryPanel(){const h=state.adminHistory||{changes:state.demoChanges||[],deletedPlayers:state.deletedPlayers||[]};return `<section class="card" style="margin-top:20px"><h3>Registro delle modifiche</h3><p class="muted">Ultime 200 operazioni. Il registro non contiene scelte di voto individuali.</p>${h.changes.length?h.changes.map(a=>`<div class="leader"><strong>${esc(historyLabels[a.action]||a.action)}</strong><small>${esc(a.actor_name)} · ${new Date(a.created_at).toLocaleString('it-IT',{timeZone:'Europe/Rome'})}${a.subject?' · '+esc(a.subject):''}</small>${a.details&&Object.values(a.details).some(Boolean)?`<details><summary>Prima e dopo</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px">${formatHistoryDetails(a.details)}</pre></details>`:''}</div>`).join(''):'<p class="muted">Nessuna modifica registrata.</p>'}</section><section class="card" style="margin-top:20px"><h3>Giocatori eliminati</h3><p class="muted">Il recupero ripristina profilo, valutazioni e statistiche dalle partite conservate. Voti eliminati e accesso al gruppo non vengono ripristinati: associa nuovamente l’email, se necessaria.</p>${h.deletedPlayers.map(p=>`<div class="row spread leader"><div><strong>${esc(p.name)}</strong><small>${esc(p.role)} · eliminato da ${esc(p.deletedBy)}</small></div><button class="btn small secondary" onclick="restorePlayer(${p.id})">Recupera</button></div>`).join('')||'<p class="muted">Nessun giocatore recuperabile.</p>'}</section>`}
function restorePlayer(id){if(!admin())return;modal('Recupera giocatore',`<p>Il profilo e le statistiche torneranno nella rosa. L’email e i permessi vanno associati nuovamente; i voti eliminati non vengono recuperati.</p><button class="btn" onclick="confirmPlayerRestore(${id})">Conferma recupero</button>`)}
async function confirmPlayerRestore(id){if(await action('player_restore',{id},'Giocatore recuperato'))$('#modal').close()}
const settingsWithReminders=settings;settings=function(){return settingsWithReminders()+(admin()?adminHistoryPanel():'')};pages.settings=settings;
if(!online)render();

function formatHistoryDetails(details){const describe=x=>{if(!x)return '—';const rows=[];if(x.name)rows.push('Giocatore: '+x.name);if(x.role)rows.push('Ruolo: '+x.role);if(typeof x.active==='boolean')rows.push('Stato giocatore: '+(x.active?'Attivo':'Disattivato'));if(typeof x.occasional==='boolean')rows.push('Tipo: '+(x.occasional?'Occasionale':'Membro'));if(x.match_date||x.date)rows.push('Data: '+(x.match_date||x.date));if(x.match_time||x.time)rows.push('Ora: '+(x.match_time||x.time));if(x.field)rows.push('Campo: '+x.field);if(x.match_date||x.date)rows.push('Stato: '+(x.cancelled_at||x.cancelled?'Annullata':x.result?'Conclusa':'In programma'));if(x.cancellation_reason||x.cancellationReason)rows.push('Motivo annullamento: '+(x.cancellation_reason||x.cancellationReason));for(const [key,title]of [['team_a','NERI'],['team_b','BIANCHI'],['a','NERI'],['b','BIANCHI']])if(x[key])rows.push(title+': '+x[key].map(id=>p(id).name).join(', '));if(x.ratings)rows.push('Valutazioni: '+labels.map((label,i)=>label+' '+x.ratings[i]).join(' · '));if(x.result)rows.push('Tabellino: '+Object.entries(x.result).map(([id,r])=>p(id).name+': '+r.goals+' gol, '+r.own+' autogol, '+(r.present?'presente':'assente')).join('; '));if(typeof x.is_admin==='boolean')rows.push('Admin: '+(x.is_admin?'sì':'no'));if(typeof x.see_all==='boolean')rows.push('Statistiche di tutti: '+(x.see_all?'sì':'no'));if(x.email)rows.push('Email: '+x.email);return rows.join('\n')||'—'};return esc('Prima\n'+describe(details.before)+'\n\nDopo\n'+describe(details.after))}
const demoActionWithoutHistory=demoAction;
demoAction=function(name,data){const allowed=!!historyLabels[name],actor=me().name;let before=null;if(['match_edit','match_cancel','result'].includes(name))before=structuredClone(state.matches.find(m=>m.id===data.id)||null);else if(['ratings','player_edit','player_active','player_delete','permission','invite'].includes(name))before=structuredClone(state.players.find(p=>p.id===data.id)||null);demoActionWithoutHistory(name,data);if(allowed){let after=null;if(['match_edit','match_cancel','result'].includes(name))after=structuredClone(state.matches.find(m=>m.id===data.id)||null);else if(['ratings','player_edit','player_active','player_restore'].includes(name))after=structuredClone(state.players.find(p=>p.id===data.id)||null);state.demoChanges??=[];state.demoChanges.unshift({action:name,actor_name:actor,created_at:new Date().toISOString(),subject:before?.name||after?.name||'',details:{before,after}});state.demoChanges=state.demoChanges.slice(0,200);save()}};

function rosterPlayers(){return state.players.filter(p=>p.active!==false||p.hasPresence||p.apps>0)}
function setPlayerActive(id,active){if(!admin())return;const x=p(id);modal(active?'Riattiva giocatore':'Disattiva giocatore',`<p>${esc(x.name)}</p><div class="notice">${active?'Il giocatore tornerà disponibile per le convocazioni. Se ha un’email associata potrà accedere nuovamente; dovrà riattivare le notifiche sul dispositivo.':'Il giocatore non potrà accedere né essere convocato. Il profilo e tutte le statistiche restano conservati. In rosa sarà visibile solo nelle stagioni con almeno una presenza. Rimuovilo prima dalle partite in programma; se è admin, rimuovi prima quel ruolo.'}</div><button class="btn" onclick="confirmPlayerActive(${id},${active})">Conferma</button>`)}
async function confirmPlayerActive(id,active){if(await action('player_active',{id,active},active?'Giocatore riattivato':'Giocatore disattivato'))$('#modal').close()}
if(!online)render();
