const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
function harness(online=false,mem={},tab={}){
 let identityRemoved=false;const nodes={};const n=id=>nodes[id]??={value:'',checked:false,innerHTML:'',disabled:false,insertAdjacentHTML(where,s){this.innerHTML=s+this.innerHTML},addEventListener(){},close(){},showModal(){},textContent:'',checkValidity(){return true}};
 const identity=n('.identity');let identityHTML='';Object.defineProperty(identity,'innerHTML',{get(){return identityHTML},set(value){identityHTML=value;identityRemoved=!value.includes('id="identity"')}});
 let calls=[];
 const c={console,structuredClone,localStorage:{getItem(k){return mem[k]||null},setItem(k,v){mem[k]=v},removeItem(k){delete mem[k]}},sessionStorage:{getItem(k){return tab[k]||null},setItem(k,v){tab[k]=v},removeItem(k){delete tab[k]}},document:{querySelector:id=>id==='#identity'&&identityRemoved?null:n(id),querySelectorAll(){return[]}},window:{CLUB_CONFIG:online?{supabaseUrl:'https://test.supabase.co',supabasePublishableKey:'public-test-key'}:{},scrollTo(){}},navigator:{},location:{protocol:'https:',origin:'https://club.pages.dev',pathname:'/',hash:'',search:''},history:{replaceState(){}},setTimeout(){},clearTimeout(){},Date,Blob,URL,URLSearchParams,Uint8Array,atob,fetch:async(url,args)=>{calls.push({url,args});return {ok:true,json:async()=>({})}}};
 vm.createContext(c);const html=fs.readFileSync(new URL('../web/index.html',`file://${__filename}`),'utf8');vm.runInContext(html.split('<script>')[1].split('</script>')[0],c);vm.runInContext(fs.readFileSync(new URL('../web/cloud.js',`file://${__filename}`),'utf8'),c);return {c,n,calls};
}
(async()=>{
 let {c}=harness();await vm.runInContext(`(async()=>{
  for(const id of Object.keys(pages)){page=id;render();if(!$('#app').innerHTML)throw Error('empty '+id)}
  user=11;page='players';render();if(($('#app').innerHTML.match(/class="radar"/g)||[]).length!==1)throw Error('own radar');profile(0);if(!$('#modal').innerHTML.includes('riservate'))throw Error('privacy');
  user=11;page='votes';render();if($('#app').innerHTML.includes('Attiva votazione'))throw Error('nonadmin voting control');await openFirstRound('pollone');if(currentRounds('pollone').length)throw Error('nonadmin opened vote');if(await action('round_open',{award:'bidone',season}))throw Error('nonadmin direct open');
  user=0;page='votes';render();await openFirstRound('pollone');let first=currentRounds('pollone')[0];await action('vote',{round:first.id,candidate:0});if(!hasVoted(first))throw Error('self vote');let count=first.count;await action('vote',{round:first.id,candidate:1});if(first.count!==count)throw Error('duplicate');await action('round_close',{id:first.id});await action('round_open',{season,award:'pollone',candidates:[0,1]});let second=currentRounds('pollone')[1];if(second.count||hasVoted(second))throw Error('reset');user=11;await action('vote',{round:second.id,candidate:0});if(!hasVoted(second))throw Error('eliminated voter');user=0;await action('round_close',{id:second.id});await action('round_final',{id:second.id});render();if(!$('#app').innerHTML.includes('Vincitore'))throw Error('winner');
  newMatch();if(!$('#modal').innerHTML.includes('Oratorio Don Bosco Arena'))throw Error('default field');
  let edited=state.matches[0];editMatch(edited.id);if(!$('#modal').innerHTML.includes('edit-match-date')||!$('#modal').innerHTML.includes('edit-b4'))throw Error('missing editing fields');
  user=11;showMatch(edited.id);if($('#modal').innerHTML.includes('Modifica partita'))throw Error('nonadmin edit button');user=0;
  await action('match_edit',{id:edited.id,date:'2026-10-15',time:'20:30',field:'Oratorio Don Bosco Arena',a:edited.a,b:edited.b});if(edited.time!=='20:30')throw Error('edit time');
  let before=p(0).goals;let m=state.matches[0],result={};for(let pid of [...m.a,...m.b])result[pid]={goals:pid===0?2:0,own:0,present:true};await action('result',{id:m.id,result});await action('result',{id:m.id,result});if(p(0).goals!==before+2)throw Error('double result');
  showMatch(m.id);if(!$('#modal').innerHTML.includes('Gol: <b>2</b>')||!$('#modal').innerHTML.includes('Autogol: <b>0</b>'))throw Error('missing player goals');if(!$('#modal').innerHTML.includes('Annulla partita'))throw Error('missing cancel');
  user=11;showMatch(m.id);if($('#modal').innerHTML.includes('Annulla partita'))throw Error('nonadmin cancel button');user=0;
  await action('match_cancel',{id:m.id,reason:'Pioggia'});if(p(0).goals!==before||!m.cancelled)throw Error('cancel statistics');
  showMatch(m.id);if(!$('#modal').innerHTML.includes('Partita annullata')||$('#modal').innerHTML.includes('Registra risultato')||$('#modal').innerHTML.includes('Correggi risultato'))throw Error('cancelled detail');
  await action('player',{name:'Ospite Occasionale',role:'Attaccante',occasional:true,email:''});let guest=state.players.at(-1);if(!guest.occasional)throw Error('guest');page='players';render();if(!$('#app').innerHTML.includes('Occasionale'))throw Error('guest label');
  if($('#identity').innerHTML.includes('Ospite Occasionale'))throw Error('guest login');

 })()`,c);
 const rollover=harness();await vm.runInContext(`(async()=>{
 user=0;for(const m of state.matches.filter(m=>!m.done&&!m.cancelled))await action('match_cancel',{id:m.id});
 const old=season,goals=p(0).goals;await action('season_start',{previous:old,name:'2026/2027',started_on:'2026-09-01'});
 if(season===old||p(0).goals!==0||state.matches.length)throw Error('new season reset');
 await changeSeason(old);if(!state.seasonInfo.closed_at||p(0).goals!==goals)throw Error('archive lost');
 if(await action('round_open',{season:old,award:'pollone'}))throw Error('archive mutable');
 user=11;page='awards';render();if($('#app').innerHTML.includes('Classifica riservata dal tuo admin'))throw Error('archive award hidden');if(!Object.values(state.closedAwards).flat().every(w=>$('#app').innerHTML.includes(w.name)))throw Error('missing winner');
 })()`,rollover.c);
 const formations=harness();await vm.runInContext(`(async()=>{
 user=0;const ids=state.players.slice(0,10).map(p=>p.id),balanced=balanceTeams(ids);
 if(balanced.a.length!==5||balanced.b.length!==5||new Set([...balanced.a,...balanced.b]).size!==10)throw Error('invalid balance');
 if(balanced.a.filter(id=>p(id).role==='Portiere').length!==1||balanced.b.filter(id=>p(id).role==='Portiere').length!==1)throw Error('goalkeepers not split');
 for(const id of ids)p(id).ratings=[60,60,60,60,60,60];const equal=balanceTeams(ids);for(const role of ['Attaccante','Regista','Difensore','Portiere'])if(Math.abs(equal.a.filter(id=>p(id).role===role).length-equal.b.filter(id=>p(id).role===role).length)>1)throw Error('unbalanced roles');
 draft={ids,mode:'manual',date:'2026-10-08',time:'21:00',field:'Arena'};manualTeamEditor();ids.forEach((id,i)=>$('#manual-team-'+id).value=i<5?'a':'b');applyManualTeams({preventDefault(){}});if(draft.a.join(',')!==ids.slice(0,5).join(','))throw Error('manual assignment');
 const m=state.matches[0],result=Object.fromEntries([...m.a,...m.b].map(id=>[id,{goals:id===m.a[0]?2:0,own:0,present:id!==m.b[0]}]));await action('result',{id:m.id,result});if(p(m.a[0]).wins!==1||p(m.b[0]).losses!==0)throw Error('result stats');
 p(1).goals=99;for(const pending of state.matches.filter(m=>!m.done&&!m.cancelled))await action('match_cancel',{id:pending.id});const old=season;await action('season_start',{previous:old,name:'Next',started_on:'2027-09-01'});const frozen=JSON.stringify(state.hallOfFame);
 const champion=state.hallOfFame[0].awards.goals[0];await action('player_delete',{id:champion.id});if(JSON.stringify(state.hallOfFame)!==frozen)throw Error('award changed after delete');
 user=11;page='hall';render();if(!$('#app').innerHTML.includes(champion.name)||!$('#app').innerHTML.includes('4 Pollari'))throw Error('hall hidden');
 })()`,formations.c);
 const reminders=harness();await vm.runInContext(`(async()=>{
 user=0;page='settings';render();if(!$('#app').innerHTML.includes('Promemoria automatici')||!$('#app').innerHTML.includes('reminder-first_hours'))throw Error('missing reminder settings');
 for(const [key,value] of Object.entries(reminderDefaults)){if(typeof value==='boolean')$('#reminder-'+key).checked=value;else $('#reminder-'+key).value=String(value)}$('#reminder-first_hours').value='10';await saveReminderSettings({preventDefault(){}});if(state.reminderSettings.first_hours!==10)throw Error('unsaved reminders');
 user=11;render();if($('#app').innerHTML.includes('reminder-first_hours'))throw Error('nonadmin settings');if(await action('reminder_settings',{...reminderDefaults}))throw Error('nonadmin saved reminders');
 })()`,reminders.c);
 const playerEditing=harness();await vm.runInContext(`(async()=>{
 user=0;profile(1);if(!$('#modal').innerHTML.includes('Modifica giocatore'))throw Error('missing edit button');editPlayer(1);if(!$('#modal').innerHTML.includes('edit-player-name')||!$('#modal').innerHTML.includes('edit-player-role')||!$('#modal').innerHTML.includes('edit-player-kind'))throw Error('missing fields');
 const old=JSON.stringify({goals:p(1).goals,ratings:p(1).ratings});$('#edit-player-name').value='Nome Nuovo';$('#edit-player-role').value='Portiere';$('#edit-player-kind').value='member';await savePlayerDetails({preventDefault(){}},1);if(p(1).name!=='Nome Nuovo'||p(1).role!=='Portiere'||JSON.stringify({goals:p(1).goals,ratings:p(1).ratings})!==old)throw Error('profile edit lost statistics');
 p(1).email='member@test.invalid';editPlayer(1);$('#edit-player-kind').value='guest';playerKindChanged(1);if($('#edit-player-revoke').hidden||!$('#edit-player-revoke-confirm').required)throw Error('missing revoke confirmation');$('#edit-player-name').value='Nome Nuovo';$('#edit-player-role').value='Portiere';$('#edit-player-revoke-confirm').checked=true;await savePlayerDetails({preventDefault(){}},1);if(!p(1).occasional||p(1).email)throw Error('guest conversion');
 user=11;profile(1);if($('#modal').innerHTML.includes('Modifica giocatore'))throw Error('nonadmin edit control');if(await action('player_edit',{id:1,name:'Wrong',role:'Difensore',occasional:false}))throw Error('nonadmin edit action');
 })()`,playerEditing.c);
 const recovery=harness();await vm.runInContext(`(async()=>{user=0;page='matches';render();if(!$('#app').innerHTML.includes('1 partita nella stagione'))throw Error('missing match total');const id=11;await action('player_delete',{id});page='settings';render();if(!$('#app').innerHTML.includes('Recupera'))throw Error('missing recovery');await action('player_restore',{id});if(!state.players.some(p=>p.id===id))throw Error('restore failed');if(!state.demoChanges.some(c=>c.action==='player_restore'))throw Error('missing history');})()`,recovery.c);
 const activation=harness();await vm.runInContext(`(async()=>{user=0;p(11).apps=0;await action('player_active',{id:11,active:false});page='players';render();if($('#app').innerHTML.includes('Nicola Bruno'))throw Error('zero-appearance inactive visible');p(11).apps=1;render();if(!$('#app').innerHTML.includes('Nicola Bruno')||!$('#app').innerHTML.includes('Disattivato'))throw Error('inactive history missing');p(11).apps=0;p(11).hasPresence=true;render();if(!$('#app').innerHTML.includes('Nicola Bruno'))throw Error('presence flag ignored');page='settings';render();if(!$('#app').innerHTML.includes('Riattiva'))throw Error('no management activation');await action('player_active',{id:11,active:true});if(p(11).active!==true)throw Error('reactivation failed');})()`,activation.c);
 const online=harness(true);assert.ok(online.n('#app').innerHTML.includes('Accedi'));assert.ok(!online.n('#app').innerHTML.includes('32'));
 await vm.runInContext(`(async()=>{session={access_token:'test-session'};await rpc('club_action',{p_action:'vote',p_data:{round:1,candidate:1}})})()`,online.c);
 assert.equal(online.calls[0].args.headers.Authorization,'Bearer test-session');assert.ok(online.calls[0].url.endsWith('/rest/v1/rpc/club_action'));
 const snapshot=vm.runInContext("({...structuredClone(seed),user:0,season:2026,seasons:[2026],rounds:[]})",online.c);
 online.c.fetch=async()=>({ok:true,json:async()=>snapshot});
 await vm.runInContext('reload()',online.c);
 assert.ok(online.n('#app').innerHTML.includes('Ci vediamo in campo'));
 assert.ok(online.n('.identity').innerHTML.includes('Admin'));
 await vm.runInContext('reload()',online.c);
 assert.ok(online.n('#app').innerHTML.includes('Ci vediamo in campo'));
 const saved={},tab={};const remember=harness(false,saved,tab);
 remember.n('#auth-remember').checked=true;vm.runInContext("chooseRemember();storeSession({access_token:'saved',refresh_token:'refresh',expires_in:3600})",remember.c);assert.ok(saved['club-session']);assert.equal(tab['club-session'],undefined);
 const reopened=harness(false,saved,{});assert.equal(vm.runInContext('session.access_token',reopened.c),'saved');
 vm.runInContext('storeSession(null)',reopened.c);assert.equal(saved['club-session'],undefined);
 remember.n('#auth-remember').checked=false;vm.runInContext("chooseRemember();storeSession({access_token:'temporary',expires_in:3600})",remember.c);assert.ok(tab['club-session']);assert.equal(saved['club-session'],undefined);assert.equal(vm.runInContext('session',harness(false,saved,{}).c),null);
 let subscribed=true,registered=true;const push=harness(true);push.c.window.PushManager=function(){};push.c.Notification={permission:'granted',requestPermission:async()=> 'granted'};const sub={endpoint:'https://fcm.googleapis.com/test',toJSON(){return {endpoint:this.endpoint}},async unsubscribe(){subscribed=false;return true}};const reg={active:true,pushManager:{getSubscription:async()=>subscribed?sub:null,subscribe:async()=>{subscribed=true;return sub}}};push.c.navigator.serviceWorker={getRegistration:async()=>reg,register:async()=>reg};
 push.c.fetch=async(url,args)=>{const body=JSON.parse(args.body);if(url.endsWith('club_device_push')){if(body.p_disable)registered=false;return {ok:true,json:async()=>({active:registered})}}if(url.endsWith('club_action'))registered=true;return {ok:true,json:async()=> url.endsWith('club_snapshot')?snapshot:{publicKey:'AA'}}};
 await vm.runInContext("session={access_token:'test'};reload()",push.c);assert.ok(push.n('#app').innerHTML.includes('Disattiva notifiche'));
 await vm.runInContext('togglePush()',push.c);assert.equal(subscribed,false);assert.equal(registered,false);assert.ok(push.n('#app').innerHTML.includes('Attiva notifiche'));
 await vm.runInContext('togglePush()',push.c);assert.equal(subscribed,true);assert.equal(registered,true);assert.ok(push.n('#app').innerHTML.includes('Disattiva notifiche'));
 registered=false;await vm.runInContext('reload()',push.c);assert.ok(push.n('#app').innerHTML.includes('Attiva notifiche'));
 console.log('PASS frontend: all screens, own statistics, demo secret voting, self vote, round reset, eliminated voters, winners, result corrections, online login gate and authenticated RPC');
})().catch(e=>{console.error(e);process.exit(1)});
